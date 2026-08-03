import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import {
  createAgentUserProfile,
  createDefaultAgentUserProfile,
  type AgentUserProfile,
  type AgentUserProfileInput,
} from "../Session/AgentUserProfile.js";
import type { AgentSession } from "../Session/AgentSession.js";
import {
  AgentSessionCommandStates,
  assertMatchingAgentSessionCommand,
  type AgentSessionCommandAdmission,
  type AgentSessionCommandDescriptor,
  type AgentSessionCommandRecord,
} from "../Session/AgentSessionCommand.js";
import type { AgentSessionForkMutation } from "../Session/AgentSessionForkMutation.js";
import type { AgentSessionHistoryMutation } from "../Session/AgentSessionHistoryMutation.js";
import type {
  AgentSessionCursorPage,
  AgentSessionCursorPageRequest,
  AgentSessionForkHistory,
  AgentSessionForkSnapshot,
  AgentSessionHistoryView,
  AgentSessionRepository,
  AgentSessionTurnCommit,
  AgentStepTraceCursor,
  AgentStepTracePageRequest,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "../Session/AgentSessionRepository.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import { InMemorySessionHistoryStore } from "./InMemorySessionHistoryStore.js";

export class InMemorySessionRepository implements AgentSessionRepository {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly history = new InMemorySessionHistoryStore();
  private readonly historyMutations = new Map<string, AgentSessionHistoryMutation>();
  private readonly forkMutations = new Map<string, AgentSessionForkMutation>();
  private readonly commands = new Map<string, Map<string, AgentSessionCommandRecord>>();
  private userProfile = createDefaultAgentUserProfile();

  listSessions(): Array<AgentSession & { entryCount: number; messageCount: number }> {
    return Array.from(this.sessions.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => ({
        ...session,
        conversation: [],
        entryCount: this.history.entryCount(session.id),
        messageCount: this.history.messageCount(session.id),
      }));
  }

  listSessionMetadata(): AgentSession[] {
    return Array.from(this.sessions.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => ({ ...session, conversation: [] }));
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  loadSession(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { ...session, conversation: this.history.loadEntries(sessionId) } : undefined;
  }

  captureHistorySnapshot(sessionId: string): AgentSessionHistoryView | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.history.captureSnapshot(session) : undefined;
  }

  listPendingHistoryMutations(): AgentSessionHistoryMutation[] {
    return [...this.historyMutations.values()]
      .map((mutation) => structuredClone(mutation))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  loadPendingHistoryMutation(sessionId: string): AgentSessionHistoryMutation | undefined {
    const mutation = this.historyMutations.get(sessionId);
    return mutation ? structuredClone(mutation) : undefined;
  }

  stageHistoryMutation(mutation: AgentSessionHistoryMutation): void {
    if (this.historyMutations.has(mutation.sessionId)) {
      throw new Error(`Session already has a pending history mutation: ${mutation.sessionId}`);
    }
    this.historyMutations.set(mutation.sessionId, structuredClone(mutation));
  }

  commitHistoryMutation(mutationId: string, session: AgentSession): number {
    const mutation = this.historyMutations.get(session.id);
    if (!mutation || mutation.mutationId !== mutationId) {
      throw new Error(`Pending session history mutation does not match: ${session.id}`);
    }
    const removed = this.deleteHistoryFromRequest(session.id, mutation.fromRequestId);
    this.upsertSession(session);
    this.historyMutations.delete(session.id);
    return removed;
  }

  listPendingForkMutations(): AgentSessionForkMutation[] {
    return [...this.forkMutations.values()]
      .map((mutation) => structuredClone(mutation))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  loadPendingForkMutation(targetSessionId: string): AgentSessionForkMutation | undefined {
    const mutation = this.forkMutations.get(targetSessionId);
    return mutation ? structuredClone(mutation) : undefined;
  }

  stageForkMutation(mutation: AgentSessionForkMutation): void {
    if (!this.sessions.has(mutation.sourceSessionId)) {
      throw new Error(`Session fork source does not exist: ${mutation.sourceSessionId}`);
    }
    if (this.sessions.has(mutation.targetSessionId)) {
      throw new Error(`Session fork target already exists: ${mutation.targetSessionId}`);
    }
    if (this.forkMutations.has(mutation.targetSessionId)) {
      throw new Error(`Session already has a pending fork mutation: ${mutation.targetSessionId}`);
    }
    this.forkMutations.set(mutation.targetSessionId, structuredClone(mutation));
  }

  commitForkMutation(mutationId: string, snapshot: AgentSessionForkSnapshot): void {
    const mutation = this.forkMutations.get(snapshot.session.id);
    if (!mutation || mutation.mutationId !== mutationId) {
      throw new Error(`Pending session fork mutation does not match: ${snapshot.session.id}`);
    }
    this.createFork(snapshot);
    this.forkMutations.delete(snapshot.session.id);
  }

  abortForkMutation(targetSessionId: string, mutationId: string): boolean {
    const mutation = this.forkMutations.get(targetSessionId);
    if (!mutation || mutation.mutationId !== mutationId) return false;
    return this.forkMutations.delete(targetSessionId);
  }

  hasRequest(sessionId: string, requestId: string): boolean {
    return this.history.hasRequest(sessionId, requestId);
  }

  loadRequestIdsFrom(sessionId: string, requestId: string): string[] {
    return this.history.loadRequestIdsFrom(sessionId, requestId);
  }

  loadForkHistoryThroughRequest(sessionId: string, requestId: string): AgentSessionForkHistory | undefined {
    return this.history.loadForkHistoryThroughRequest(sessionId, requestId);
  }

  loadEntries(sessionId: string): AgentConversationEntry[] {
    return this.history.loadEntries(sessionId);
  }

  loadFirstUserMessage(sessionId: string): AgentConversationEntry | undefined {
    return this.history.loadFirstUserMessage(sessionId);
  }

  loadEntryPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentConversationEntry> {
    return this.history.loadEntryPage(sessionId, request);
  }

  loadEntriesForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughSequence: number,
  ): AgentConversationEntry[] {
    return this.history.loadEntriesForRequests(sessionId, requestIds, throughSequence);
  }

  createFork(snapshot: AgentSessionForkSnapshot): void {
    const sessionId = snapshot.session.id;
    if (this.sessions.has(sessionId)) throw new Error(`Session fork target already exists: ${sessionId}`);
    this.sessions.set(sessionId, structuredClone({ ...snapshot.session, conversation: [] }));
    this.history.installFork(snapshot);
  }

  upsertSession(session: AgentSession): void {
    this.sessions.set(session.id, { ...session, conversation: [] });
  }

  appendEntry(sessionId: string, entry: AgentConversationEntry, sequence?: number): void {
    this.history.appendEntry(sessionId, entry, sequence);
  }

  appendEntries(sessionId: string, entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>): void {
    this.history.appendEntries(sessionId, entries);
  }

  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    this.history.persistTurnArtifacts(sessionId, entries, traces);
  }

  persistTurnCommit(commit: AgentSessionTurnCommit): void {
    this.history.assertCanAppendEntries(commit.sessionId, commit.entries);
    const nextSession = commit.session ? structuredClone({ ...commit.session, conversation: [] }) : undefined;
    let nextCommands: Map<string, AgentSessionCommandRecord> | undefined;
    if (commit.commandId) {
      const commands = this.commands.get(commit.sessionId);
      const existing = commands?.get(commit.commandId);
      if (!existing || existing.requestId !== commit.requestId) {
        throw new Error(
          `Session command receipt disappeared during turn commit: ${commit.sessionId}/${commit.commandId}`,
        );
      }
      nextCommands = new Map(
        [...commands!.entries()].map(([commandId, command]) => [commandId, structuredClone(command)]),
      );
      nextCommands.set(commit.commandId, {
        ...existing,
        state: commandStateForSnapshot(commit.snapshot.status),
        updatedAt: commit.snapshot.updatedAt,
      });
    }

    if (nextSession) this.sessions.set(commit.sessionId, nextSession);
    this.history.persistTurnCommitArtifacts(commit);
    if (nextCommands) this.commands.set(commit.sessionId, nextCommands);
  }

  beginRun(command: AgentSessionCommandDescriptor, commit: AgentSessionTurnCommit): AgentSessionCommandAdmission {
    const existing = this.loadCommand(commit.sessionId, command.commandId);
    if (existing) {
      assertMatchingAgentSessionCommand(existing, command);
      return { kind: "replayed", command: existing };
    }
    this.history.assertCanAppendEntries(commit.sessionId, commit.entries);
    const record: AgentSessionCommandRecord = {
      ...command,
      sessionId: commit.sessionId,
      state: AgentSessionCommandStates.Running,
      updatedAt: command.createdAt,
    };
    const commands = this.commands.get(commit.sessionId) ?? new Map<string, AgentSessionCommandRecord>();
    commands.set(command.commandId, record);
    this.commands.set(commit.sessionId, commands);
    try {
      this.persistTurnCommit(commit);
    } catch (error) {
      commands.delete(command.commandId);
      if (commands.size === 0) this.commands.delete(commit.sessionId);
      throw error;
    }
    return { kind: "accepted", command: record };
  }

  loadCommand(sessionId: string, commandId: string): AgentSessionCommandRecord | undefined {
    const command = this.commands.get(sessionId)?.get(commandId);
    return command ? structuredClone(command) : undefined;
  }

  truncateFromRequest(sessionId: string, requestId: string): number {
    return this.deleteHistoryFromRequest(sessionId, requestId);
  }

  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    return this.history.loadStepTraces(sessionId);
  }

  loadStepTracePage(
    sessionId: string,
    request: AgentStepTracePageRequest,
  ): AgentSessionCursorPage<StoredStepTraceRun, AgentStepTraceCursor> {
    return this.history.loadStepTracePage(sessionId, request);
  }

  loadStepTraceRequestIds(sessionId: string, requestIds: readonly string[], throughRowId: number): string[] {
    return this.history.loadStepTraceRequestIds(sessionId, requestIds, throughRowId);
  }

  deleteStepTracesFrom(sessionId: string, requestId: string): number {
    return this.history.deleteStepTracesFrom(sessionId, requestId);
  }

  upsertRunSnapshot(snapshot: StoredRunSnapshot): void {
    this.history.upsertRunSnapshot(snapshot);
  }

  loadRunSnapshots(sessionId: string): StoredRunSnapshot[] {
    return this.history.loadRunSnapshots(sessionId);
  }

  loadRunSnapshotsForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughRevision: number,
  ): StoredRunSnapshot[] {
    return this.history.loadRunSnapshotsForRequests(sessionId, requestIds, throughRevision);
  }

  loadRunSnapshotPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<StoredRunSnapshot> {
    return this.history.loadRunSnapshotPage(sessionId, request);
  }

  loadRunningRunSnapshots(): StoredRunSnapshot[] {
    return this.history.loadRunningRunSnapshots();
  }

  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number {
    return this.history.deleteRunSnapshotsFrom(sessionId, requestId);
  }

  upsertTurnPreparation(sessionId: string, requestId: string, snapshot: AgentTurnPreparationSnapshot): void {
    this.history.upsertTurnPreparation(sessionId, requestId, snapshot);
  }

  loadTurnPreparation(sessionId: string, requestId: string): AgentTurnPreparationSnapshot | undefined {
    return this.history.loadTurnPreparation(sessionId, requestId);
  }

  deleteTurnPreparationsFrom(sessionId: string, requestId: string): number {
    return this.history.deleteTurnPreparationsFrom(sessionId, requestId);
  }

  renameSession(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      updatedAt: new Date().toISOString(),
      metadata: { ...session.metadata, title },
    });
  }

  deleteSession(sessionId: string): boolean {
    const had = this.sessions.delete(sessionId);
    this.history.deleteSession(sessionId);
    this.historyMutations.delete(sessionId);
    this.commands.delete(sessionId);
    return had;
  }

  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void {
    this.history.appendRunEvent(sessionId, event);
  }

  appendRunEvents(sessionId: string, events: readonly AgentEventEnvelope[]): void {
    this.history.appendRunEvents(sessionId, events);
  }

  loadRunEvents(sessionId: string): AgentEventEnvelope[] {
    return this.history.loadRunEvents(sessionId);
  }

  loadRunEventsForRequest(sessionId: string, requestId: string): AgentEventEnvelope[] {
    return this.history.loadRunEventsForRequest(sessionId, requestId);
  }

  loadRunEventPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentEventEnvelope> {
    return this.history.loadRunEventPage(sessionId, request);
  }

  deleteRunEventsFrom(sessionId: string, requestId: string): number {
    return this.history.deleteRunEventsFrom(sessionId, requestId);
  }

  deleteEntriesFrom(sessionId: string, requestId: string): number {
    const requestIds = this.history.loadRequestIdsFrom(sessionId, requestId);
    const removed = this.history.deleteEntriesFrom(sessionId, requestId);
    this.deleteCommandsForRequests(sessionId, requestIds);
    return removed;
  }

  loadUserProfile(): AgentUserProfile {
    return this.userProfile;
  }

  saveUserProfile(profile: AgentUserProfileInput): AgentUserProfile {
    this.userProfile = createAgentUserProfile(profile);
    return this.userProfile;
  }

  close(): void {}

  private deleteHistoryFromRequest(sessionId: string, requestId: string): number {
    this.history.deleteStepTracesFrom(sessionId, requestId);
    this.history.deleteRunEventsFrom(sessionId, requestId);
    this.history.deleteRunSnapshotsFrom(sessionId, requestId);
    this.history.deleteTurnPreparationsFrom(sessionId, requestId);
    return this.deleteEntriesFrom(sessionId, requestId);
  }

  private deleteCommandsForRequests(sessionId: string, requestIds: readonly string[]): void {
    if (requestIds.length === 0) return;
    const selected = new Set(requestIds);
    const commands = this.commands.get(sessionId);
    if (!commands) return;
    for (const command of commands.values()) {
      if (selected.has(command.requestId)) commands.delete(command.commandId);
    }
    if (commands.size === 0) this.commands.delete(sessionId);
  }
}

function commandStateForSnapshot(status: StoredRunSnapshot["status"]): AgentSessionCommandRecord["state"] {
  switch (status) {
    case "completed":
      return AgentSessionCommandStates.Completed;
    case "cancelled":
      return AgentSessionCommandStates.Cancelled;
    case "failed":
      return AgentSessionCommandStates.Failed;
    case "running":
      return AgentSessionCommandStates.Running;
  }
}
