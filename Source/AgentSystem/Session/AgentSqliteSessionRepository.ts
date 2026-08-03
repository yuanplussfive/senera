import type Database from "better-sqlite3";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import { parseJsonObject } from "../SessionPersistence/AgentSessionCodec.js";
import type { AgentSession } from "./AgentSession.js";
import {
  createAgentUserProfile,
  createDefaultAgentUserProfile,
  parseStoredAgentUserProfile,
  type AgentUserProfile,
  type AgentUserProfileInput,
} from "../Session/AgentUserProfile.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentSessionDatabaseContract } from "../SessionPersistence/AgentSessionSqlSchema.js";
import {
  prepareAgentSessionSqlStatements,
  type AgentSessionSqlStatements,
} from "../SessionPersistence/AgentSessionSqlStatements.js";
import { deriveAgentSessionTitle, rowToAgentSession } from "./AgentSqliteSessionMapper.js";
import {
  AgentSqliteSessionHistoryStore,
  type AgentSqliteSessionEntryDecodeIssueSink,
} from "./AgentSqliteSessionHistoryStore.js";
import type {
  AgentSessionForkSnapshot,
  AgentSessionForkHistory,
  AgentSessionCursorPage,
  AgentSessionCursorPageRequest,
  AgentSessionHistoryView,
  AgentSessionRepository,
  AgentStepTraceCursor,
  AgentStepTracePageRequest,
  AgentSessionTurnCommit,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "./AgentSessionRepository.js";
import {
  AgentSessionHistoryMutationKinds,
  AgentSessionPiMutationKinds,
  type AgentSessionHistoryMutation,
} from "./AgentSessionHistoryMutation.js";
import type { SessionHistoryMutationRow } from "../SessionPersistence/AgentSessionSqlRows.js";
import type { SessionForkMutationRow } from "../SessionPersistence/AgentSessionSqlRows.js";
import type { SessionCommandRow } from "../SessionPersistence/AgentSessionSqlRows.js";
import { AgentSessionForkPiMutationKinds, type AgentSessionForkMutation } from "./AgentSessionForkMutation.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import {
  AgentSessionCommandStates,
  assertMatchingAgentSessionCommand,
  type AgentSessionCommandAdmission,
  type AgentSessionCommandDescriptor,
  type AgentSessionCommandRecord,
} from "./AgentSessionCommand.js";

export { InMemorySessionRepository } from "../SessionPersistence/InMemorySessionRepository.js";
export type {
  AgentSessionForkSnapshot,
  AgentSessionRepository,
  AgentSessionTurnCommit,
  StoredRunSnapshot,
  StoredRunSnapshotStatus,
  StoredStepTraceRun,
} from "./AgentSessionRepository.js";

const USER_PROFILE_SETTING_KEY = "user.profile";

export type AgentSessionEntryDecodeIssueSink = AgentSqliteSessionEntryDecodeIssueSink;

export class SqliteSessionRepository implements AgentSessionRepository {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly db: Database.Database;
  private readonly stmts: AgentSessionSqlStatements;
  private readonly history: AgentSqliteSessionHistoryStore;

