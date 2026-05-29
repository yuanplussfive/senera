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

const SCHEMA_VERSION = 1;

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
  };

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
    };

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
    // 当前只有 v1。将来加 migration 写在这里。
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

  renameSession(_sessionId: string, _title: string): void {
    // 内存仓储不存 title，靠 session.metadata 之类未来扩展
  }

  deleteSession(sessionId: string): boolean {
    const had = this.sessions.delete(sessionId);
    this.entries.delete(sessionId);
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
