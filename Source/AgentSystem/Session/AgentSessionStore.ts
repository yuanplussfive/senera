import { createSessionId } from "../Core/AgentIds.js";
import {
  AgentSessionStatuses,
  type AgentSession,
} from "./AgentSession.js";
import type {
  AgentSessionRepository,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "./AgentSqliteSessionRepository.js";
import { InMemorySessionRepository } from "./AgentSqliteSessionRepository.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";

export type AgentSessionOpenResult =
  | {
      kind: "created";
      session: AgentSession;
    }
  | {
      kind: "existing";
      session: AgentSession;
    };

export type AgentSessionLookupResult =
  | {
      kind: "found";
      session: AgentSession;
    }
  | {
      kind: "missing";
      sessionId: string;
    };

export type AgentSessionCloseResult =
  | {
      kind: "closed";
      session: AgentSession;
    }
  | {
      kind: "missing";
      sessionId: string;
    };

export interface AgentSessionStoreOptions {
  repository?: AgentSessionRepository;
}

/**
 * 内存缓存 + 仓储（默认内存仓储；接入 SqliteSessionRepository 可持久化）。
 * 启动时调用 hydrateFromRepository() 从仓储回填缓存。
 */
export class AgentSessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  // 每个会话目前的 entry 计数（用作 SQLite sequence）
  private readonly sequenceBySession = new Map<string, number>();
  private readonly repository: AgentSessionRepository;

  constructor(options: AgentSessionStoreOptions = {}) {
    this.repository = options.repository ?? new InMemorySessionRepository();
  }

  /** 启动时把仓储里的会话灌进缓存 */
  hydrate(): void {
    for (const session of this.repository.loadAll()) {
      this.sessions.set(session.id, session);
      this.sequenceBySession.set(session.id, session.conversation.length);
    }
  }

  open(sessionId?: string): AgentSessionOpenResult {
    const resolvedSessionId = sessionId?.trim() || createSessionId();
    const existing = this.sessions.get(resolvedSessionId);
    if (existing) {
      return { kind: "existing", session: existing };
    }

    // 也许仓储里有但内存里没有（罕见路径，热重载等）
    const fromRepo = this.repository.loadSession(resolvedSessionId);
    if (fromRepo) {
      this.sessions.set(resolvedSessionId, fromRepo);
      this.sequenceBySession.set(resolvedSessionId, fromRepo.conversation.length);
      return { kind: "existing", session: fromRepo };
    }

    return {
      kind: "created",
      session: this.createAndStore(resolvedSessionId),
    };
  }

  get(sessionId: string): AgentSessionLookupResult {
    const session = this.sessions.get(sessionId);
    return session
      ? { kind: "found", session }
      : { kind: "missing", sessionId };
  }

  hasPersistedSession(sessionId: string): boolean {
    return Boolean(this.sessions.get(sessionId) ?? this.repository.loadSession(sessionId));
  }

  close(sessionId: string): AgentSessionCloseResult {
    const lookup = this.get(sessionId);
    if (lookup.kind === "missing") return lookup;
    this.sessions.delete(sessionId);
    this.sequenceBySession.delete(sessionId);
    this.repository.deleteSession(sessionId);
    return { kind: "closed", session: lookup.session };
  }

  /** 列出所有会话——仅元数据（不带 conversation） */
  listSessions(): Array<AgentSession & { entryCount: number; messageCount: number }> {
    return this.repository.listSessions();
  }

  /** 读取某会话完整 conversation（懒加载） */
  loadConversation(sessionId: string): AgentConversationEntry[] {
    return this.repository.loadEntries(sessionId);
  }

  /** 读取某会话执行事件日志（用于右侧执行轨迹历史回放）。 */
  loadRunEvents(sessionId: string): AgentEventEnvelope[] {
    return this.repository.loadRunEvents(sessionId);
  }

  rename(sessionId: string, title: string): void {
    this.repository.renameSession(sessionId, title);
    // 内存缓存里没有 title 字段（沿用旧 model），不动
  }

  /** 删除某 sessionId 从指定 requestId 起的所有 entries，并同步内存缓存 */
  truncateFromRequest(sessionId: string, requestId: string): number {
    this.repository.deleteStepTracesFrom(sessionId, requestId);
    this.repository.deleteRunEventsFrom(sessionId, requestId);
    this.repository.deleteRunSnapshotsFrom(sessionId, requestId);
    const removed = this.repository.deleteEntriesFrom(sessionId, requestId);
    const session = this.sessions.get(sessionId);
    if (session) {
      const idx = session.conversation.findIndex((e) => e.requestId === requestId);
      if (idx >= 0) {
        session.conversation = session.conversation.slice(0, idx);
      }
      this.sequenceBySession.set(sessionId, session.conversation.length);
    }
    return removed;
  }

  /** 同步会话元数据到仓储 */
  persistMetadata(session: AgentSession): void {
    this.repository.upsertSession(session);
  }

  /** 把若干新 entries 追加到仓储——append-only，事务保证原子 */
  persistEntries(sessionId: string, entries: ReadonlyArray<AgentConversationEntry>): void {
    if (entries.length === 0) return;
    const baseSeq = this.sequenceBySession.get(sessionId) ?? 0;
    const items = entries.map((entry, i) => ({ entry, sequence: baseSeq + i }));
    this.repository.appendEntries(sessionId, items);
    this.sequenceBySession.set(sessionId, baseSeq + entries.length);
  }

  /**
   * 一轮 turn 的 entries 与 step 轨迹原子落盘。
   * turn_sequence 取该 turn 起始 entry 的 sequence，供 truncate 时按「该轮及之后」删除。
   */
  persistTurnArtifacts(
    sessionId: string,
    requestId: string,
    entries: ReadonlyArray<AgentConversationEntry>,
    traces: ReadonlyArray<StepTrace>,
  ): void {
    if (entries.length === 0 && traces.length === 0) return;
    const baseSeq = this.sequenceBySession.get(sessionId) ?? 0;
    const entryItems = entries.map((entry, i) => ({ entry, sequence: baseSeq + i }));
    const traceItems = traces.map((trace) => ({ requestId, turnSequence: baseSeq, trace }));
    this.repository.persistTurnArtifacts(sessionId, entryItems, traceItems);
    this.sequenceBySession.set(sessionId, baseSeq + entries.length);
  }

  /** 读取某会话所有 step 轨迹，按轮次分组（回放重建执行图用） */
  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    return this.repository.loadStepTraces(sessionId);
  }

  persistRunEvent(sessionId: string, event: AgentEventEnvelope): void {
    this.repository.appendRunEvent(sessionId, event);
  }

  /** upsert 一轮请求的轻量生命周期快照，用于刷新后恢复运行态 */
  persistRunSnapshot(snapshot: StoredRunSnapshot): void {
    this.repository.upsertRunSnapshot(snapshot);
  }

  /** 读取某会话所有 run snapshots */
  loadRunSnapshots(sessionId: string): StoredRunSnapshot[] {
    return this.repository.loadRunSnapshots(sessionId);
  }

  private createAndStore(sessionId: string): AgentSession {
    const timestamp = new Date().toISOString();
    const session: AgentSession = {
      id: sessionId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: AgentSessionStatuses.Idle,
      conversation: [],
    };

    this.sessions.set(sessionId, session);
    this.sequenceBySession.set(sessionId, 0);
    this.repository.upsertSession(session);
    return session;
  }
}
