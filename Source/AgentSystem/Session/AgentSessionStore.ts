import { createOpaqueId, createSessionId } from "../Core/AgentIds.js";
import { AgentSessionStatuses, type AgentSession } from "./AgentSession.js";
import type {
  AgentSessionCursorPage,
  AgentSessionCursorPageRequest,
  AgentSessionRepository,
  AgentSessionHistoryView,
  AgentStepTraceCursor,
  AgentStepTracePageRequest,
  AgentSessionTurnCommit,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "./AgentSessionRepository.js";
import { InMemorySessionRepository } from "../SessionPersistence/InMemorySessionRepository.js";
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
import type { AgentSessionForkMutation } from "./AgentSessionForkMutation.js";
import type { AgentSessionForkSnapshot } from "./AgentSessionRepository.js";
import type {
  AgentSessionCommandAdmission,
  AgentSessionCommandDescriptor,
  AgentSessionCommandRecord,
} from "./AgentSessionCommand.js";
import {
  resolveAgentSessionWorkingSetPolicy,
  type AgentSessionWorkingSetPolicy,
} from "./AgentSessionWorkingSetPolicy.js";
import { clearAgentSessionRegenerationLineage } from "./AgentSessionLifecycleMetadata.js";

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

export type AgentSessionForkPreparationResult =
  | {
      kind: "prepared";
      snapshot: AgentSessionForkSnapshot;
      sourceSessionId: string;
      throughRequestId: string;
      requestIds: readonly string[];
    }
  | Exclude<AgentSessionForkResult, { kind: "forked" }>;

export interface AgentSessionStoreOptions {
  repository?: AgentSessionRepository;
  workingSet?: Partial<AgentSessionWorkingSetPolicy>;
}

/** 内存工作集 + 仓储。持久化会话只在首次访问时进入工作集。 */
export class AgentSessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly durableEventSequencer = new AgentEventSequencer();
  // 每个会话目前的 entry 计数（用作 SQLite sequence）
  private readonly sequenceBySession = new Map<string, number>();
  private readonly retainedSessions = new Map<string, number>();
  private readonly repository: AgentSessionRepository;
  private readonly workingSetPolicy: AgentSessionWorkingSetPolicy;

  constructor(options: AgentSessionStoreOptions = {}) {
    this.repository = options.repository ?? new InMemorySessionRepository();
    this.workingSetPolicy = resolveAgentSessionWorkingSetPolicy(options.workingSet);
  }

  retainWorkingSession(sessionId: string): () => void {
    this.retainedSessions.set(sessionId, (this.retainedSessions.get(sessionId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.retainedSessions.get(sessionId);
      if (count === undefined || count <= 1) this.retainedSessions.delete(sessionId);
      else this.retainedSessions.set(sessionId, count - 1);
      this.trimWorkingSet();
    };
  }

  trimWorkingSet(): void {
    this.trimWorkingSetExcept();
  }

  private trimWorkingSetExcept(protectedSessionId?: string): void {
    let idleCount = 0;
    for (const session of this.sessions.values()) {
      if (session.status === AgentSessionStatuses.Idle) idleCount += 1;
    }
    if (idleCount <= this.workingSetPolicy.maxIdleSessions) return;

    for (const [sessionId, session] of this.sessions) {
      if (idleCount <= this.workingSetPolicy.maxIdleSessions) break;
      if (
        sessionId === protectedSessionId ||
        session.status !== AgentSessionStatuses.Idle ||
        this.retainedSessions.has(sessionId)
      ) {
        continue;
      }
      this.evictWorkingSession(sessionId);
      idleCount -= 1;
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
      current.conversation = this.repository.loadEntries(session.id);
      current.metadata = structuredClone(session.metadata);
      current.updatedAt = session.updatedAt;
      current.status = session.status;
      current.activeRequest = session.activeRequest ? structuredClone(session.activeRequest) : undefined;
      this.rememberNextSequence(session.id, current.conversation.length);
    }
    return removed;
  }

  listPendingForkMutations(): AgentSessionForkMutation[] {
    return this.repository.listPendingForkMutations();
  }

  loadPendingForkMutation(targetSessionId: string): AgentSessionForkMutation | undefined {
    return this.repository.loadPendingForkMutation(targetSessionId);
  }

  stageForkMutation(mutation: AgentSessionForkMutation): void {
    this.repository.stageForkMutation(mutation);
  }

  requestIdsFrom(sessionId: string, requestId: string): string[] {
    return this.repository.loadRequestIdsFrom(sessionId, requestId);
  }

  hasRequest(sessionId: string, requestId: string): boolean {
    return this.repository.hasRequest(sessionId, requestId);
  }

  open(sessionId?: string): AgentSessionOpenResult {
    const resolvedSessionId = sessionId?.trim() || createSessionId();
    const existing = this.findOrLoadSession(resolvedSessionId);
    if (existing) {
      return { kind: "existing", session: existing };
    }

    return {
      kind: "created",
      session: this.createAndStore(resolvedSessionId),
    };
  }

  prepareFork(request: {
    sourceSessionId: string;
    sessionId: string;
    throughRequestId: string;
    piBranchBoundaryId?: string;
  }): AgentSessionForkPreparationResult {
    const sourceLookup = this.get(request.sourceSessionId);
    if (sourceLookup.kind === "missing") {
      return { kind: "source_missing", sourceSessionId: request.sourceSessionId };
    }
    if (this.hasPersistedSession(request.sessionId)) {
      return { kind: "target_exists", sessionId: request.sessionId };
    }

    const history = this.repository.loadForkHistoryThroughRequest(request.sourceSessionId, request.throughRequestId);
    if (!history || !history.entries.some(({ entry }) => entry.requestId === request.throughRequestId)) {
      return {
        kind: "request_missing",
        sourceSessionId: request.sourceSessionId,
        requestId: request.throughRequestId,
      };
    }

    const timestamp = new Date().toISOString();
    const entries = history.entries.map(({ entry }) => ({
      ...entry,
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
        clearAgentSessionRegenerationLineage(structuredClone(sourceLookup.session.metadata)),
        request.piBranchBoundaryId ? AgentPiSessionLifecycleStates.Initialized : AgentPiSessionLifecycleStates.Absent,
        sourcePi.modelProviderId,
      ),
    };

    const traces = history.traces.map((item) => structuredClone(item));
    const runSnapshots = history.runSnapshots.map((snapshot) => ({
      ...structuredClone(snapshot),
      sessionId: session.id,
    }));
    const turnPreparations = history.turnPreparations.map(({ requestId, snapshot: preparation }) => {
      if (request.piBranchBoundaryId) return { requestId, snapshot: structuredClone(preparation) };
      const { piBranchBoundaryId: _sourceBoundary, ...portablePreparation } = structuredClone(preparation);
      return { requestId, snapshot: portablePreparation };
    });
    const runEvents = history.runEvents.map((event) => ({
      ...structuredClone(event),
      eventId: createOpaqueId("event"),
      sessionId: session.id,
    }));

    const snapshot: AgentSessionForkSnapshot = {
      session,
      entries: entries.map((entry, sequence) => ({ entry, sequence })),
      traces,
      runSnapshots,
      turnPreparations,
      runEvents,
    };
    return {
      kind: "prepared",
      snapshot,
      sourceSessionId: request.sourceSessionId,
      throughRequestId: request.throughRequestId,
      requestIds: [...includedRequestIds],
    };
  }

  commitForkMutation(
    mutation: AgentSessionForkMutation,
    preparation: Extract<AgentSessionForkPreparationResult, { kind: "prepared" }>,
  ): AgentSessionForkResult {
    if (
      mutation.sourceSessionId !== preparation.sourceSessionId ||
      mutation.targetSessionId !== preparation.snapshot.session.id ||
      mutation.throughRequestId !== preparation.throughRequestId
    ) {
      throw new Error(`Session fork mutation does not match prepared snapshot: ${mutation.targetSessionId}`);
    }
    this.repository.commitForkMutation(mutation.mutationId, preparation.snapshot);
    const session = preparation.snapshot.session;
    this.cacheWorkingSession(session, preparation.snapshot.entries.length);
    return {
      kind: "forked",
      session,
      sourceSessionId: preparation.sourceSessionId,
      throughRequestId: preparation.throughRequestId,
    };
  }

  abortForkMutation(mutation: AgentSessionForkMutation): boolean {
    return this.repository.abortForkMutation(mutation.targetSessionId, mutation.mutationId);
  }

  get(sessionId: string): AgentSessionLookupResult {
    const session = this.findOrLoadSession(sessionId);
    return session ? { kind: "found", session } : { kind: "missing", sessionId };
  }

  hasPersistedSession(sessionId: string): boolean {
    return this.sessions.has(sessionId) || this.repository.hasSession(sessionId);
  }

  close(sessionId: string): AgentSessionCloseResult {
    const lookup = this.get(sessionId);
    if (lookup.kind === "missing") return lookup;
    if (!this.repository.deleteSession(sessionId)) {
      throw new Error(`Persisted session disappeared before close commit: ${sessionId}`);
    }
    this.evictWorkingSession(sessionId);
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

  listSessionMetadata(): AgentSession[] {
    return this.repository.listSessionMetadata().map((persisted) => {
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

  loadFirstUserMessage(sessionId: string): AgentConversationEntry | undefined {
    return this.repository.loadFirstUserMessage(sessionId);
  }

  captureHistorySnapshot(sessionId: string): AgentSessionHistoryView | undefined {
    return this.repository.captureHistorySnapshot(sessionId);
  }

  loadConversationPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentConversationEntry> {
    return this.repository.loadEntryPage(sessionId, request);
  }

  loadConversationEntriesForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughSequence: number,
  ): AgentConversationEntry[] {
    return this.repository.loadEntriesForRequests(sessionId, requestIds, throughSequence);
  }

  /** 读取某会话执行事件日志（用于右侧执行轨迹历史回放）。 */
  loadRunEvents(sessionId: string): AgentEventEnvelope[] {
    return this.repository.loadRunEvents(sessionId);
  }

  loadRunEventPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentEventEnvelope> {
    return this.repository.loadRunEventPage(sessionId, request);
  }

  loadRunEventsForRequest(sessionId: string, requestId: string): AgentEventEnvelope[] {
    return this.repository.loadRunEventsForRequest(sessionId, requestId);
  }

  rename(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.repository.renameSession(sessionId, title);
      return;
    }
    session.metadata = { ...session.metadata, title };
    session.updatedAt = new Date().toISOString();
    this.repository.upsertSession(session);
  }

  /** 删除某 sessionId 从指定 requestId 起的所有 entries，并同步内存缓存 */
  truncateFromRequest(sessionId: string, requestId: string): number {
    const removed = this.repository.truncateFromRequest(sessionId, requestId);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.conversation = this.repository.loadEntries(sessionId);
      this.rememberNextSequence(sessionId, session.conversation.length);
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
    const baseSeq = this.resolveNextSequence(sessionId);
    const items = entries.map((entry, i) => ({ entry, sequence: baseSeq + i }));
    this.repository.appendEntries(sessionId, items);
    this.rememberNextSequence(sessionId, baseSeq + entries.length);
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
    const baseSeq = this.resolveNextSequence(sessionId);
    const entryItems = entries.map((entry, i) => ({ entry, sequence: baseSeq + i }));
    const traceItems = traces.map((trace) => ({ requestId, turnSequence: baseSeq, trace }));
    this.repository.persistTurnArtifacts(sessionId, entryItems, traceItems);
    this.rememberNextSequence(sessionId, baseSeq + entries.length);
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
    const baseSeq = this.resolveNextSequence(sessionId);
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
      commandId: requestId,
    };
    this.repository.persistTurnCommit(commit);
    this.rememberNextSequence(sessionId, baseSeq + entries.length);
  }

  persistRunStart(
    session: AgentSession,
    requestId: string,
    userEntry: AgentConversationEntry,
    snapshot: StoredRunSnapshot,
    event: AgentDomainEvent,
    command: AgentSessionCommandDescriptor,
  ): AgentSessionCommandAdmission {
    const baseSeq = this.resolveNextSequence(session.id);
    const admission = this.repository.beginRun(command, {
      sessionId: session.id,
      requestId,
      session,
      entries: [{ entry: userEntry, sequence: baseSeq }],
      traces: [],
      snapshot,
      runEvents: this.projectDurableEvents(session.id, requestId, [event]),
    });
    if (admission.kind === "accepted") this.rememberNextSequence(session.id, baseSeq + 1);
    return admission;
  }

  loadCommand(sessionId: string, commandId: string): AgentSessionCommandRecord | undefined {
    return this.repository.loadCommand(sessionId, commandId);
  }

  /** 读取某会话所有 step 轨迹，按轮次分组（回放重建执行图用） */
  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    return this.repository.loadStepTraces(sessionId);
  }

  loadStepTracePage(
    sessionId: string,
    request: AgentStepTracePageRequest,
  ): AgentSessionCursorPage<StoredStepTraceRun, AgentStepTraceCursor> {
    return this.repository.loadStepTracePage(sessionId, request);
  }

  loadStepTraceRequestIds(sessionId: string, requestIds: readonly string[], throughRowId: number): string[] {
    return this.repository.loadStepTraceRequestIds(sessionId, requestIds, throughRowId);
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

  loadRunSnapshotsForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughSequence: number,
  ): StoredRunSnapshot[] {
    return this.repository.loadRunSnapshotsForRequests(sessionId, requestIds, throughSequence);
  }

  loadRunSnapshotPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<StoredRunSnapshot> {
    return this.repository.loadRunSnapshotPage(sessionId, request);
  }

  loadRunningRunSnapshots(): StoredRunSnapshot[] {
    return this.repository.loadRunningRunSnapshots();
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

    this.cacheWorkingSession(session, 0);
    this.repository.upsertSession(session);
    return session;
  }

  private findOrLoadSession(sessionId: string): AgentSession | undefined {
    const current = this.sessions.get(sessionId);
    if (current) {
      this.touchWorkingSession(sessionId, current);
      return current;
    }

    const snapshot = this.repository.captureHistorySnapshot(sessionId);
    if (!snapshot) return undefined;
    const session: AgentSession = {
      ...snapshot.session,
      conversation: this.repository.loadEntries(sessionId),
    };
    this.cacheWorkingSession(session, snapshot.entryCount);
    return session;
  }

  private resolveNextSequence(sessionId: string): number {
    const current = this.sequenceBySession.get(sessionId);
    if (current !== undefined) return current;
    const next = this.repository.captureHistorySnapshot(sessionId)?.entryCount ?? 0;
    this.rememberNextSequence(sessionId, next);
    return next;
  }

  private cacheWorkingSession(session: AgentSession, nextSequence: number): void {
    this.sessions.delete(session.id);
    this.sessions.set(session.id, session);
    this.sequenceBySession.set(session.id, nextSequence);
    this.trimWorkingSetExcept(session.id);
  }

  private touchWorkingSession(sessionId: string, session: AgentSession): void {
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, session);
    this.trimWorkingSetExcept(sessionId);
  }

  private rememberNextSequence(sessionId: string, nextSequence: number): void {
    if (this.sessions.has(sessionId)) this.sequenceBySession.set(sessionId, nextSequence);
    else this.sequenceBySession.delete(sessionId);
  }

  private evictWorkingSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.sequenceBySession.delete(sessionId);
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
