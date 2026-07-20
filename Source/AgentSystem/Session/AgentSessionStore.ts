import { createOpaqueId, createSessionId } from "../Core/AgentIds.js";
import { AgentSessionStatuses, type AgentSession } from "./AgentSession.js";
import type {
  AgentSessionRepository,
  AgentSessionTurnCommit,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "./AgentSqliteSessionRepository.js";
import { InMemorySessionRepository } from "./AgentSqliteSessionRepository.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import {
  AgentEventSequencer,
  toEventEnvelope,
  type AgentDomainEvent,
  type AgentEventEnvelope,
} from "../Events/AgentEvent.js";
import { projectAgentRunEventForHistory } from "../Events/AgentRunEventHistoryPolicy.js";
import {
  withAgentTurnPreparationBoundary,
  type AgentTurnPreparationSnapshot,
} from "../Loop/AgentTurnPreparationSnapshot.js";
import {
  AgentPiSessionLifecycleStates,
  resolveAgentPiSessionLifecycle,
  withAgentPiSessionLifecycle,
} from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentSessionHistoryMutation } from "./AgentSessionHistoryMutation.js";

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

export type AgentSessionForkResult =
  | { kind: "forked"; session: AgentSession; sourceSessionId: string; throughRequestId: string }
  | { kind: "source_missing"; sourceSessionId: string }
  | { kind: "target_exists"; sessionId: string }
  | { kind: "request_missing"; sourceSessionId: string; requestId: string };

export interface AgentSessionStoreOptions {
  repository?: AgentSessionRepository;
}

/**
 * 内存缓存 + 仓储（默认内存仓储；接入 SqliteSessionRepository 可持久化）。
 * 启动时调用 hydrateFromRepository() 从仓储回填缓存。
 */
