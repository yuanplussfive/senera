import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "./AgentConversation.js";
import type { AgentEventEnvelope } from "./AgentEventBase.js";
import {
  entryToRow,
  parseJsonObject,
  parseStoredRunEvent,
  rowToEntry,
  rowToRunSnapshot,
  runSnapshotToRow,
} from "./SessionPersistence/AgentSessionCodec.js";
import {
  AgentSessionStatuses,
  type AgentSession,
  type AgentSessionStatus,
} from "./AgentSession.js";
import {
  createAgentUserProfile,
  createDefaultAgentUserProfile,
  parseStoredAgentUserProfile,
  type AgentUserProfile,
  type AgentUserProfileInput,
  type AgentUserProfileRepository,
} from "./AgentUserProfile.js";
import type { AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import type { StepTrace } from "./AgentStepTrace.js";
import {
  configureAgentSessionDatabase,
  installAgentSessionSchema,
  runAgentSessionMigrations,
} from "./SessionPersistence/AgentSessionSqlSchema.js";
import {
  prepareAgentSessionSqlStatements,
  type AgentSessionSqlStatements,
} from "./SessionPersistence/AgentSessionSqlStatements.js";
import type {
  SessionRow,
} from "./SessionPersistence/AgentSessionSqlRows.js";

export { InMemorySessionRepository } from "./SessionPersistence/InMemorySessionRepository.js";

/** 一轮 turn 的 step 轨迹分组——回放时据此重建一个 RunRecord */
export interface StoredStepTraceRun {
  requestId: string;
  turnSequence: number;
  traces: StepTrace[];
}

export type StoredRunSnapshotStatus = "running" | "completed" | "failed" | "cancelled";

/** 一轮请求的轻量生命周期快照，用于刷新后恢复运行态，不参与 prompt history。 */
export interface StoredRunSnapshot {
  sessionId: string;
  requestId: string;
  input: string;
  status: StoredRunSnapshotStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  errorMessage?: string;
  modelProvider?: AgentModelProviderMetadata;
}

export interface AgentSessionRepository extends AgentUserProfileRepository {
  /** 列出所有会话，最近更新优先 */
  listSessions(): Array<AgentSession & { entryCount: number; messageCount: number }>;
  /** 加载单个会话（含 conversation）；不存在返回 undefined */
  loadSession(sessionId: string): AgentSession | undefined;
  /** 全量加载所有会话——启动时回填 in-memory 缓存 */
  loadAll(): AgentSession[];
  /** upsert session 元数据（不动 entries） */
  upsertSession(session: AgentSession): void;
  /** 追加单个 entry（幂等：相同 id 会被忽略） */
  appendEntry(sessionId: string, entry: AgentConversationEntry, sequence: number): void;
  /** 一整轮 turn 的多个 entry 用事务批量追加 */
  appendEntries(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
  ): void;
  /** 一整轮 turn 的 entries 与 step 轨迹在同一事务内原子落盘 */
  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void;
  /** 读取某会话所有 step 轨迹，按 (turn_sequence, step, seq) 升序、按 requestId 分组 */
  loadStepTraces(sessionId: string): StoredStepTraceRun[];
  /** 删除某 sessionId 中、从指定 requestId 所在轮次开始（含）之后所有 step 轨迹 */
  deleteStepTracesFrom(sessionId: string, requestId: string): number;
  /** upsert 一轮请求的生命周期快照 */
  upsertRunSnapshot(snapshot: StoredRunSnapshot): void;
  /** 读取某会话所有 run snapshots，按 startedAt 升序 */
  loadRunSnapshots(sessionId: string): StoredRunSnapshot[];
  /** 删除某 sessionId 中、从指定 requestId 所在轮次开始（含）之后所有 run snapshots */
  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number;
  /** 重命名 */
  renameSession(sessionId: string, title: string): void;
  /** 删除会话（含所有 entries） */
  deleteSession(sessionId: string): boolean;
  /** 读取某会话的所有 entries（按 sequence 升序） */
  loadEntries(sessionId: string): AgentConversationEntry[];
  /** 删除某 sessionId 中、从指定 requestId 开始（含）之后所有的 entries */
  deleteEntriesFrom(sessionId: string, requestId: string): number;
  /** 追加单个执行事件（右侧执行轨迹），不参与模型上下文。 */
  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void;
  /** 读取某会话的执行事件日志（按写入顺序升序）。 */
  loadRunEvents(sessionId: string): AgentEventEnvelope[];
  /** 删除某 sessionId 中、从指定 requestId 开始（含）之后所有执行事件。 */
  deleteRunEventsFrom(sessionId: string, requestId: string): number;
  /** 关闭底层连接 */
  close(): void;
}

const USER_PROFILE_SETTING_KEY = "user.profile";

export class SqliteSessionRepository implements AgentSessionRepository {
  private readonly db: Database.Database;
  private readonly stmts: AgentSessionSqlStatements;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    this.db = new Database(databasePath);
    configureAgentSessionDatabase(this.db);
    installAgentSessionSchema(this.db);
    runAgentSessionMigrations(this.db);
    this.stmts = prepareAgentSessionSqlStatements(this.db);
  }

  // ---- 接口实现 ----

  listSessions(): Array<AgentSession & { entryCount: number; messageCount: number }> {
    return this.stmts.selectSessionList.all().map((row) => ({
      ...this.rowToSession(row),
      conversation: [], // listSessions 不带 conversation——重视性能
      entryCount: row.entry_count,
      messageCount: row.message_count,
    }));
  }

  loadSession(sessionId: string): AgentSession | undefined {
    const row = this.stmts.selectSession.get(sessionId);
    if (!row) return undefined;
    const session = this.rowToSession(row);
    session.conversation = this.loadEntries(sessionId);
    return session;
  }

  loadAll(): AgentSession[] {
    return this.stmts.selectAllSessions.all().map((row) => {
      const session = this.rowToSession(row);
      session.conversation = this.loadEntries(session.id);
      return session;
    });
  }

  loadEntries(sessionId: string): AgentConversationEntry[] {
    return this.stmts.selectEntries.all(sessionId).map(rowToEntry);
  }

  upsertSession(session: AgentSession): void {
    this.stmts.upsertSession.run({
      id: session.id,
      title: this.deriveTitle(session),
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
    if (entries.length === 0) return;
    const insert = this.db.transaction(
      (items: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>) => {
        for (const { entry, sequence } of items) {
          this.stmts.appendEntry.run(entryToRow(sessionId, entry, sequence));
        }
      },
    );
    insert(entries);
  }

  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    if (entries.length === 0 && traces.length === 0) return;
    const persist = this.db.transaction(() => {
      for (const { entry, sequence } of entries) {
        this.stmts.appendEntry.run(entryToRow(sessionId, entry, sequence));
      }
      for (const { requestId, turnSequence, trace } of traces) {
        this.stmts.appendStepTrace.run({
          session_id: sessionId,
          request_id: requestId,
          turn_sequence: turnSequence,
          step: trace.step,
          seq: trace.seq,
          data: JSON.stringify(trace),
        });
      }
    });
    persist();
  }

  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    const rows = this.stmts.selectStepTraces.all(sessionId);
    const byRequest = new Map<string, StoredStepTraceRun>();
    for (const row of rows) {
      let run = byRequest.get(row.request_id);
      if (!run) {
        run = { requestId: row.request_id, turnSequence: row.turn_sequence, traces: [] };
        byRequest.set(row.request_id, run);
      }
      run.traces.push(JSON.parse(row.data) as StepTrace);
    }
    return Array.from(byRequest.values()).sort((a, b) => a.turnSequence - b.turnSequence);
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

  // ---- 辅助 ----

  private deriveTitle(session: AgentSession): string {
    // 取第一条 user.message 的前 24 个字
    const firstUser = session.conversation.find(
      (e) => e.kind === AgentConversationEntryKinds.UserMessage,
    );
    if (firstUser && firstUser.kind === AgentConversationEntryKinds.UserMessage) {
      const text = firstUser.content.replace(/\s+/g, " ").trim();
      if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text;
    }
    return "新对话";
  }

  private rowToSession(row: SessionRow): AgentSession {
    const session: AgentSession = {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: this.parseStatus(row.status),
      conversation: [],
      metadata: parseJsonObject(row.metadata),
    };
    if (row.active_request_id) {
      // 仅恢复 ID；input/startedAt 未持久化——重启后视为没有活跃请求
      session.activeRequest = undefined;
    }
    return session;
  }

  private parseStatus(raw: string): AgentSessionStatus {
    if (raw === AgentSessionStatuses.Running) return AgentSessionStatuses.Idle; // 重启后没有进行中
    if (raw === AgentSessionStatuses.Idle) return AgentSessionStatuses.Idle;
    return AgentSessionStatuses.Idle;
  }

}

