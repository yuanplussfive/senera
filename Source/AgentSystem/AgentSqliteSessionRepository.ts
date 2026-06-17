import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "./AgentConversation.js";
import type { AgentEventEnvelope } from "./AgentEventBase.js";
import {
  AgentUploadAttachmentListSchema,
  type AgentUploadAttachment,
} from "./Uploads/AgentUploadTypes.js";
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

const SCHEMA_VERSION = 3;

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL DEFAULT '新对话',
  status              TEXT NOT NULL DEFAULT 'idle',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  active_request_id   TEXT,
  metadata            TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_entries (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  request_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  timestamp   TEXT NOT NULL,
  sequence    INTEGER NOT NULL,
  data        TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_entries_session_seq ON conversation_entries(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_entries_request ON conversation_entries(request_id);

CREATE TABLE IF NOT EXISTS run_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,
  timestamp      TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  step           INTEGER,
  detail_id      TEXT,
  event_json     TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_events_session_id ON run_events(session_id, id);
CREATE INDEX IF NOT EXISTS idx_run_events_request ON run_events(request_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS step_traces (
  session_id    TEXT NOT NULL,
  request_id    TEXT NOT NULL,
  turn_sequence INTEGER NOT NULL,
  step          INTEGER NOT NULL,
  seq           INTEGER NOT NULL,
  data          TEXT NOT NULL,
  PRIMARY KEY (session_id, request_id, step, seq),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_step_traces_session ON step_traces(session_id, turn_sequence, step, seq);

CREATE TABLE IF NOT EXISTS run_snapshots (
  session_id      TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  input           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled')),
  started_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  ended_at        TEXT,
  error_message   TEXT,
  model_provider  TEXT,
  PRIMARY KEY (session_id, request_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_snapshots_session ON run_snapshots(session_id, started_at);
`;

const USER_PROFILE_SETTING_KEY = "user.profile";

interface SessionRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  active_request_id: string | null;
  metadata: string;
}

interface SessionListRow extends SessionRow {
  entry_count: number;
  message_count: number;
}

interface EntryRow {
  id: string;
  session_id: string;
  request_id: string;
  kind: string;
  timestamp: string;
  sequence: number;
  data: string;
}

interface RunEventRow {
  id: number;
  session_id: string;
  request_id: string;
  kind: string;
  timestamp: string;
  event_sequence: number;
  step: number | null;
  detail_id: string | null;
  event_json: string;
}

interface AppSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

interface StepTraceRow {
  request_id: string;
  turn_sequence: number;
  step: number;
  seq: number;
  data: string;
}

interface RunSnapshotRow {
  session_id: string;
  request_id: string;
  input: string;
  status: string;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  error_message: string | null;
  model_provider: string | null;
}

export class SqliteSessionRepository implements AgentSessionRepository {
  private readonly db: Database.Database;
  private readonly deleteFromStmt: Database.Statement;
  private readonly deleteRunEventsFromStmt: Database.Statement;

  private readonly stmts: {
    upsertSession: Database.Statement;
    renameSession: Database.Statement;
    deleteSession: Database.Statement;
    appendEntry: Database.Statement;
    appendRunEvent: Database.Statement;
    selectSession: Database.Statement<[string], SessionRow>;
    selectAllSessions: Database.Statement<[], SessionRow>;
    selectSessionList: Database.Statement<[], SessionListRow>;
    selectEntries: Database.Statement<[string], EntryRow>;
    selectRunEvents: Database.Statement<[string], RunEventRow>;
    selectSetting: Database.Statement<[string], AppSettingRow>;
    upsertSetting: Database.Statement;
    appendStepTrace: Database.Statement;
    selectStepTraces: Database.Statement<[string], StepTraceRow>;
    upsertRunSnapshot: Database.Statement;
    selectRunSnapshots: Database.Statement<[string], RunSnapshotRow>;
  };

  private readonly deleteStepTracesFromStmt: Database.Statement;
  private readonly deleteRunSnapshotsFromStmt: Database.Statement;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    this.db.exec(SCHEMA_DDL);
    this.runMigrations();

    this.stmts = {
      upsertSession: this.db.prepare(`
        INSERT INTO sessions (id, title, status, created_at, updated_at, active_request_id, metadata)
        VALUES (@id, @title, @status, @created_at, @updated_at, @active_request_id, @metadata)
        ON CONFLICT(id) DO UPDATE SET
          title             = excluded.title,
          status            = excluded.status,
          updated_at        = excluded.updated_at,
          active_request_id = excluded.active_request_id,
          metadata          = excluded.metadata
      `),
      renameSession: this.db.prepare(`
        UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?
      `),
      deleteSession: this.db.prepare(`DELETE FROM sessions WHERE id = ?`),
      appendEntry: this.db.prepare(`
        INSERT OR IGNORE INTO conversation_entries
          (id, session_id, request_id, kind, timestamp, sequence, data)
        VALUES (@id, @session_id, @request_id, @kind, @timestamp, @sequence, @data)
      `),
      appendRunEvent: this.db.prepare(`
        INSERT INTO run_events
          (session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_json)
        VALUES (@session_id, @request_id, @kind, @timestamp, @event_sequence, @step, @detail_id, @event_json)
      `),
      selectSession: this.db.prepare<[string], SessionRow>(`
        SELECT id, title, status, created_at, updated_at, active_request_id, metadata
        FROM sessions WHERE id = ?
      `),
      selectAllSessions: this.db.prepare<[], SessionRow>(`
        SELECT id, title, status, created_at, updated_at, active_request_id, metadata
        FROM sessions ORDER BY updated_at DESC
      `),
      selectSessionList: this.db.prepare<[], SessionListRow>(`
        SELECT
          s.id, s.title, s.status, s.created_at, s.updated_at, s.active_request_id, s.metadata,
          COUNT(e.id) AS entry_count,
          COALESCE(SUM(CASE WHEN e.kind IN ('user.message', 'assistant.decision') THEN 1 ELSE 0 END), 0) AS message_count
        FROM sessions s
        LEFT JOIN conversation_entries e ON e.session_id = s.id
        GROUP BY s.id
        ORDER BY s.updated_at DESC
      `),
      selectEntries: this.db.prepare<[string], EntryRow>(`
        SELECT id, session_id, request_id, kind, timestamp, sequence, data
        FROM conversation_entries
        WHERE session_id = ?
        ORDER BY sequence ASC
      `),
      selectRunEvents: this.db.prepare<[string], RunEventRow>(`
        SELECT id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_json
        FROM run_events
        WHERE session_id = ?
        ORDER BY id ASC
      `),
      selectSetting: this.db.prepare<[string], AppSettingRow>(`
        SELECT key, value, updated_at
        FROM app_settings
        WHERE key = ?
      `),
      upsertSetting: this.db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (@key, @value, @updated_at)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `),
      appendStepTrace: this.db.prepare(`
        INSERT OR IGNORE INTO step_traces
          (session_id, request_id, turn_sequence, step, seq, data)
        VALUES (@session_id, @request_id, @turn_sequence, @step, @seq, @data)
      `),
      selectStepTraces: this.db.prepare<[string], StepTraceRow>(`
        SELECT request_id, turn_sequence, step, seq, data
        FROM step_traces
        WHERE session_id = ?
        ORDER BY turn_sequence ASC, step ASC, seq ASC
      `),
      upsertRunSnapshot: this.db.prepare(`
        INSERT INTO run_snapshots
          (session_id, request_id, input, status, started_at, updated_at, ended_at, error_message, model_provider)
        VALUES
          (@session_id, @request_id, @input, @status, @started_at, @updated_at, @ended_at, @error_message, @model_provider)
        ON CONFLICT(session_id, request_id) DO UPDATE SET
          input          = excluded.input,
          status         = excluded.status,
          started_at     = excluded.started_at,
          updated_at     = excluded.updated_at,
          ended_at       = excluded.ended_at,
          error_message  = excluded.error_message,
          model_provider = excluded.model_provider
      `),
      selectRunSnapshots: this.db.prepare<[string], RunSnapshotRow>(`
        SELECT
          session_id, request_id, input, status, started_at, updated_at,
          ended_at, error_message, model_provider
        FROM run_snapshots
        WHERE session_id = ?
        ORDER BY started_at ASC
      `),
    };

    this.deleteStepTracesFromStmt = this.db.prepare(`
      DELETE FROM step_traces
      WHERE session_id = ?
        AND turn_sequence >= (
          SELECT MIN(sequence) FROM conversation_entries
          WHERE session_id = ? AND request_id = ?
        )
    `);

    this.deleteRunSnapshotsFromStmt = this.db.prepare(`
      DELETE FROM run_snapshots
      WHERE session_id = ?
        AND (
          started_at >= (
            SELECT started_at FROM run_snapshots
            WHERE session_id = ? AND request_id = ?
          )
          OR request_id IN (
            SELECT request_id FROM conversation_entries
            WHERE session_id = ?
              AND sequence >= (
                SELECT MIN(sequence) FROM conversation_entries
                WHERE session_id = ? AND request_id = ?
              )
          )
        )
    `);

    this.deleteFromStmt = this.db.prepare(`
      DELETE FROM conversation_entries
      WHERE session_id = ?
        AND sequence >= (
          SELECT MIN(sequence) FROM conversation_entries
          WHERE session_id = ? AND request_id = ?
        )
    `);
    this.deleteRunEventsFromStmt = this.db.prepare(`
      DELETE FROM run_events
      WHERE session_id = ?
        AND request_id IN (
          SELECT DISTINCT request_id FROM conversation_entries
          WHERE session_id = ?
            AND sequence >= (
              SELECT MIN(sequence) FROM conversation_entries
              WHERE session_id = ? AND request_id = ?
            )
        )
    `);
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
    return this.stmts.selectEntries.all(sessionId).map((row) => this.rowToEntry(row));
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
    this.stmts.appendEntry.run(this.entryToRow(sessionId, entry, sequence));
  }

  appendEntries(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
  ): void {
    if (entries.length === 0) return;
    const insert = this.db.transaction(
      (items: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>) => {
        for (const { entry, sequence } of items) {
          this.stmts.appendEntry.run(this.entryToRow(sessionId, entry, sequence));
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
        this.stmts.appendEntry.run(this.entryToRow(sessionId, entry, sequence));
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
    const info = this.deleteStepTracesFromStmt.run(sessionId, sessionId, requestId);
    return info.changes;
  }

  upsertRunSnapshot(snapshot: StoredRunSnapshot): void {
    this.stmts.upsertRunSnapshot.run(this.runSnapshotToRow(snapshot));
  }

  loadRunSnapshots(sessionId: string): StoredRunSnapshot[] {
    return this.stmts.selectRunSnapshots.all(sessionId).map((row) => this.rowToRunSnapshot(row));
  }

  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number {
    const info = this.deleteRunSnapshotsFromStmt.run(
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
    const info = this.deleteFromStmt.run(sessionId, sessionId, requestId);
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
    const info = this.deleteRunEventsFromStmt.run(sessionId, sessionId, sessionId, requestId);
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

  private runMigrations(): void {
    const row = this.db.pragma("user_version", { simple: true }) as number;
    if (row >= SCHEMA_VERSION) return;
    // v1 → v2: 新增 step_traces 表。建表 DDL 已在 SCHEMA_DDL 中以 IF NOT EXISTS
    // 无条件执行，存量库启动即补建；这里只推进版本号。
    // v2 → v3: 新增 run_snapshots 表，用于刷新后恢复运行态；旧 run 无需回填。
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

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

  private entryToRow(
    sessionId: string,
    entry: AgentConversationEntry,
    sequence: number,
  ): {
    id: string;
    session_id: string;
    request_id: string;
    kind: string;
    timestamp: string;
    sequence: number;
    data: string;
  } {
    const data: Record<string, unknown> = {};
    switch (entry.kind) {
      case AgentConversationEntryKinds.UserMessage:
        data.content = entry.content;
        if (entry.attachments && entry.attachments.length > 0) {
          data.attachments = entry.attachments;
        }
        break;
      case AgentConversationEntryKinds.AssistantDecision:
      case AgentConversationEntryKinds.ContextToolResults:
        data.xml = entry.xml;
        break;
      case AgentConversationEntryKinds.PlannerJournal:
      case AgentConversationEntryKinds.ToolEvidenceMemory:
        data.record = entry.record;
        break;
    }
    if (entry.metadata) {
      data.metadata = entry.metadata;
    }
    return {
      id: entry.id,
      session_id: sessionId,
      request_id: entry.requestId,
      kind: entry.kind,
      timestamp: entry.timestamp,
      sequence,
      data: JSON.stringify(data),
    };
  }

  private rowToEntry(row: EntryRow): AgentConversationEntry {
    const data = JSON.parse(row.data) as {
      content?: string;
      attachments?: unknown;
      xml?: string;
      record?: unknown;
      metadata?: unknown;
    };
    const base = {
      id: row.id,
      requestId: row.request_id,
      timestamp: row.timestamp,
    };
    switch (row.kind) {
      case AgentConversationEntryKinds.UserMessage:
        return {
          ...base,
          kind: AgentConversationEntryKinds.UserMessage,
          content: data.content ?? "",
          attachments: parseUploadAttachments(data.attachments),
          metadata: parseEntryMetadata(data.metadata),
        };
      case AgentConversationEntryKinds.AssistantDecision:
        return {
          ...base,
          kind: AgentConversationEntryKinds.AssistantDecision,
          xml: data.xml ?? "",
          metadata: parseEntryMetadata(data.metadata),
        };
      case AgentConversationEntryKinds.ContextToolResults:
        return {
          ...base,
          kind: AgentConversationEntryKinds.ContextToolResults,
          xml: data.xml ?? "",
          metadata: parseEntryMetadata(data.metadata),
        };
      case AgentConversationEntryKinds.PlannerJournal:
        return {
          ...base,
          kind: AgentConversationEntryKinds.PlannerJournal,
          record: parsePlannerJournalRecord(data.record, row.request_id, row.timestamp),
          metadata: parseEntryMetadata(data.metadata),
        };
      case AgentConversationEntryKinds.ToolEvidenceMemory:
        return {
          ...base,
          kind: AgentConversationEntryKinds.ToolEvidenceMemory,
          record: parseToolEvidenceMemoryRecord(data.record, row.request_id, row.timestamp),
          metadata: parseEntryMetadata(data.metadata),
        };
      default:
        throw new Error(`未知 conversation entry kind: ${row.kind}`);
    }
  }

  private runSnapshotToRow(snapshot: StoredRunSnapshot): {
    session_id: string;
    request_id: string;
    input: string;
    status: StoredRunSnapshotStatus;
    started_at: string;
    updated_at: string;
    ended_at: string | null;
    error_message: string | null;
    model_provider: string | null;
  } {
    return {
      session_id: snapshot.sessionId,
      request_id: snapshot.requestId,
      input: snapshot.input,
      status: snapshot.status,
      started_at: snapshot.startedAt,
      updated_at: snapshot.updatedAt,
      ended_at: snapshot.endedAt ?? null,
      error_message: snapshot.errorMessage ?? null,
      model_provider: snapshot.modelProvider ? JSON.stringify(snapshot.modelProvider) : null,
    };
  }

  private rowToRunSnapshot(row: RunSnapshotRow): StoredRunSnapshot {
    return {
      sessionId: row.session_id,
      requestId: row.request_id,
      input: row.input,
      status: parseRunSnapshotStatus(row.status),
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      endedAt: row.ended_at ?? undefined,
      errorMessage: row.error_message ?? undefined,
      modelProvider: parseModelProviderMetadata(row.model_provider),
    };
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseStoredRunEvent(value: string): AgentEventEnvelope | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as Partial<AgentEventEnvelope>;
    return typeof record.kind === "string"
      && typeof record.timestamp === "string"
      && typeof record.sequence === "number"
      && typeof record.channel === "string"
      ? record as AgentEventEnvelope
      : undefined;
  } catch {
    return undefined;
  }
}

function parseEntryMetadata(
  value: unknown,
): import("./AgentModelMetadata.js").AgentConversationEntryMetadata | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as import("./AgentModelMetadata.js").AgentConversationEntryMetadata
    : undefined;
}

function parseUploadAttachments(value: unknown): AgentUploadAttachment[] | undefined {
  const parsed = AgentUploadAttachmentListSchema.safeParse(value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}

function parsePlannerJournalRecord(
  value: unknown,
  requestId: string,
  timestamp: string,
): import("./AgentPlannerMemory.js").AgentPlannerJournalEntryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      requestId,
      step: 0,
      selectedAction: "unknown",
      decision: {},
      evidenceRefs: [],
      artifactUris: [],
      loadedTools: [],
      result: "unknown",
      createdAt: timestamp,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    requestId: readStringField(record.requestId) || requestId,
    step: readNumberField(record.step),
    selectedAction: readStringField(record.selectedAction) || "unknown",
    decision: record.decision ?? {},
    evidenceRefs: readStringArray(record.evidenceRefs),
    artifactUris: readStringArray(record.artifactUris),
    loadedTools: readStringArray(record.loadedTools),
    result: readStringField(record.result) || "unknown",
    createdAt: readStringField(record.createdAt) || timestamp,
  };
}

function parseToolEvidenceMemoryRecord(
  value: unknown,
  requestId: string,
  timestamp: string,
): import("./AgentPlannerMemory.js").AgentToolEvidenceMemoryEntryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      requestId,
      step: 0,
      toolName: "",
      artifactId: "",
      artifactUri: "",
      artifactPath: "",
      evidence: [],
      createdAt: timestamp,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    requestId: readStringField(record.requestId) || requestId,
    step: readNumberField(record.step),
    toolName: readStringField(record.toolName),
    artifactId: readStringField(record.artifactId),
    artifactUri: readStringField(record.artifactUri),
    artifactPath: readStringField(record.artifactPath),
    evidence: readEvidenceMemoryItems(record.evidence),
    createdAt: readStringField(record.createdAt) || timestamp,
  };
}

function readEvidenceMemoryItems(
  value: unknown,
): import("./BamlClient/baml_client/types.js").PlannerEvidenceMemoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readEvidenceMemoryItem)
    .filter((entry): entry is import("./BamlClient/baml_client/types.js").PlannerEvidenceMemoryItem =>
      Boolean(entry));
}

function readEvidenceMemoryItem(
  value: unknown,
): import("./BamlClient/baml_client/types.js").PlannerEvidenceMemoryItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const evidenceRef = readStringField(record.evidenceRef);
  const kind = readStringField(record.kind);
  if (!evidenceRef || !kind) {
    return undefined;
  }

  return {
    evidenceRef,
    kind,
    locator: readStringField(record.locator),
    display: readStringField(record.display),
    label: readStringField(record.label),
    confidence: readNumberField(record.confidence),
    toolName: readStringField(record.toolName),
    artifactUri: readStringField(record.artifactUri),
    facts: readEvidenceFacts(record.facts),
    artifactRefs: readStringArray(record.artifactRefs),
  };
}

function readEvidenceFacts(
  value: unknown,
): import("./BamlClient/baml_client/types.js").EvidenceSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const name = readStringField(record.name);
    const slotValue = readStringField(record.value);
    return name && slotValue ? [{ name, value: slotValue }] : [];
  });
}

function readStringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseRunSnapshotStatus(raw: string): StoredRunSnapshotStatus {
  if (raw === "running" || raw === "completed" || raw === "failed" || raw === "cancelled") {
    return raw;
  }
  return "failed";
}

function parseModelProviderMetadata(value: string | null): AgentModelProviderMetadata | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as AgentModelProviderMetadata
      : undefined;
  } catch {
    return undefined;
  }
}

/** 内存仓储——测试或禁用持久化时用 */
export class InMemorySessionRepository implements AgentSessionRepository {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly entries = new Map<string, AgentConversationEntry[]>();
  private readonly stepTraces = new Map<
    string,
    Array<{ requestId: string; turnSequence: number; trace: StepTrace }>
  >();
  private readonly runEvents = new Map<string, AgentEventEnvelope[]>();
  private readonly runSnapshots = new Map<string, Map<string, StoredRunSnapshot>>();
  private userProfile = createDefaultAgentUserProfile();

  listSessions(): Array<AgentSession & { entryCount: number; messageCount: number }> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => {
        const list = this.entries.get(s.id) ?? [];
        return {
          ...s,
          conversation: [],
          entryCount: list.length,
          messageCount: list.filter(
            (e) =>
              e.kind === AgentConversationEntryKinds.UserMessage ||
              e.kind === AgentConversationEntryKinds.AssistantDecision,
          ).length,
        };
      });
  }

  loadSession(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return { ...session, conversation: [...(this.entries.get(sessionId) ?? [])] };
  }

  loadAll(): AgentSession[] {
    return Array.from(this.sessions.values()).map((s) => ({
      ...s,
      conversation: [...(this.entries.get(s.id) ?? [])],
    }));
  }

  loadEntries(sessionId: string): AgentConversationEntry[] {
    return [...(this.entries.get(sessionId) ?? [])];
  }

  upsertSession(session: AgentSession): void {
    this.sessions.set(session.id, { ...session, conversation: [] });
  }

  appendEntry(sessionId: string, entry: AgentConversationEntry): void {
    const list = this.entries.get(sessionId) ?? [];
    if (list.some((e) => e.id === entry.id)) return;
    list.push(entry);
    this.entries.set(sessionId, list);
  }

  appendEntries(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
  ): void {
    for (const { entry } of entries) this.appendEntry(sessionId, entry);
  }

  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    for (const { entry } of entries) this.appendEntry(sessionId, entry);
    if (traces.length > 0) {
      const list = this.stepTraces.get(sessionId) ?? [];
      list.push(...traces);
      this.stepTraces.set(sessionId, list);
    }
  }

  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    const list = this.stepTraces.get(sessionId) ?? [];
    const byRequest = new Map<string, StoredStepTraceRun>();
    for (const { requestId, turnSequence, trace } of list) {
      let run = byRequest.get(requestId);
      if (!run) {
        run = { requestId, turnSequence, traces: [] };
        byRequest.set(requestId, run);
      }
      run.traces.push(trace);
    }
    return Array.from(byRequest.values())
      .map((run) => ({
        ...run,
        traces: [...run.traces].sort((a, b) => a.step - b.step || a.seq - b.seq),
      }))
      .sort((a, b) => a.turnSequence - b.turnSequence);
  }

  deleteStepTracesFrom(sessionId: string, requestId: string): number {
    const list = this.stepTraces.get(sessionId);
    if (!list) return 0;
    const entries = this.entries.get(sessionId) ?? [];
    const anchorSequence = entries.findIndex((entry) => entry.requestId === requestId);
    if (anchorSequence < 0) return 0;
    const kept = list.filter((item) => item.turnSequence < anchorSequence);
    const removed = list.length - kept.length;
    this.stepTraces.set(sessionId, kept);
    return removed;
  }

  upsertRunSnapshot(snapshot: StoredRunSnapshot): void {
    const snapshots = this.runSnapshots.get(snapshot.sessionId) ?? new Map<string, StoredRunSnapshot>();
    snapshots.set(snapshot.requestId, { ...snapshot });
    this.runSnapshots.set(snapshot.sessionId, snapshots);
  }

  loadRunSnapshots(sessionId: string): StoredRunSnapshot[] {
    const snapshots = this.runSnapshots.get(sessionId);
    if (!snapshots) return [];
    return Array.from(snapshots.values())
      .map((snapshot) => ({ ...snapshot }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number {
    const snapshots = this.runSnapshots.get(sessionId);
    if (!snapshots) return 0;
    const anchorSnapshot = snapshots.get(requestId);
    const entries = this.entries.get(sessionId) ?? [];
    const anchorSequence = entries.findIndex((entry) => entry.requestId === requestId);
    const requestIdsFromAnchor = new Set(
      anchorSequence >= 0 ? entries.slice(anchorSequence).map((entry) => entry.requestId) : [],
    );

    let removed = 0;
    for (const snapshot of Array.from(snapshots.values())) {
      const shouldDelete =
        (anchorSnapshot && snapshot.startedAt >= anchorSnapshot.startedAt) ||
        requestIdsFromAnchor.has(snapshot.requestId);
      if (shouldDelete) {
        snapshots.delete(snapshot.requestId);
        removed += 1;
      }
    }
    if (snapshots.size === 0) {
      this.runSnapshots.delete(sessionId);
    } else {
      this.runSnapshots.set(sessionId, snapshots);
    }
    return removed;
  }

  renameSession(_sessionId: string, _title: string): void {
    // 内存仓储不存 title，靠 session.metadata 之类未来扩展
  }

  deleteSession(sessionId: string): boolean {
    const had = this.sessions.delete(sessionId);
    this.entries.delete(sessionId);
    this.stepTraces.delete(sessionId);
    this.runEvents.delete(sessionId);
    this.runSnapshots.delete(sessionId);
    return had;
  }

  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void {
    const list = this.runEvents.get(sessionId) ?? [];
    list.push(event);
    this.runEvents.set(sessionId, list);
  }

  loadRunEvents(sessionId: string): AgentEventEnvelope[] {
    return [...(this.runEvents.get(sessionId) ?? [])];
  }

  deleteRunEventsFrom(sessionId: string, requestId: string): number {
    const entries = this.entries.get(sessionId) ?? [];
    const idx = entries.findIndex((entry) => entry.requestId === requestId);
    if (idx < 0) return 0;

    const removedRequestIds = new Set(entries.slice(idx).map((entry) => entry.requestId));
    const events = this.runEvents.get(sessionId) ?? [];
    const retained = events.filter((event) =>
      !event.requestId || !removedRequestIds.has(event.requestId));
    this.runEvents.set(sessionId, retained);
    return events.length - retained.length;
  }

  deleteEntriesFrom(sessionId: string, requestId: string): number {
    const list = this.entries.get(sessionId);
    if (!list) return 0;
    const idx = list.findIndex((e) => e.requestId === requestId);
    if (idx < 0) return 0;
    const removed = list.length - idx;
    this.entries.set(sessionId, list.slice(0, idx));
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
}
