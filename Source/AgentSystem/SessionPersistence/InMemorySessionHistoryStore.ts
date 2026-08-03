import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { AgentSession } from "../Session/AgentSession.js";
import type {
  AgentSessionCursorPage,
  AgentSessionCursorPageRequest,
  AgentSessionForkHistory,
  AgentSessionForkSnapshot,
  AgentSessionHistoryView,
  AgentSessionTurnCommit,
  AgentStepTraceCursor,
  AgentStepTracePageRequest,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "../Session/AgentSessionRepository.js";
import { InMemorySessionEntryStore } from "./InMemorySessionEntryStore.js";
import { InMemorySessionRunHistoryStore } from "./InMemorySessionRunHistoryStore.js";
import { InMemorySessionTraceStore } from "./InMemorySessionTraceStore.js";

export class InMemorySessionHistoryStore {
  private readonly entries = new InMemorySessionEntryStore();
  private readonly traces = new InMemorySessionTraceStore();
  private readonly runs = new InMemorySessionRunHistoryStore();

  entryCount(sessionId: string): number {
    return this.entries.entryCount(sessionId);
  }

  messageCount(sessionId: string): number {
    return this.entries.messageCount(sessionId);
  }

  captureSnapshot(session: AgentSession): AgentSessionHistoryView {
    return {
      session: { ...session, conversation: [] },
      entryCount: this.entries.entryCount(session.id),
      messageCount: this.entries.messageCount(session.id),
      entryHighWaterMark: this.entries.highWaterMark(session.id),
      stepTraceHighWaterMark: this.traces.highWaterMark(session.id),
      runSnapshotHighWaterMark: this.runs.snapshotHighWaterMark(session.id),
      runEventHighWaterMark: this.runs.eventHighWaterMark(session.id),
    };
  }

  hasRequest(sessionId: string, requestId: string): boolean {
    return this.entries.hasRequest(sessionId, requestId);
  }

  loadRequestIdsFrom(sessionId: string, requestId: string): string[] {
    return this.entries.requestIdsFrom(sessionId, requestId);
  }

  loadForkHistoryThroughRequest(sessionId: string, requestId: string): AgentSessionForkHistory | undefined {
    const prefix = this.entries.prefixThroughRequest(sessionId, requestId);
    if (!prefix) return undefined;
    return {
      entries: prefix.entries,
      traces: this.traces.forkItems(sessionId, prefix.requestIds),
      ...this.runs.forkHistory(sessionId, prefix.requestIds),
    };
  }

  installFork(snapshot: AgentSessionForkSnapshot): void {
    const sessionId = snapshot.session.id;
    this.entries.install(
      sessionId,
      snapshot.entries.map(({ entry }) => structuredClone(entry)),
    );
    this.traces.append(
      sessionId,
      snapshot.traces.map((item) => structuredClone(item)),
    );
    this.runs.installForkHistory(sessionId, {
      runSnapshots: snapshot.runSnapshots,
      turnPreparations: snapshot.turnPreparations,
      runEvents: snapshot.runEvents,
    });
  }

  loadEntries(sessionId: string): AgentConversationEntry[] {
    return this.entries.load(sessionId);
  }

  loadFirstUserMessage(sessionId: string): AgentConversationEntry | undefined {
    return this.entries.loadFirstUserMessage(sessionId);
  }

  loadEntryPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentConversationEntry> {
    return this.entries.loadPage(sessionId, request);
  }

  loadEntriesForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughSequence: number,
  ): AgentConversationEntry[] {
    return this.entries.loadForRequests(sessionId, requestIds, throughSequence);
  }

  assertCanAppendEntries(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
  ): void {
    this.entries.assertCanAppend(sessionId, entries);
  }

  appendEntry(sessionId: string, entry: AgentConversationEntry, sequence?: number): void {
    this.entries.append(sessionId, entry, sequence);
  }

  appendEntries(sessionId: string, entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>): void {
    this.entries.appendMany(sessionId, entries);
  }

  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    this.appendEntries(sessionId, entries);
    this.traces.append(sessionId, traces);
  }

  persistTurnCommitArtifacts(commit: AgentSessionTurnCommit): void {
    const entries = commit.entries.map(({ entry, sequence }) => ({ entry: structuredClone(entry), sequence }));
    const traces = commit.traces.map((item) => structuredClone(item));
    const snapshot = structuredClone(commit.snapshot);
    const events = commit.runEvents.map((event) => structuredClone(event));
    for (const { entry, sequence } of entries) this.appendEntry(commit.sessionId, entry, sequence);
    this.traces.append(commit.sessionId, traces);
    this.upsertRunSnapshot(snapshot);
    this.appendRunEvents(commit.sessionId, events);
  }

  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    return this.traces.load(sessionId);
  }

  loadStepTracePage(
    sessionId: string,
    request: AgentStepTracePageRequest,
  ): AgentSessionCursorPage<StoredStepTraceRun, AgentStepTraceCursor> {
    return this.traces.loadPage(sessionId, request);
  }

  loadStepTraceRequestIds(sessionId: string, requestIds: readonly string[], throughRowId: number): string[] {
    return this.traces.loadRequestIds(sessionId, requestIds, throughRowId);
  }

  deleteStepTracesFrom(sessionId: string, requestId: string): number {
    return this.traces.deleteFromSequence(sessionId, this.entries.firstSequence(sessionId, requestId));
  }

  upsertRunSnapshot(snapshot: StoredRunSnapshot): void {
    this.runs.upsertSnapshot(snapshot);
  }

  loadRunSnapshots(sessionId: string): StoredRunSnapshot[] {
    return this.runs.loadSnapshots(sessionId);
  }

  loadRunSnapshotsForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughRevision: number,
  ): StoredRunSnapshot[] {
    return this.runs.loadSnapshotsForRequests(sessionId, requestIds, throughRevision);
  }

  loadRunSnapshotPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<StoredRunSnapshot> {
    return this.runs.loadSnapshotPage(sessionId, request);
  }

  loadRunningRunSnapshots(): StoredRunSnapshot[] {
    return this.runs.loadRunningSnapshots();
  }

  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number {
    return this.runs.deleteSnapshotsFrom(
      sessionId,
      requestId,
      new Set(this.entries.requestIdsFrom(sessionId, requestId)),
    );
  }

  upsertTurnPreparation(sessionId: string, requestId: string, snapshot: AgentTurnPreparationSnapshot): void {
    this.runs.upsertPreparation(sessionId, requestId, snapshot);
  }

  loadTurnPreparation(sessionId: string, requestId: string): AgentTurnPreparationSnapshot | undefined {
    return this.runs.loadPreparation(sessionId, requestId);
  }

  deleteTurnPreparationsFrom(sessionId: string, requestId: string): number {
    return this.runs.deletePreparations(sessionId, new Set(this.entries.requestIdsFrom(sessionId, requestId)));
  }

  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void {
    this.runs.appendEvent(sessionId, event);
  }

  appendRunEvents(sessionId: string, events: readonly AgentEventEnvelope[]): void {
    this.runs.appendEvents(sessionId, events);
  }

  loadRunEvents(sessionId: string): AgentEventEnvelope[] {
    return this.runs.loadEvents(sessionId);
  }

  loadRunEventsForRequest(sessionId: string, requestId: string): AgentEventEnvelope[] {
    return this.runs.loadEventsForRequest(sessionId, requestId);
  }

  loadRunEventPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentEventEnvelope> {
    return this.runs.loadEventPage(sessionId, request);
  }

  deleteRunEventsFrom(sessionId: string, requestId: string): number {
    return this.runs.deleteEvents(sessionId, new Set(this.entries.requestIdsFrom(sessionId, requestId)));
  }

  deleteEntriesFrom(sessionId: string, requestId: string): number {
    return this.entries.deleteFrom(sessionId, requestId);
  }

  deleteFromRequest(sessionId: string, requestId: string): number {
    this.deleteStepTracesFrom(sessionId, requestId);
    this.deleteRunEventsFrom(sessionId, requestId);
    this.deleteRunSnapshotsFrom(sessionId, requestId);
    this.deleteTurnPreparationsFrom(sessionId, requestId);
    return this.deleteEntriesFrom(sessionId, requestId);
  }

  deleteSession(sessionId: string): void {
    this.entries.deleteSession(sessionId);
    this.traces.deleteSession(sessionId);
    this.runs.deleteSession(sessionId);
  }
}
