import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "./AgentConversation.js";
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
import type { StepTrace } from "./AgentStepTrace.js";

/** 一轮 turn 的 step 轨迹分组——回放时据此重建一个 RunRecord */
export interface StoredStepTraceRun {
  requestId: string;
  turnSequence: number;
  traces: StepTrace[];
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
  /** 重命名 */
  renameSession(sessionId: string, title: string): void;
  /** 删除会话（含所有 entries） */
  deleteSession(sessionId: string): boolean;
  /** 读取某会话的所有 entries（按 sequence 升序） */
  loadEntries(sessionId: string): AgentConversationEntry[];
  /** 删除某 sessionId 中、从指定 requestId 开始（含）之后所有的 entries */
  deleteEntriesFrom(sessionId: string, requestId: string): number;
  /** 关闭底层连接 */
  close(): void;
}

const SCHEMA_VERSION = 2;

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

export class SqliteSessionRepository implements AgentSessionRepository {
  private readonly db: Database.Database;
  private readonly deleteFromStmt: Database.Statement;

  private readonly stmts: {
    upsertSession: Database.Statement;
    renameSession: Database.Statement;
    deleteSession: Database.Statement;
    appendEntry: Database.Statement;
    selectSession: Database.Statement<[string], SessionRow>;
    selectAllSessions: Database.Statement<[], SessionRow>;
    selectSessionList: Database.Statement<[], SessionListRow>;
    selectEntries: Database.Statement<[string], EntryRow>;
    selectSetting: Database.Statement<[string], AppSettingRow>;
    upsertSetting: Database.Statement;
    appendStepTrace: Database.Statement;
    selectStepTraces: Database.Statement<[string], StepTraceRow>;
  };

  private readonly deleteStepTracesFromStmt: Database.Statement;

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
    };

    this.deleteStepTracesFromStmt = this.db.prepare(`
      DELETE FROM step_traces
      WHERE session_id = ?
        AND turn_sequence >= (
          SELECT MIN(sequence) FROM conversation_entries
          WHERE session_id = ? AND request_id = ?
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
    if (entry.kind === AgentConversationEntryKinds.UserMessage) {
      data.content = entry.content;
    } else {
      data.xml = entry.xml;
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
    const data = JSON.parse(row.data) as { content?: string; xml?: string; metadata?: unknown };
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
      default:
        throw new Error(`未知 conversation entry kind: ${row.kind}`);
    }
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

function parseEntryMetadata(
  value: unknown,
): import("./AgentModelMetadata.js").AgentConversationEntryMetadata | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as import("./AgentModelMetadata.js").AgentConversationEntryMetadata
    : undefined;
}

/** 内存仓储——测试或禁用持久化时用 */
export class InMemorySessionRepository implements AgentSessionRepository {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly entries = new Map<string, AgentConversationEntry[]>();
  private readonly stepTraces = new Map<
    string,
    Array<{ requestId: string; turnSequence: number; trace: StepTrace }>
  >();
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

  renameSession(_sessionId: string, _title: string): void {
    // 内存仓储不存 title，靠 session.metadata 之类未来扩展
  }

  deleteSession(sessionId: string): boolean {
    const had = this.sessions.delete(sessionId);
    this.entries.delete(sessionId);
    this.stepTraces.delete(sessionId);
    return had;
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
