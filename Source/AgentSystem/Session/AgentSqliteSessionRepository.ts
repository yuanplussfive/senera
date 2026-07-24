import type Database from "better-sqlite3";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import {
  entryToRow,
  parseJsonObject,
  parseStoredRunEvent,
  rowToEntry,
  rowToRunSnapshot,
  runSnapshotToRow,
} from "../SessionPersistence/AgentSessionCodec.js";
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
import { AgentSqliteSessionTraceStore } from "./AgentSqliteSessionTraceStore.js";
import type {
  AgentSessionForkSnapshot,
  AgentSessionRepository,
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
import {
  parseAgentTurnPreparationSnapshot,
  type AgentTurnPreparationSnapshot,
} from "../Loop/AgentTurnPreparationSnapshot.js";

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

export class SqliteSessionRepository implements AgentSessionRepository {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly db: Database.Database;
  private readonly stmts: AgentSessionSqlStatements;
  private readonly traces: AgentSqliteSessionTraceStore;

  constructor(databasePath: string) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentSessionDatabaseContract,
    });
    this.db = this.kernel.connection;
    this.stmts = prepareAgentSessionSqlStatements(this.db);
    this.traces = new AgentSqliteSessionTraceStore(this.db, this.stmts);
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

  loadSession(sessionId: string): AgentSession | undefined {
    const row = this.stmts.selectSession.get(sessionId);
    if (!row) return undefined;
    const session = rowToAgentSession(row);
    session.conversation = this.loadEntries(sessionId);
    return session;
  }

  loadAll(): AgentSession[] {
    return this.stmts.selectAllSessions.all().map((row) => {
      const session = rowToAgentSession(row);
      session.conversation = this.loadEntries(session.id);
      return session;
    });
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

      this.deleteStepTracesFrom(session.id, row.from_request_id);
      this.deleteRunEventsFrom(session.id, row.from_request_id);
      this.deleteRunSnapshotsFrom(session.id, row.from_request_id);
      this.deleteTurnPreparationsFrom(session.id, row.from_request_id);
      const removed = this.deleteEntriesFrom(session.id, row.from_request_id);
      this.upsertSession(session);
      const deleted = this.stmts.deleteHistoryMutation.run(session.id, mutationId);
      if (deleted.changes !== 1) {
        throw new Error(`Pending session history mutation disappeared during commit: ${session.id}`);
      }
      return removed;
    })();
  }

  loadEntries(sessionId: string): AgentConversationEntry[] {
    return this.stmts.selectEntries.all(sessionId).flatMap((row) => {
      const entry = rowToEntry(row);
      return entry ? [entry] : [];
    });
  }

  createFork(snapshot: AgentSessionForkSnapshot): void {
    const persist = this.db.transaction((fork: AgentSessionForkSnapshot) => {
      if (this.stmts.selectSession.get(fork.session.id)) {
        throw new Error(`Session fork target already exists: ${fork.session.id}`);
      }

      this.upsertSession(fork.session);
      for (const { entry, sequence } of fork.entries) {
        this.stmts.appendEntry.run(entryToRow(fork.session.id, entry, sequence));
      }
      for (const { requestId, turnSequence, trace } of fork.traces) {
        this.stmts.appendStepTrace.run({
          session_id: fork.session.id,
          request_id: requestId,
          turn_sequence: turnSequence,
          step: trace.step,
          seq: trace.seq,
          data: JSON.stringify(trace),
        });
      }
      for (const runSnapshot of fork.runSnapshots) {
        this.stmts.upsertRunSnapshot.run(runSnapshotToRow(runSnapshot));
      }
      const createdAt = new Date().toISOString();
      for (const preparation of fork.turnPreparations) {
        this.stmts.upsertTurnPreparation.run({
          session_id: fork.session.id,
          request_id: preparation.requestId,
          snapshot_json: JSON.stringify(preparation.snapshot),
          created_at: createdAt,
        });
      }
      for (const event of fork.runEvents) {
        if (!event.requestId) continue;
        this.stmts.appendRunEvent.run({
          session_id: fork.session.id,
          request_id: event.requestId,
          kind: event.kind,
          timestamp: event.timestamp,
          event_sequence: event.sequence,
          step: event.step ?? null,
          detail_id: event.detailId ?? null,
          event_id: resolveStoredEventId(event),
          reliability: "durable",
          event_json: JSON.stringify(event),
        });
      }
    });
    persist(snapshot);
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
    this.stmts.appendEntry.run(entryToRow(sessionId, entry, sequence));
  }

  appendEntries(sessionId: string, entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>): void {
    this.traces.appendEntries(sessionId, entries);
  }

  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    this.traces.persistTurnArtifacts(sessionId, entries, traces);
  }

  persistTurnCommit(commit: AgentSessionTurnCommit): void {
    const persist = this.db.transaction(() => {
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
      for (const { entry, sequence } of commit.entries) {
        this.stmts.appendEntry.run(entryToRow(commit.sessionId, entry, sequence));
      }
      for (const { requestId, turnSequence, trace } of commit.traces) {
        this.stmts.appendStepTrace.run({
          session_id: commit.sessionId,
          request_id: requestId,
          turn_sequence: turnSequence,
          step: trace.step,
          seq: trace.seq,
          data: JSON.stringify(trace),
        });
      }
      this.stmts.upsertRunSnapshot.run(runSnapshotToRow(commit.snapshot));
      for (const event of commit.runEvents) {
        if (!event.requestId) continue;
        const eventId = resolveStoredEventId(event);
        this.stmts.appendRunEvent.run({
          session_id: commit.sessionId,
          request_id: event.requestId,
          kind: event.kind,
          timestamp: event.timestamp,
          event_sequence: event.sequence,
          step: event.step ?? null,
          detail_id: event.detailId ?? null,
          event_id: eventId,
          reliability: "durable",
          event_json: JSON.stringify({ ...event, eventId }),
        });
      }
    });
    persist();
  }

  truncateFromRequest(sessionId: string, requestId: string): number {
    return this.db.transaction(() => this.deleteHistoryFromRequest(sessionId, requestId))();
  }

  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    return this.traces.loadStepTraces(sessionId);
  }

  deleteStepTracesFrom(sessionId: string, requestId: string): number {
    const info = this.stmts.deleteStepTracesFrom.run(sessionId, sessionId, requestId);
    return info.changes;
  }

  private deleteHistoryFromRequest(sessionId: string, requestId: string): number {
    this.deleteStepTracesFrom(sessionId, requestId);
    this.deleteRunEventsFrom(sessionId, requestId);
    this.deleteRunSnapshotsFrom(sessionId, requestId);
    this.deleteTurnPreparationsFrom(sessionId, requestId);
    return this.deleteEntriesFrom(sessionId, requestId);
  }

  upsertRunSnapshot(snapshot: StoredRunSnapshot): void {
    this.stmts.upsertRunSnapshot.run(runSnapshotToRow(snapshot));
  }

  loadRunSnapshots(sessionId: string): StoredRunSnapshot[] {
    return this.stmts.selectRunSnapshots.all(sessionId).map(rowToRunSnapshot);
  }

  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number {
    const info = this.stmts.deleteRunSnapshotsFrom.run(
      sessionId,
      sessionId,
      requestId,
      sessionId,
      sessionId,
      requestId,
    );
    return info.changes;
  }

  upsertTurnPreparation(sessionId: string, requestId: string, snapshot: AgentTurnPreparationSnapshot): void {
    this.stmts.upsertTurnPreparation.run({
      session_id: sessionId,
      request_id: requestId,
      snapshot_json: JSON.stringify(snapshot),
      created_at: new Date().toISOString(),
    });
  }

  loadTurnPreparation(sessionId: string, requestId: string): AgentTurnPreparationSnapshot | undefined {
    const row = this.stmts.selectTurnPreparation.get(sessionId, requestId);
    if (!row) return undefined;
    try {
      return parseAgentTurnPreparationSnapshot(JSON.parse(row.snapshot_json));
    } catch {
      return undefined;
    }
  }

  deleteTurnPreparationsFrom(sessionId: string, requestId: string): number {
    return this.stmts.deleteTurnPreparationsFrom.run(sessionId, sessionId, sessionId, requestId).changes;
  }

  renameSession(sessionId: string, title: string): void {
    this.stmts.renameSession.run(title, new Date().toISOString(), sessionId);
  }

  deleteSession(sessionId: string): boolean {
    const info = this.stmts.deleteSession.run(sessionId);
    return info.changes > 0;
  }

  deleteEntriesFrom(sessionId: string, requestId: string): number {
    const info = this.stmts.deleteFrom.run(sessionId, sessionId, requestId);
    return info.changes;
  }

  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void {
    this.appendRunEvents(sessionId, [event]);
  }

  appendRunEvents(sessionId: string, events: readonly AgentEventEnvelope[]): void {
    const append = this.db.transaction((batch: readonly AgentEventEnvelope[]) => {
      for (const event of batch) {
        if (!event.requestId) continue;
        this.stmts.appendRunEvent.run({
          session_id: sessionId,
          request_id: event.requestId,
          kind: event.kind,
          timestamp: event.timestamp,
          event_sequence: event.sequence,
          step: event.step ?? null,
          detail_id: event.detailId ?? null,
          event_id: resolveStoredEventId(event),
          reliability: "durable",
          event_json: JSON.stringify(event),
        });
      }
    });
    append(events);
  }

  loadRunEvents(sessionId: string): AgentEventEnvelope[] {
    return this.stmts.selectRunEvents.all(sessionId).flatMap((row) => {
      const event = parseStoredRunEvent(row.event_json);
      return event ? [{ ...event, eventId: event.eventId ?? row.event_id }] : [];
    });
  }

  deleteRunEventsFrom(sessionId: string, requestId: string): number {
    this.stmts.deleteRunEventOutboxFrom.run(sessionId, sessionId, sessionId, requestId);
    const info = this.stmts.deleteRunEventsFrom.run(sessionId, sessionId, sessionId, requestId);
    return info.changes;
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

function resolveStoredEventId(event: AgentEventEnvelope): string {
  if (event.eventId && event.eventId.trim().length > 0) return event.eventId;
  return `legacy:${event.sessionId ?? "global"}:${event.requestId ?? "unknown"}:${event.sequence}`;
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
