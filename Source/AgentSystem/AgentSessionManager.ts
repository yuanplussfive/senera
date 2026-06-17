import type { AgentEventSink } from "./AgentEvent.js";
import type { AgentEventEnvelope } from "./AgentEventBase.js";
import { AgentEventKinds, emitAgentEvent, withEventContext } from "./AgentEvent.js";
import type { AgentHistoryStepRun } from "./AgentSessionEventTypes.js";
import { AgentConversationPolicy } from "./AgentConversationPolicy.js";
import { AgentConversationProjector } from "./AgentConversationProjector.js";
import {
  type AgentConversationEntry,
  AgentConversationEntryKinds,
} from "./AgentConversation.js";
import { extractDecisionStreamingPreview } from "./AgentDecisionStreamingPreview.js";
import { createRequestId } from "./AgentIds.js";
import type { AgentLoop } from "./AgentLoop.js";
import { AgentCancellationError } from "./AgentCancellation.js";
import { matchByKind } from "./AgentMatch.js";
import {
  AgentSessionStatuses,
  type AgentSession,
} from "./AgentSession.js";
import { AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import { AgentSessionStore } from "./AgentSessionStore.js";
import type { StepTrace } from "./AgentStepTrace.js";
import { AgentRunEventHistoryReplayChunkSize } from "./AgentRunEventHistoryPolicy.js";
import type { AgentUploadAttachment } from "./Uploads/AgentUploadTypes.js";
import type { StoredRunSnapshot } from "./AgentSqliteSessionRepository.js";

const HISTORY_REPLAY_CHUNK_SIZE = 50;

/**
 * 给状态机累积的（无时间戳）step 轨迹补上 turn 级基准时间。
 * 精简档不承诺逐步精确计时：startedAt 用 turn 起始时间，
 * 终结节点（answer）用 assistant entry 落盘时间。
 */
function stampStepTraces(
  traces: ReadonlyArray<StepTrace>,
  startedAt: string,
  endedAt: string,
): StepTrace[] {
  return traces.map((trace) => ({
    ...trace,
    startedAt: trace.startedAt ?? startedAt,
    endedAt: trace.endedAt ?? (trace.kind === "answer" ? endedAt : startedAt),
  }));
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "未知错误";
  }
}

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
    this.cleanupOrphanedRunningSnapshots();
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
    attachments?: AgentUploadAttachment[];
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
    refresh?: boolean;
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
        if (entries.length === 0 && !this.store.hasPersistedSession(sessionId)) {
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
        refresh: request.refresh || undefined,
      },
    });

    for (let index = 0; index < entries.length; index += HISTORY_REPLAY_CHUNK_SIZE) {
      const chunk = entries.slice(index, index + HISTORY_REPLAY_CHUNK_SIZE);
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.SessionHistoryChunk,
        context: { sessionId },
        data: {
          sessionId,
          entries: chunk.map((entry) => ({
            entry,
            visible:
              entry.kind === AgentConversationEntryKinds.AssistantDecision
                ? extractDecisionStreamingPreview(entry.xml)
                : undefined,
          })),
        },
      });
    }

    // step 轨迹：按轮次重建执行图所需的精简档 + 从 entries 派生的 run 字段
    const stepRuns = this.buildHistoryStepRuns(sessionId, entries);
    if (stepRuns.length > 0) {
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.SessionHistorySteps,
        context: { sessionId },
        data: { sessionId, runs: stepRuns },
      });
    }

    const runEvents = this.store.loadRunEvents(sessionId);
    for (let index = 0; index < runEvents.length; index += AgentRunEventHistoryReplayChunkSize) {
      const chunk = runEvents.slice(index, index + AgentRunEventHistoryReplayChunkSize);
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.SessionRunHistoryChunk,
        context: { sessionId },
        data: {
          sessionId,
          events: chunk,
        },
      });
    }

    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistoryCompleted,
      context: { sessionId },
      data: { sessionId, refresh: request.refresh || undefined },
    });
  }

  /**
   * 把持久化的 step 轨迹按轮次组装成回放用的 run 列表。
   * steps 来自 step_traces；input/startedAt/endedAt/modelProvider 从同 requestId 的
   * user.message 与 assistant.decision 派生，否则历史 run 选择器会显示「无输入」或时间错乱。
   */
  private buildHistoryStepRuns(
    sessionId: string,
    entries: AgentConversationEntry[],
  ): AgentHistoryStepRun[] {
    const userByRequest = new Map<string, AgentConversationEntry>();
    const assistantByRequest = new Map<string, AgentConversationEntry>();
    for (const entry of entries) {
      if (entry.kind === AgentConversationEntryKinds.UserMessage) {
        if (!userByRequest.has(entry.requestId)) userByRequest.set(entry.requestId, entry);
      } else if (entry.kind === AgentConversationEntryKinds.AssistantDecision) {
        assistantByRequest.set(entry.requestId, entry);
      }
    }

    const runsByRequest = new Map<string, AgentHistoryStepRun>();
    const storedRuns = this.store.loadStepTraces(sessionId);
    for (const run of storedRuns) {
      const userEntry = userByRequest.get(run.requestId);
      const assistantEntry = assistantByRequest.get(run.requestId);
      const modelProvider =
        assistantEntry?.metadata?.run?.modelProvider ?? userEntry?.metadata?.run?.modelProvider;
      runsByRequest.set(run.requestId, {
        requestId: run.requestId,
        input: userEntry?.kind === AgentConversationEntryKinds.UserMessage ? userEntry.content : "",
        startedAt: userEntry?.timestamp ?? run.traces[0]?.startedAt ?? "",
        endedAt: assistantEntry?.timestamp,
        status: "completed" as const,
        modelProvider,
        traces: run.traces,
      });
    }

    const snapshots = this.store.loadRunSnapshots(sessionId);
    for (const snapshot of snapshots) {
      const existing = runsByRequest.get(snapshot.requestId);
      if (existing) {
        existing.input = existing.input || snapshot.input;
        existing.startedAt = existing.startedAt || snapshot.startedAt;
        existing.modelProvider = existing.modelProvider ?? snapshot.modelProvider;

        const hasPersistedTraces = existing.traces.length > 0;
        if (hasPersistedTraces) {
          // step_traces are persisted with the assistant entry and are the authoritative completed run.
          // A stale running snapshot may have been marked failed during restart cleanup.
          existing.status = "completed";
          existing.endedAt = existing.endedAt ?? snapshot.endedAt ?? snapshot.updatedAt;
          continue;
        }

        existing.endedAt = snapshot.endedAt ?? existing.endedAt;
        existing.status = snapshot.status;
        if (snapshot.status === "completed") {
          existing.status = "failed";
          existing.endedAt = snapshot.endedAt ?? snapshot.updatedAt;
          existing.traces = [createMissingRunDataTrace(snapshot)];
        }

        continue;
      }

      const status = snapshot.status === "completed" ? "failed" : snapshot.status;
      runsByRequest.set(snapshot.requestId, {
        requestId: snapshot.requestId,
        input: snapshot.input,
        startedAt: snapshot.startedAt,
        endedAt: snapshot.endedAt ?? (status === "failed" ? snapshot.updatedAt : undefined),
        status,
        modelProvider: snapshot.modelProvider,
        traces: status === "running" ? [] : [createMissingRunDataTrace(snapshot)],
      });
    }

    return Array.from(runsByRequest.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  recordRunEvent(envelope: AgentEventEnvelope): void {
    if (!envelope.sessionId || !envelope.requestId) {
      return;
    }

    this.store.persistRunEvent(envelope.sessionId, envelope);
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

  /** 用户主动取消活跃 run：立即发终态事件并解除会话 busy，同时让后台执行链路尽快 abort。 */
  async cancelActiveRun(request: {
    sessionId: string;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    const run = this.activeRuns.get(request.sessionId);
    if (!run) return false;

    if (!run.cancelled) {
      run.cancelled = true;
      run.controller.abort(new AgentCancellationError());
    }

    this.activeRuns.delete(request.sessionId);
    const lookup = this.store.get(request.sessionId);
    if (lookup.kind === "found") {
      lookup.session.status = AgentSessionStatuses.Idle;
      lookup.session.updatedAt = new Date().toISOString();
      lookup.session.activeRequest = undefined;
      this.store.persistMetadata(lookup.session);
    }

    await emitAgentEvent(request.onEvent ?? run.onEvent, {
      kind: AgentEventKinds.RunCancelled,
      context: {
        sessionId: request.sessionId,
        requestId: run.requestId,
      },
      data: { reason: "user_cancelled" },
    });

    const removedEntries = this.store.truncateFromRequest(request.sessionId, run.requestId);
    if (lookup.kind === "found") {
      lookup.session.updatedAt = new Date().toISOString();
      this.store.persistMetadata(lookup.session);
    }
    await emitAgentEvent(request.onEvent ?? run.onEvent, {
      kind: AgentEventKinds.SessionTruncated,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        fromRequestId: run.requestId,
        removedEntries,
      },
    });
    return true;
  }

  private discardActiveRun(session: AgentSession): void {
    const run = this.activeRuns.get(session.id);
    if (run) {
      const activeRequest = session.activeRequest;
      if (activeRequest) {
        const endedAt = new Date().toISOString();
        this.store.persistRunSnapshot({
          sessionId: session.id,
          requestId: activeRequest.requestId,
          input: activeRequest.input,
          status: "cancelled",
          startedAt: activeRequest.startedAt,
          updatedAt: endedAt,
          endedAt,
          errorMessage: "请求已被中断。",
        });
      }
      run.controller.abort();
      this.activeRuns.delete(session.id);
    }
    session.status = AgentSessionStatuses.Idle;
    session.activeRequest = undefined;
  }

  private cleanupOrphanedRunningSnapshots(): void {
    const now = new Date().toISOString();
    for (const session of this.store.listSessions()) {
      const snapshots = this.store.loadRunSnapshots(session.id);
      for (const snapshot of snapshots) {
        if (snapshot.status !== "running") continue;
        this.store.persistRunSnapshot({
          ...snapshot,
          status: "failed",
          updatedAt: now,
          endedAt: now,
          errorMessage: "后端重启前该请求仍在运行，已标记为失败。",
        });
      }
    }
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
      attachments?: AgentUploadAttachment[];
      onEvent?: AgentEventSink;
    },
  ): Promise<void> {
    const requestId = request.requestId?.trim() || createRequestId();
    const timestamp = new Date().toISOString();
    const userEntry = this.conversationProjector.projectUserInput(
      requestId,
      request.input,
      timestamp,
      undefined,
      request.attachments,
    );
    const messages = [
      ...this.conversationPolicy.materialize(session.conversation, {
        toolResultsScope: {
          kind: "none",
        },
        evidenceMemoryScope: {
          kind: "all",
        },
      }),
      {
        role: "user" as const,
        content: this.conversationPolicy.renderCurrentUserMessage(userEntry),
      },
    ];

    session.status = AgentSessionStatuses.Running;
    session.updatedAt = timestamp;
    session.activeRequest = {
      requestId,
      input: request.input,
      startedAt: timestamp,
      attachments: request.attachments,
    };
    this.store.persistMetadata(session);

    // 先把 user message 落盘——保证即使后面崩溃也能看到这一轮发生过
    this.store.persistEntries(session.id, [userEntry]);
    this.store.persistRunSnapshot({
      sessionId: session.id,
      requestId,
      input: request.input,
      status: "running",
      startedAt: timestamp,
      updatedAt: timestamp,
    });

    // 该 session 已有 active run 时（不应该到这——但防御一下）先取消
    this.activeRuns.get(session.id)?.controller.abort();
    const controller = new AbortController();
    const run: ActiveSessionRun = { requestId, controller, onEvent: request.onEvent };
    this.activeRuns.set(session.id, run);

    try {
      const result = await this.options.loopFactory(request.modelProviderId).run({
        requestId,
        input: request.input,
        messages,
        conversationEntries: [
          ...session.conversation,
          userEntry,
        ],
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
      // 精简档 step 轨迹：状态机不产生时间戳，这里统一补 turn 级基准时间后
      // 与 entries 在同一事务内原子落盘。
      const stampedTraces = stampStepTraces(result.stepTraces, timestamp, assistantEntry.timestamp);
      this.store.persistTurnArtifacts(session.id, requestId, fresh, stampedTraces);
      this.store.persistRunSnapshot({
        sessionId: session.id,
        requestId,
        input: request.input,
        status: "completed",
        startedAt: timestamp,
        updatedAt: assistantEntry.timestamp,
        endedAt: assistantEntry.timestamp,
        modelProvider: result.modelProvider,
      });

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
        const endedAt = new Date().toISOString();
        this.store.persistRunSnapshot({
          sessionId: session.id,
          requestId,
          input: request.input,
          status: "cancelled",
          startedAt: timestamp,
          updatedAt: endedAt,
          endedAt,
          errorMessage: error.message,
        });
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.RunCancelled,
          context: { sessionId: session.id, requestId },
          data: { reason: "user_cancelled" },
        });
        return; // 用户取消是"成功"的一种结束，不重新抛出
      }
      const endedAt = new Date().toISOString();
      this.store.persistRunSnapshot({
        sessionId: session.id,
        requestId,
        input: request.input,
        status: "failed",
        startedAt: timestamp,
        updatedAt: endedAt,
        endedAt,
        errorMessage: readErrorMessage(error),
      });
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
  onEvent?: AgentEventSink;
  cancelled?: boolean;
}

function createMissingRunDataTrace(snapshot: StoredRunSnapshot): StepTrace {
  return {
    step: 0,
    seq: 0,
    kind: "answer",
    status: "failed",
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt ?? snapshot.updatedAt,
    title: "回复数据丢失",
    errorMessage: snapshot.errorMessage ?? "回复数据丢失，请重新发送请求。",
  };
}