  constructor(
    databasePath: string,
    upgradeSession?: AgentUpgradeSession,
    onDecodeIssue?: AgentSessionEntryDecodeIssueSink,
  ) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentSessionDatabaseContract,
      upgradeSession,
    });
    this.db = this.kernel.connection;
    this.stmts = prepareAgentSessionSqlStatements(this.db);
    this.history = new AgentSqliteSessionHistoryStore(this.db, this.stmts, onDecodeIssue);
  }

  // ---- 接口实现 ----

  listSessions(): Array<AgentSession & { entryCount: number; messageCount: number }> {
    return this.stmts.selectSessionList.all().map((row) => ({
      ...rowToAgentSession(row),
      conversation: [], // listSessions 不带 conversation——重视性能
      entryCount: row.entry_count,
      messageCount: row.message_count,
    }));
  }

  listSessionMetadata(): AgentSession[] {
    return this.stmts.selectSessionMetadata.all().map((row) => ({
      ...rowToAgentSession(row),
      conversation: [],
    }));
  }

  hasSession(sessionId: string): boolean {
    return Boolean(this.stmts.selectSession.get(sessionId));
  }

  loadSession(sessionId: string): AgentSession | undefined {
    const row = this.stmts.selectSession.get(sessionId);
    if (!row) return undefined;
    const session = rowToAgentSession(row);
    session.conversation = this.loadEntries(sessionId);
    return session;
  }

  captureHistorySnapshot(sessionId: string): AgentSessionHistoryView | undefined {
    return this.history.captureSnapshot(sessionId);
  }

  listPendingHistoryMutations(): AgentSessionHistoryMutation[] {
    return this.stmts.selectPendingHistoryMutations.all().map(rowToHistoryMutation);
  }

  loadPendingHistoryMutation(sessionId: string): AgentSessionHistoryMutation | undefined {
    const row = this.stmts.selectPendingHistoryMutation.get(sessionId);
    return row ? rowToHistoryMutation(row) : undefined;
  }

  stageHistoryMutation(mutation: AgentSessionHistoryMutation): void {
    this.stmts.stageHistoryMutation.run({
      mutation_id: mutation.mutationId,
      session_id: mutation.sessionId,
      kind: mutation.kind,
      from_request_id: mutation.fromRequestId,
      pi_kind: mutation.pi.kind,
      pi_entry_id: mutation.pi.kind === AgentSessionPiMutationKinds.Rewind ? mutation.pi.entryId : null,
      model_provider_id:
        mutation.pi.kind === AgentSessionPiMutationKinds.None ? null : (mutation.pi.modelProviderId ?? null),
      created_at: mutation.createdAt,
    });
  }

  commitHistoryMutation(mutationId: string, session: AgentSession): number {
    return this.db.transaction(() => {
      const row = this.stmts.selectPendingHistoryMutation.get(session.id);
      if (!row || row.mutation_id !== mutationId) {
        throw new Error(`Pending session history mutation does not match: ${session.id}`);
      }

      const removed = this.history.deleteFromRequest(session.id, row.from_request_id);
      this.upsertSession(session);
      const deleted = this.stmts.deleteHistoryMutation.run(session.id, mutationId);
      if (deleted.changes !== 1) {
        throw new Error(`Pending session history mutation disappeared during commit: ${session.id}`);
      }
      return removed;
    })();
  }

  listPendingForkMutations(): AgentSessionForkMutation[] {
    return this.stmts.selectPendingForkMutations.all().map(rowToForkMutation);
  }

  loadPendingForkMutation(targetSessionId: string): AgentSessionForkMutation | undefined {
    const row = this.stmts.selectPendingForkMutation.get(targetSessionId);
    return row ? rowToForkMutation(row) : undefined;
  }

  stageForkMutation(mutation: AgentSessionForkMutation): void {
    this.db.transaction(() => {
      if (!this.stmts.selectSession.get(mutation.sourceSessionId)) {
        throw new Error(`Session fork source does not exist: ${mutation.sourceSessionId}`);
      }
      if (this.stmts.selectSession.get(mutation.targetSessionId)) {
        throw new Error(`Session fork target already exists: ${mutation.targetSessionId}`);
      }
      this.stmts.stageForkMutation.run({
        mutation_id: mutation.mutationId,
        source_session_id: mutation.sourceSessionId,
        target_session_id: mutation.targetSessionId,
        through_request_id: mutation.throughRequestId,
        pi_kind: mutation.pi.kind,
        pi_entry_id: mutation.pi.kind === AgentSessionForkPiMutationKinds.Fork ? mutation.pi.entryId : null,
        model_provider_id:
          mutation.pi.kind === AgentSessionForkPiMutationKinds.Fork ? (mutation.pi.modelProviderId ?? null) : null,
        created_at: mutation.createdAt,
      });
    })();
  }

  commitForkMutation(mutationId: string, snapshot: AgentSessionForkSnapshot): void {
    this.db.transaction(() => {
      const row = this.stmts.selectPendingForkMutation.get(snapshot.session.id);
      if (!row || row.mutation_id !== mutationId) {
        throw new Error(`Pending session fork mutation does not match: ${snapshot.session.id}`);
      }
      this.persistForkSnapshot(snapshot);
      const deleted = this.stmts.deleteForkMutation.run(snapshot.session.id, mutationId);
      if (deleted.changes !== 1) {
        throw new Error(`Pending session fork mutation disappeared during commit: ${snapshot.session.id}`);
      }
    })();
  }

  abortForkMutation(targetSessionId: string, mutationId: string): boolean {
    return this.stmts.deleteForkMutation.run(targetSessionId, mutationId).changes === 1;
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
    this.db.transaction(() => this.persistForkSnapshot(snapshot))();
  }

  private persistForkSnapshot(fork: AgentSessionForkSnapshot): void {
    if (this.stmts.selectSession.get(fork.session.id)) {
      throw new Error(`Session fork target already exists: ${fork.session.id}`);
    }

    this.upsertSession(fork.session);
    this.history.persistForkHistory(fork);
  }

  upsertSession(session: AgentSession): void {
    this.stmts.upsertSession.run({
      id: session.id,
      title: deriveAgentSessionTitle(session),
      status: session.status,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      active_request_id: session.activeRequest?.requestId ?? null,
      metadata: JSON.stringify(session.metadata ?? {}),
    });
  }

  appendEntry(sessionId: string, entry: AgentConversationEntry, sequence: number): void {
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
    const persist = this.db.transaction(() => {
      this.persistTurnCommitData(commit);
      if (commit.commandId) {
        const updated = this.stmts.updateSessionCommandState.run({
          session_id: commit.sessionId,
          command_id: commit.commandId,
          request_id: commit.requestId,
          state: commandStateForSnapshot(commit.snapshot.status),
          updated_at: commit.snapshot.updatedAt,
        });
        if (updated.changes !== 1) {
          throw new Error(
            `Session command receipt disappeared during turn commit: ${commit.sessionId}/${commit.commandId}`,
          );
        }
      }
    });
    persist.immediate();
  }

  beginRun(command: AgentSessionCommandDescriptor, commit: AgentSessionTurnCommit): AgentSessionCommandAdmission {
    const begin = this.db.transaction((): AgentSessionCommandAdmission => {
      const existing = this.loadCommand(commit.sessionId, command.commandId);
      if (existing) {
        assertMatchingAgentSessionCommand(existing, command);
        return { kind: "replayed", command: existing };
      }

      this.stmts.insertSessionCommand.run({
        session_id: commit.sessionId,
        command_id: command.commandId,
        operation_kind: command.operationKind,
        payload_hash: command.payloadHash,
        request_id: command.requestId,
        created_at: command.createdAt,
        updated_at: command.createdAt,
      });
      this.persistTurnCommitData(commit);
      return {
        kind: "accepted",
        command: {
          ...command,
          sessionId: commit.sessionId,
          state: AgentSessionCommandStates.Running,
          updatedAt: command.createdAt,
        },
      };
    });
    return begin.immediate();
  }

  loadCommand(sessionId: string, commandId: string): AgentSessionCommandRecord | undefined {
    const row = this.stmts.selectSessionCommand.get(sessionId, commandId);
    return row ? rowToSessionCommand(row) : undefined;
  }

  truncateFromRequest(sessionId: string, requestId: string): number {
    return this.db.transaction(() => this.deleteHistoryFromRequest(sessionId, requestId))();
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

  private deleteHistoryFromRequest(sessionId: string, requestId: string): number {
    this.stmts.deleteSessionCommandsFrom.run(sessionId, sessionId, sessionId, requestId);
    return this.history.deleteFromRequest(sessionId, requestId);
  }

  private persistTurnCommitData(commit: AgentSessionTurnCommit): void {
    if (commit.session) {
      this.stmts.upsertSession.run({
        id: commit.session.id,
        title: deriveAgentSessionTitle(commit.session),
        status: commit.session.status,
        created_at: commit.session.createdAt,
        updated_at: commit.session.updatedAt,
        active_request_id: commit.session.activeRequest?.requestId ?? null,
        metadata: JSON.stringify(commit.session.metadata ?? {}),
      });
    }
    this.history.persistTurnCommitArtifacts(commit);
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
    this.stmts.renameSession.run(title, new Date().toISOString(), sessionId);
  }

  deleteSession(sessionId: string): boolean {
    const info = this.stmts.deleteSession.run(sessionId);
    return info.changes > 0;
  }

  deleteEntriesFrom(sessionId: string, requestId: string): number {
    return this.history.deleteEntriesFrom(sessionId, requestId);
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

  loadUserProfile(): AgentUserProfile {
    const row = this.stmts.selectSetting.get(USER_PROFILE_SETTING_KEY);
    if (!row) return createDefaultAgentUserProfile();
    return parseStoredAgentUserProfile(parseJsonObject(row.value), row.updated_at);
  }

  saveUserProfile(profile: AgentUserProfileInput): AgentUserProfile {
    const updatedAt = new Date().toISOString();
    const snapshot = createAgentUserProfile(profile, updatedAt);
    this.stmts.upsertSetting.run({
      key: USER_PROFILE_SETTING_KEY,
      value: JSON.stringify(snapshot),
      updated_at: updatedAt,
    });
    return snapshot;
  }

  close(): void {
    this.kernel.close();
  }
}

function rowToSessionCommand(row: SessionCommandRow): AgentSessionCommandRecord {
  return {
    sessionId: row.session_id,
    commandId: row.command_id,
    operationKind: row.operation_kind,
    payloadHash: row.payload_hash,
    requestId: row.request_id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function rowToHistoryMutation(row: SessionHistoryMutationRow): AgentSessionHistoryMutation {
  const base = {
    mutationId: row.mutation_id,
    kind: AgentSessionHistoryMutationKinds.Truncate,
    sessionId: row.session_id,
    fromRequestId: row.from_request_id,
    createdAt: row.created_at,
  } as const;

  switch (row.pi_kind) {
    case AgentSessionPiMutationKinds.None:
      return { ...base, pi: { kind: AgentSessionPiMutationKinds.None } };
    case AgentSessionPiMutationKinds.Reset:
      return {
        ...base,
        pi: { kind: AgentSessionPiMutationKinds.Reset, modelProviderId: row.model_provider_id ?? undefined },
      };
    case AgentSessionPiMutationKinds.Rewind:
      if (!row.pi_entry_id) throw new Error(`Rewind history mutation is missing its Pi entry: ${row.mutation_id}`);
      return {
        ...base,
        pi: {
          kind: AgentSessionPiMutationKinds.Rewind,
          entryId: row.pi_entry_id,
          modelProviderId: row.model_provider_id ?? undefined,
        },
      };
    default:
      throw new Error(`Unsupported Pi history mutation kind: ${row.pi_kind}`);
  }
}

function rowToForkMutation(row: SessionForkMutationRow): AgentSessionForkMutation {
  const base = {
    mutationId: row.mutation_id,
    sourceSessionId: row.source_session_id,
    targetSessionId: row.target_session_id,
    throughRequestId: row.through_request_id,
    createdAt: row.created_at,
  } as const;
  switch (row.pi_kind) {
    case AgentSessionForkPiMutationKinds.None:
      return { ...base, pi: { kind: AgentSessionForkPiMutationKinds.None } };
    case AgentSessionForkPiMutationKinds.Fork:
      if (!row.pi_entry_id) throw new Error(`Fork mutation is missing its Pi entry: ${row.mutation_id}`);
      return {
        ...base,
        pi: {
          kind: AgentSessionForkPiMutationKinds.Fork,
          entryId: row.pi_entry_id,
          modelProviderId: row.model_provider_id ?? undefined,
        },
      };
    default:
      throw new Error(`Unsupported Pi fork mutation kind: ${row.pi_kind}`);
  }
}
