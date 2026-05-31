import type { AgentEventSink } from "./AgentEvent.js";
import { AgentEventKinds, emitAgentEvent, withEventContext } from "./AgentEvent.js";
import { AgentConversationPolicy } from "./AgentConversationPolicy.js";
import { AgentConversationProjector } from "./AgentConversationProjector.js";
import {
  type AgentConversationEntry,
  AgentConversationEntryKinds,
} from "./AgentConversation.js";
import { extractDecisionStreamingPreview } from "./AgentDecisionStreamingPreview.js";
import { createRequestId } from "./AgentIds.js";
import type { AgentLoop } from "./AgentLoop.js";
import { AgentCancellationError } from "./AgentLoop.js";
import { matchByKind } from "./AgentMatch.js";
import {
  AgentSessionStatuses,
  type AgentSession,
} from "./AgentSession.js";
import { AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import { AgentSessionStore } from "./AgentSessionStore.js";

export interface AgentSessionManagerOptions {
  loopFactory: (modelProviderId?: string) => AgentLoop;
  store?: AgentSessionStore;
  conversationPolicy?: AgentConversationPolicy;
  conversationProjector?: AgentConversationProjector;
}

export class AgentSessionManager {
  private readonly store: AgentSessionStore;
  private readonly conversationPolicy: AgentConversationPolicy;
  private readonly conversationProjector: AgentConversationProjector;
  private readonly eventFactory: AgentSessionEventFactory;
  private readonly activeRuns = new Map<string, ActiveSessionRun>();

  constructor(private readonly options: AgentSessionManagerOptions) {
    this.store = options.store ?? new AgentSessionStore();
    this.conversationPolicy = options.conversationPolicy ?? new AgentConversationPolicy();
    this.conversationProjector = options.conversationProjector ?? new AgentConversationProjector();
    this.eventFactory = new AgentSessionEventFactory(this.conversationPolicy);
  }

  async createSession(request: {
    sessionId?: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const opened = this.store.open(request.sessionId);

    await emitAgentEvent(
      request.onEvent,
      matchByKind(opened, {
        created: ({ session }) => this.eventFactory.created(session),
        existing: ({ session }) => this.eventFactory.snapshot(session),
      }),
    );
  }

  async closeSession(request: {
    sessionId: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const lookup = this.store.get(request.sessionId);

    await matchByKind(lookup, {
      missing: async ({ sessionId }) => {
        await emitAgentEvent(
          request.onEvent,
          this.eventFactory.notFound(sessionId, "session.close"),
        );
      },
      found: async ({ session }) => {
        this.discardActiveRun(session);
        const closed = this.store.close(session.id);
        await emitAgentEvent(
          request.onEvent,
          matchByKind(closed, {
            closed: ({ session: current }) => this.eventFactory.closed(current),
            missing: ({ sessionId }) => this.eventFactory.notFound(sessionId, "session.close"),
          }),
        );
      },
    });
  }

  async submitMessage(request: {
    sessionId: string;
    requestId?: string;
    modelProviderId?: string;
    input: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const lookup = this.store.get(request.sessionId);

    await matchByKind(lookup, {
      missing: async ({ sessionId }) => {
        await emitAgentEvent(
          request.onEvent,
          this.eventFactory.notFound(sessionId, "session.message"),
        );
      },
      found: async ({ session }) => {
        const gate = this.assertAvailable(session, "session.message");
        await matchByKind(gate, {
          available: async ({ current }) => {
            await this.runSessionTurn(current, request);
          },
          busy: async ({ current }) => {
            await emitAgentEvent(
              request.onEvent,
              this.eventFactory.busy(current, "session.message", request.requestId),
            );
          },
        });
      },
    });
  }

  /** 返回所有会话的元数据（不含 conversation） */
  listSessions(): Array<{
    sessionId: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    entryCount: number;
    messageCount: number;
  }> {
    return this.store.listSessions().map((s) => ({
      sessionId: s.id,
      title: this.deriveTitle(s),
      status: s.status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      entryCount: s.entryCount,
      messageCount: s.messageCount,
    }));
  }

  /** 把会话历史投影为 entry 事件流回放（纯读，不会创建幽灵 session） */
  async replayHistory(request: {
    sessionId: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const sessionId = request.sessionId;
    // 先查内存缓存；不在内存就从仓储查（不写入），缓存命中的话内存数据更新
    let entries: AgentConversationEntry[];
    const lookup = this.store.get(sessionId);
    if (lookup.kind === "found") {
      entries = this.store.loadConversation(sessionId);
    } else {
      // 直接读仓储，不调用 store.open()（避免幽灵会话）
      entries = this.store.loadConversation(sessionId);
        if (entries.length === 0) {
          // 仓储里也没有这个会话——告诉客户端不存在，但不创建
          await emitAgentEvent(
            request.onEvent,
            this.eventFactory.notFound(sessionId, "session.history"),
          );
          return;
        }
      }

    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistoryStarted,
      context: { sessionId },
      data: {
        sessionId,
        totalEntries: entries.length,
        messageCount: this.conversationPolicy.materialize(entries).length,
      },
    });

    for (const entry of entries) {
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.SessionHistoryEntry,
        context: { sessionId },
        data: {
          sessionId,
          entry,
          visible:
            entry.kind === AgentConversationEntryKinds.AssistantDecision
              ? extractDecisionStreamingPreview(entry.xml)
              : undefined,
        },
      });
    }

    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistoryCompleted,
      context: { sessionId },
      data: { sessionId },
    });
  }

  async renameSession(request: {
    sessionId: string;
    title: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const lookup = this.store.get(request.sessionId);
    if (lookup.kind === "missing") {
      await emitAgentEvent(
        request.onEvent,
        this.eventFactory.notFound(request.sessionId, "session.close"),
      );
      return;
    }
    this.store.rename(request.sessionId, request.title);
    await emitAgentEvent(request.onEvent, this.eventFactory.snapshot(lookup.session));
  }

  /** 用户主动取消活跃 run——直接 abort 对应的 AbortController */
  cancelActiveRun(sessionId: string): boolean {
    const run = this.activeRuns.get(sessionId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }

  private discardActiveRun(session: AgentSession): void {
    const run = this.activeRuns.get(session.id);
    if (run) {
      run.controller.abort();
      this.activeRuns.delete(session.id);
    }
    session.status = AgentSessionStatuses.Idle;
    session.activeRequest = undefined;
  }

  /** 从指定 requestId 起截断会话（删除该轮 + 之后所有 entries） */
  async truncateFromRequest(request: {
    sessionId: string;
    requestId: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const lookup = this.store.get(request.sessionId);
    if (lookup.kind === "found") {
      this.discardActiveRun(lookup.session);
    }

    const removed = this.store.truncateFromRequest(request.sessionId, request.requestId);
    if (lookup.kind === "found") {
      lookup.session.updatedAt = new Date().toISOString();
      this.store.persistMetadata(lookup.session);
    }
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionTruncated,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        fromRequestId: request.requestId,
        removedEntries: removed,
      },
    });
  }

  /** 列出快照事件给 WS 服务端用 */
  async emitSessionListSnapshot(request: { onEvent?: AgentEventSink }): Promise<void> {
    const list = this.listSessions();
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionListSnapshot,
      context: {},
      data: { sessions: list },
    });
  }

  private assertAvailable(
    session: AgentSession,
    _operation: "session.message" | "session.close",
  ):
    | {
        kind: "available";
        current: AgentSession;
      }
    | {
        kind: "busy";
        current: AgentSession;
      } {
    const activeRun = this.activeRuns.get(session.id);
    if (session.status === AgentSessionStatuses.Running && !activeRun) {
      session.status = AgentSessionStatuses.Idle;
      session.activeRequest = undefined;
      this.store.persistMetadata(session);
    }

    return activeRun
      ? {
          kind: "busy",
          current: session,
        }
      : {
          kind: "available",
          current: session,
        };
  }

  private async runSessionTurn(
    session: AgentSession,
    request: {
      sessionId: string;
      requestId?: string;
      modelProviderId?: string;
      input: string;
      onEvent?: AgentEventSink;
    },
  ): Promise<void> {
    const requestId = request.requestId?.trim() || createRequestId();
    const timestamp = new Date().toISOString();
    const userEntry = this.conversationProjector.projectUserInput(
      requestId,
      request.input,
      timestamp,
    );
    const messages = [
      ...this.conversationPolicy.materialize(session.conversation),
      {
        role: "user" as const,
        content: request.input,
      },
    ];

    session.status = AgentSessionStatuses.Running;
    session.updatedAt = timestamp;
    session.activeRequest = {
      requestId,
      input: request.input,
      startedAt: timestamp,
    };
    this.store.persistMetadata(session);

    // 先把 user message 落盘——保证即使后面崩溃也能看到这一轮发生过
    this.store.persistEntries(session.id, [userEntry]);

    // 该 session 已有 active run 时（不应该到这——但防御一下）先取消
    this.activeRuns.get(session.id)?.controller.abort();
    const controller = new AbortController();
    const run: ActiveSessionRun = { requestId, controller };
    this.activeRuns.set(session.id, run);

    try {
      const result = await this.options.loopFactory(request.modelProviderId).run({
        requestId,
        input: request.input,
        messages,
        signal: controller.signal,
        onEvent: (event) => this.isActiveRun(session.id, run)
          ? emitAgentEvent(
            request.onEvent,
            withEventContext(event, {
              sessionId: session.id,
            }),
          )
          : undefined,
      });
      if (!this.isActiveRun(session.id, run)) {
        return;
      }

      const assistantEntry = this.conversationProjector.projectAssistantDecision(
        requestId,
        result.decisionXml,
        new Date().toISOString(),
        result.modelProvider
          ? {
              run: {
                modelProvider: result.modelProvider,
                usage: result.usage,
              },
            }
          : undefined,
      );

      const previousIds = new Set(session.conversation.map((e) => e.id));
      previousIds.add(userEntry.id); // 已经在前面落盘了

      // 找出本轮新增的（result 可能也含 user/tool_results）
      const fresh: AgentConversationEntry[] = [];
      for (const entry of result.conversationEntries) {
        if (!previousIds.has(entry.id)) {
          fresh.push(entry);
          previousIds.add(entry.id);
        }
      }
      if (!previousIds.has(assistantEntry.id)) {
        fresh.push(assistantEntry);
      }
      this.store.persistEntries(session.id, fresh);

      session.conversation = this.mergeConversationEntries([
        ...session.conversation,
        userEntry,
        ...result.conversationEntries,
        assistantEntry,
      ]);
      session.metadata = result.modelProvider
        ? {
            ...session.metadata,
            lastRun: {
              modelProvider: result.modelProvider,
              usage: result.usage,
            },
          }
        : session.metadata;
    } catch (error) {
      if (!this.isActiveRun(session.id, run)) {
        return;
      }
      // 用户主动取消——发 RunCancelled 终态事件，不算 RunFailed
      if (error instanceof AgentCancellationError) {
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.RunCancelled,
          context: { sessionId: session.id, requestId },
          data: { reason: "user_cancelled" },
        });
        return; // 用户取消是"成功"的一种结束，不重新抛出
      }
      throw error;
    } finally {
      if (this.isActiveRun(session.id, run)) {
        this.activeRuns.delete(session.id);
        session.status = AgentSessionStatuses.Idle;
        session.updatedAt = new Date().toISOString();
        session.activeRequest = undefined;
        this.store.persistMetadata(session);
      }
    }
  }

  private isActiveRun(sessionId: string, run: ActiveSessionRun): boolean {
    return this.activeRuns.get(sessionId) === run;
  }

  private mergeConversationEntries(
    conversation: AgentSession["conversation"],
  ): AgentSession["conversation"] {
    const seen = new Set<string>();
    const merged = [...conversation].reverse().filter((entry) => {
      if (seen.has(entry.id)) {
        return false;
      }

      seen.add(entry.id);
      return true;
    }).reverse();

    return merged;
  }

  private deriveTitle(session: AgentSession & { entryCount: number; messageCount: number }): string {
    // session 列表场景下 conversation 是空的；这里读取首条 user.message 需要从仓储懒加载
    if (session.conversation.length > 0) {
      const first = session.conversation.find(
        (e) => e.kind === AgentConversationEntryKinds.UserMessage,
      );
      if (first && first.kind === AgentConversationEntryKinds.UserMessage) {
        const text = first.content.replace(/\s+/g, " ").trim();
        if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text;
      }
    }
    // 没消息：fallback 用 ID 短名
    if (session.messageCount === 0) return "新对话";
    // 有消息但 conversation 没加载：去仓储查首条
    const entries = this.store.loadConversation(session.id);
    const first = entries.find((e) => e.kind === AgentConversationEntryKinds.UserMessage);
    if (first && first.kind === AgentConversationEntryKinds.UserMessage) {
      const text = first.content.replace(/\s+/g, " ").trim();
      if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text;
    }
    return "新对话";
  }
}

interface ActiveSessionRun {
  requestId: string;
  controller: AbortController;
}