export class AgentSessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly durableEventSequencer = new AgentEventSequencer();
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

  listPendingHistoryMutations(): AgentSessionHistoryMutation[] {
    return this.repository.listPendingHistoryMutations();
  }

  loadPendingHistoryMutation(sessionId: string): AgentSessionHistoryMutation | undefined {
    return this.repository.loadPendingHistoryMutation(sessionId);
  }

  stageHistoryMutation(mutation: AgentSessionHistoryMutation): void {
    this.repository.stageHistoryMutation(mutation);
  }

  commitHistoryMutation(mutation: AgentSessionHistoryMutation, session: AgentSession): number {
    const removed = this.repository.commitHistoryMutation(mutation.mutationId, session);
    const current = this.sessions.get(session.id);
    if (current) {
      const anchor = current.conversation.findIndex((entry) => entry.requestId === mutation.fromRequestId);
      current.conversation = anchor >= 0 ? current.conversation.slice(0, anchor) : current.conversation;
      current.metadata = structuredClone(session.metadata);
      current.updatedAt = session.updatedAt;
      current.status = session.status;
      current.activeRequest = session.activeRequest ? structuredClone(session.activeRequest) : undefined;
      this.sequenceBySession.set(session.id, current.conversation.length);
    }
    return removed;
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

  fork(request: { sourceSessionId: string; sessionId: string; throughRequestId: string }): AgentSessionForkResult {
    const sourceLookup = this.get(request.sourceSessionId);
    if (sourceLookup.kind === "missing") {
      return { kind: "source_missing", sourceSessionId: request.sourceSessionId };
    }
    if (this.sessions.has(request.sessionId) || this.repository.loadSession(request.sessionId)) {
      return { kind: "target_exists", sessionId: request.sessionId };
    }

    const sourceEntries = this.repository.loadEntries(request.sourceSessionId);
    const lastIncludedIndex = findLastRequestIndex(sourceEntries, request.throughRequestId);
    if (lastIncludedIndex < 0) {
      return {
        kind: "request_missing",
        sourceSessionId: request.sourceSessionId,
        requestId: request.throughRequestId,
      };
    }

    const timestamp = new Date().toISOString();
    const entries = sourceEntries.slice(0, lastIncludedIndex + 1).map((entry) => ({
      ...structuredClone(entry),
      id: `${request.sessionId}:${entry.id}`,
    }));
    const includedRequestIds = new Set(entries.map((entry) => entry.requestId));
    const sourcePi = resolveAgentPiSessionLifecycle(sourceLookup.session.metadata);
    const session: AgentSession = {
      id: request.sessionId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: AgentSessionStatuses.Idle,
      conversation: entries,
      metadata: withAgentPiSessionLifecycle(
        structuredClone(sourceLookup.session.metadata),
        AgentPiSessionLifecycleStates.Absent,
        sourcePi.modelProviderId,
      ),
    };

    const traces = this.repository
      .loadStepTraces(request.sourceSessionId)
      .filter((run) => includedRequestIds.has(run.requestId))
      .flatMap((run) =>
        run.traces.map((trace) => ({ requestId: run.requestId, turnSequence: run.turnSequence, trace })),
      );
    const runSnapshots = this.repository
      .loadRunSnapshots(request.sourceSessionId)
      .filter((snapshot) => includedRequestIds.has(snapshot.requestId))
      .map((snapshot) => ({ ...structuredClone(snapshot), sessionId: session.id }));
    const turnPreparations = [...includedRequestIds].flatMap((requestId) => {
      const preparation = this.repository.loadTurnPreparation(request.sourceSessionId, requestId);
      if (!preparation) return [];
      const { piBranchBoundaryId: _sourceBoundary, ...portablePreparation } = structuredClone(preparation);
      return [{ requestId, snapshot: portablePreparation }];
    });
    const runEvents = this.repository
      .loadRunEvents(request.sourceSessionId)
      .filter((event) => event.requestId && includedRequestIds.has(event.requestId))
      .map((event) => ({
        ...structuredClone(event),
        eventId: createOpaqueId("event"),
        sessionId: session.id,
      }));

    this.repository.createFork({
      session,
      entries: entries.map((entry, sequence) => ({ entry, sequence })),
      traces,
      runSnapshots,
      turnPreparations,
      runEvents,
    });

    this.sessions.set(session.id, session);
    this.sequenceBySession.set(session.id, entries.length);
    return {
      kind: "forked",
      session,
      sourceSessionId: request.sourceSessionId,
      throughRequestId: request.throughRequestId,
    };
  }

  get(sessionId: string): AgentSessionLookupResult {
    const session = this.sessions.get(sessionId);
    return session ? { kind: "found", session } : { kind: "missing", sessionId };
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
    return this.repository.listSessions().map((persisted) => {
      const live = this.sessions.get(persisted.id);
      return live
        ? {
            ...persisted,
            status: live.status,
            activeRequest: live.activeRequest,
          }
        : persisted;
    });
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
    const removed = this.repository.truncateFromRequest(sessionId, requestId);
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

  persistTurnCommit(
    sessionId: string,
    requestId: string,
    entries: ReadonlyArray<AgentConversationEntry>,
    traces: ReadonlyArray<StepTrace>,
    snapshot: StoredRunSnapshot,
    events: readonly AgentDomainEvent[],
    session?: AgentSession,
  ): void {
    const baseSeq = this.sequenceBySession.get(sessionId) ?? 0;
    const entryItems = entries.map((entry, index) => ({ entry, sequence: baseSeq + index }));
    const traceItems = traces.map((trace) => ({ requestId, turnSequence: baseSeq, trace }));
    const runEvents = this.projectDurableEvents(sessionId, requestId, events);
    const commit: AgentSessionTurnCommit = {
      sessionId,
      requestId,
      session,
      entries: entryItems,
      traces: traceItems,
      snapshot,
      runEvents,
    };
    this.repository.persistTurnCommit(commit);
    this.sequenceBySession.set(sessionId, baseSeq + entries.length);
  }

  persistRunStart(
    session: AgentSession,
    requestId: string,
    userEntry: AgentConversationEntry,
    snapshot: StoredRunSnapshot,
    event: AgentDomainEvent,
  ): void {
    const baseSeq = this.sequenceBySession.get(session.id) ?? 0;
    this.repository.persistTurnCommit({
      sessionId: session.id,
      requestId,
      session,
      entries: [{ entry: userEntry, sequence: baseSeq }],
      traces: [],
      snapshot,
      runEvents: this.projectDurableEvents(session.id, requestId, [event]),
    });
    this.sequenceBySession.set(session.id, baseSeq + 1);
  }

  /** 读取某会话所有 step 轨迹，按轮次分组（回放重建执行图用） */
  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    return this.repository.loadStepTraces(sessionId);
  }

  persistRunEvent(sessionId: string, event: AgentEventEnvelope): void {
    this.persistRunEvents(sessionId, [event]);
  }

  persistRunEvents(sessionId: string, events: readonly AgentEventEnvelope[]): void {
    this.repository.appendRunEvents(sessionId, events);
  }

  /** upsert 一轮请求的轻量生命周期快照，用于刷新后恢复运行态 */
  persistRunSnapshot(snapshot: StoredRunSnapshot): void {
    this.repository.upsertRunSnapshot(snapshot);
  }

  /** 读取某会话所有 run snapshots */
  loadRunSnapshots(sessionId: string): StoredRunSnapshot[] {
    return this.repository.loadRunSnapshots(sessionId);
  }

  persistTurnPreparation(sessionId: string, requestId: string, snapshot: AgentTurnPreparationSnapshot): void {
    this.repository.upsertTurnPreparation(sessionId, requestId, snapshot);
  }

  loadTurnPreparation(sessionId: string, requestId: string): AgentTurnPreparationSnapshot | undefined {
    return this.repository.loadTurnPreparation(sessionId, requestId);
  }

  persistTurnPreparationBoundary(sessionId: string, requestId: string, piBranchBoundaryId: string): void {
    const snapshot = this.loadTurnPreparation(sessionId, requestId);
    if (!snapshot) return;
    this.persistTurnPreparation(sessionId, requestId, withAgentTurnPreparationBoundary(snapshot, piBranchBoundaryId));
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

  private projectDurableEvents(
    sessionId: string,
    requestId: string,
    events: readonly AgentDomainEvent[],
  ): AgentEventEnvelope[] {
    return events.flatMap((event) => {
      const envelope = toEventEnvelope(
        {
          ...event,
          context: {
            ...event.context,
            sessionId,
            requestId,
          },
        } as AgentDomainEvent,
        this.durableEventSequencer.next(),
      );
      const projected = projectAgentRunEventForHistory(envelope);
      return projected ? [projected] : [];
    });
  }
}

function findLastRequestIndex(entries: readonly AgentConversationEntry[], requestId: string): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.requestId === requestId) return index;
  }
  return -1;
}
