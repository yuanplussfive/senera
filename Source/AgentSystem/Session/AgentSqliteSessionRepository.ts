import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
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
import {
  configureAgentSessionDatabase,
  installAgentSessionSchema,
  runAgentSessionMigrations,
} from "../SessionPersistence/AgentSessionSqlSchema.js";
import {
  prepareAgentSessionSqlStatements,
  type AgentSessionSqlStatements,
} from "../SessionPersistence/AgentSessionSqlStatements.js";
import {
  deriveAgentSessionTitle,
  rowToAgentSession,
} from "./AgentSqliteSessionMapper.js";
import { AgentSqliteSessionTraceStore } from "./AgentSqliteSessionTraceStore.js";
import type {
  AgentSessionRepository,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "./AgentSessionRepository.js";

export { InMemorySessionRepository } from "../SessionPersistence/InMemorySessionRepository.js";
export type {
  AgentSessionRepository,
  StoredRunSnapshot,
  StoredRunSnapshotStatus,
  StoredStepTraceRun,
} from "./AgentSessionRepository.js";

const USER_PROFILE_SETTING_KEY = "user.profile";

export class SqliteSessionRepository implements AgentSessionRepository {
  private readonly db: Database.Database;
  private readonly stmts: AgentSessionSqlStatements;
  private readonly traces: AgentSqliteSessionTraceStore;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    this.db = new Database(databasePath);
    configureAgentSessionDatabase(this.db);
    installAgentSessionSchema(this.db);
    runAgentSessionMigrations(this.db);
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

  loadEntries(sessionId: string): AgentConversationEntry[] {
    return this.stmts.selectEntries.all(sessionId).flatMap((row) => {
      const entry = rowToEntry(row);
      return entry ? [entry] : [];
    });
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

  appendEntries(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
  ): void {
    this.traces.appendEntries(sessionId, entries);
  }

  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    this.traces.persistTurnArtifacts(sessionId, entries, traces);
  }

  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    return this.traces.loadStepTraces(sessionId);
  }

  deleteStepTracesFrom(sessionId: string, requestId: string): number {
    const info = this.stmts.deleteStepTracesFrom.run(sessionId, sessionId, requestId);
    return info.changes;
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
    if (!event.requestId) {
      return;
    }
    this.stmts.appendRunEvent.run({
      session_id: sessionId,
      request_id: event.requestId,
      kind: event.kind,
      timestamp: event.timestamp,
      event_sequence: event.sequence,
      step: event.step ?? null,
      detail_id: event.detailId ?? null,
      event_json: JSON.stringify(event),
    });
  }

  loadRunEvents(sessionId: string): AgentEventEnvelope[] {
    return this.stmts.selectRunEvents.all(sessionId).flatMap((row) => {
      const event = parseStoredRunEvent(row.event_json);
      return event ? [event] : [];
    });
  }

  deleteRunEventsFrom(sessionId: string, requestId: string): number {
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
    try {
      // 把 WAL 文件清算到主 db，避免 senera.db-wal 越长越大
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* 关闭时尽力而为 */
    }
    this.db.close();
  }
}
