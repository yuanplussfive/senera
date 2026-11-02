import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { CommonTypes } from "onebots";
import type { AgentChannelSource, AgentChannelTask } from "../AgentChannelTypes.js";
import { serializeAgentChannelConversation } from "../AgentChannelSessionIdentity.js";
import type { OneBotClientSendIdentity } from "./AgentOneBot11ClientSendLedger.js";
import type { AgentChannelTimelineCursor } from "../AgentChannelTypes.js";

export interface OneBotGatewayRecord {
  readonly id: string;
  readonly direction: "inbound" | "outbound";
  readonly text: string;
  readonly sentAt: string;
  readonly senderId?: string;
  readonly displayName?: string;
  readonly source: AgentChannelSource;
  readonly segments: readonly CommonTypes.Segment[];
  readonly replyToMessageId?: string;
}

export interface OneBotTimelineEntry {
  readonly sequence: number;
  readonly key: string;
  readonly messageId?: string;
  readonly notice?: Record<string, unknown>;
  readonly task?: AgentChannelTask;
}

/** The protocol keeps its own durable message IDs and paged, lossless history. */
export class AgentOneBot11MessageStore {
  private connection?: DatabaseSync;
  private closed = false;

  constructor(private readonly filePath: string) {}

  private get database(): DatabaseSync {
    if (this.closed) throw new Error("The OneBot message store is closed.");
    if (this.connection) return this.connection;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const database = new DatabaseSync(this.filePath);
    try {
      const hasMediaMetadata = database
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_metadata'")
        .get();
      database.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lane TEXT NOT NULL,
        scene_type TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_lane ON messages(lane, id);
      CREATE INDEX IF NOT EXISTS messages_scene ON messages(scene_type, scene_id, id);
      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        emoji_id TEXT NOT NULL,
        PRIMARY KEY(message_id, user_id, emoji_id)
      );
      CREATE TABLE IF NOT EXISTS message_essence (
        message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        operator_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS timeline (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_key TEXT NOT NULL UNIQUE,
        lane TEXT NOT NULL,
        message_id INTEGER UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
        notice TEXT,
        recalled INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS timeline_lane ON timeline(lane, sequence);
      CREATE TABLE IF NOT EXISTS timeline_tasks (
        entry_key TEXT NOT NULL REFERENCES timeline(entry_key) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        PRIMARY KEY(entry_key, session_id)
      );
      CREATE INDEX IF NOT EXISTS timeline_tasks_run ON timeline_tasks(session_id,request_id);
      CREATE TABLE IF NOT EXISTS timeline_revisions (lane TEXT PRIMARY KEY, revision INTEGER NOT NULL, snapshot_revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS client_sends (
        client_id TEXT PRIMARY KEY,
        digest TEXT NOT NULL,
        message_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_metadata (
        storage_name TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mime TEXT NOT NULL
      );
      INSERT OR IGNORE INTO timeline(entry_key, lane, message_id)
        SELECT 'message:' || id, lane, id FROM messages ORDER BY id;
      `);
      if (!hasMediaMetadata)
        database.exec(`
        INSERT OR IGNORE INTO media_metadata(storage_name,name,mime)
          SELECT substr(json_extract(s.value,'$.data.file'),2),
            coalesce(json_extract(s.value,'$.data.name'),substr(json_extract(s.value,'$.data.file'),2)),
            json_extract(s.value,'$.data.content_type')
          FROM messages m, json_each(m.payload,'$.segments') s
          WHERE json_extract(s.value,'$.data.file') LIKE '/%'
            AND json_type(s.value,'$.data.content_type')='text';
      `);
      const revisionColumns = database.prepare("PRAGMA table_info(timeline_revisions)").all();
      if (!revisionColumns.some((column) => column.name === "snapshot_revision")) {
        database.exec(`BEGIN IMMEDIATE;
          ALTER TABLE timeline_revisions ADD COLUMN snapshot_revision INTEGER NOT NULL DEFAULT 0;
          UPDATE timeline_revisions SET snapshot_revision=revision;
          COMMIT;`);
      }
      const columns = database.prepare("PRAGMA table_info(timeline)").all();
      if (columns.some((column) => column.name === "session_id")) {
        database.exec(`BEGIN IMMEDIATE;
          INSERT OR IGNORE INTO timeline_tasks(entry_key,session_id,request_id)
            SELECT entry_key,session_id,request_id FROM timeline WHERE session_id IS NOT NULL AND request_id IS NOT NULL;
          DROP INDEX IF EXISTS timeline_task;
          ALTER TABLE timeline DROP COLUMN session_id;
          ALTER TABLE timeline DROP COLUMN request_id;
          COMMIT;`);
      }
      database.exec("PRAGMA foreign_keys = ON");
    } catch (error) {
      database.close();
      throw error;
    }
    this.connection = database;
    return database;
  }

  revision(source: AgentChannelSource): number {
    return this.laneRevision(serializeAgentChannelConversation(source));
  }

  private laneRevision(lane: string): number {
    return Number(
      this.database.prepare("SELECT revision FROM timeline_revisions WHERE lane=?").get(lane)?.revision ?? 0,
    );
  }

  private advanceRevision(lane: string): void {
    this.database
      .prepare(
        `INSERT INTO timeline_revisions(lane,revision,snapshot_revision) VALUES(?,1,1)
      ON CONFLICT(lane) DO UPDATE SET revision=revision+1,snapshot_revision=snapshot_revision+1`,
      )
      .run(lane);
  }

  invalidateSnapshot(source: AgentChannelSource): void {
    this.database
      .prepare(
        `INSERT INTO timeline_revisions(lane,revision,snapshot_revision) VALUES(?,0,1)
      ON CONFLICT(lane) DO UPDATE SET snapshot_revision=snapshot_revision+1`,
      )
      .run(serializeAgentChannelConversation(source));
  }

  clientSend(id: string): { digest: string; messageId: string } | undefined {
    const row = this.database.prepare("SELECT digest,message_id FROM client_sends WHERE client_id=?").get(id);
    return row ? { digest: String(row.digest), messageId: String(row.message_id) } : undefined;
  }

  clear(source: AgentChannelSource): void {
    const lane = serializeAgentChannelConversation(source);
    this.transaction(() => {
      this.database.prepare("DELETE FROM timeline WHERE lane = ?").run(lane);
      this.database.prepare("DELETE FROM messages WHERE lane = ?").run(lane);
      this.advanceRevision(lane);
    });
  }

  append(
    input: Omit<OneBotGatewayRecord, "id" | "sentAt">,
    task?: AgentChannelTask,
    clientSend?: OneBotClientSendIdentity,
  ): OneBotGatewayRecord {
    const payload = { ...input, sentAt: new Date().toISOString() };
    return this.transaction(() => {
      const result = this.database
        .prepare("INSERT INTO messages(lane, scene_type, scene_id, payload) VALUES (?, ?, ?, ?)")
        .run(
          serializeAgentChannelConversation(input.source),
          input.source.chatType,
          input.source.chatId,
          JSON.stringify(payload),
        );
      const id = String(result.lastInsertRowid);
      for (const segment of input.segments) {
        const { file, name, content_type: mime } = segment.data;
        if (typeof file === "string" && file.startsWith("/") && typeof mime === "string") {
          this.database
            .prepare("INSERT OR IGNORE INTO media_metadata(storage_name,name,mime) VALUES (?,?,?)")
            .run(file.slice(1), typeof name === "string" ? name : file.slice(1), mime);
        }
      }
      this.database
        .prepare(`INSERT INTO timeline(entry_key,lane,message_id) VALUES(?,?,?)`)
        .run(`message:${id}`, serializeAgentChannelConversation(input.source), id);
      if (task) this.bind(input.source, `message:${id}`, task);
      if (clientSend)
        this.database
          .prepare("INSERT INTO client_sends(client_id,digest,message_id) VALUES(?,?,?)")
          .run(clientSend.id, clientSend.digest, id);
      return { ...payload, id };
    });
  }

  get(id: string): OneBotGatewayRecord | undefined {
    return decodeRow(this.database.prepare("SELECT id, payload FROM messages WHERE id = ?").get(id));
  }

  /** Media metadata survives message deletion while its owned file still exists. */
  mediaMetadata(storageName: string): { name: string; mime: string } | undefined {
    const row = this.database.prepare("SELECT name,mime FROM media_metadata WHERE storage_name=?").get(storageName);
    return row ? { name: String(row.name), mime: String(row.mime) } : undefined;
  }

  isRecalled(id: string): boolean {
    return this.database.prepare("SELECT recalled FROM timeline WHERE message_id = ?").get(id)?.recalled === 1;
  }

  annotations(id: string) {
    const emojis: Record<string, number[]> = {};
    for (const row of this.database
      .prepare("SELECT user_id,emoji_id FROM message_reactions WHERE message_id=? ORDER BY emoji_id,user_id")
      .all(id)) {
      (emojis[String(row.emoji_id)] ??= []).push(Number(row.user_id));
    }
    return {
      emojis,
      emoji_like: Object.entries(emojis).map(([emoji_id, users]) => ({ emoji_id, count: users.length })),
      is_essence: Boolean(this.database.prepare("SELECT 1 FROM message_essence WHERE message_id=?").get(id)),
    };
  }

  setReaction(id: string, userId: string, emojiId: string, enabled: boolean): void {
    if (enabled) {
      this.database
        .prepare("INSERT OR IGNORE INTO message_reactions(message_id,user_id,emoji_id) VALUES(?,?,?)")
        .run(id, userId, emojiId);
    } else {
      this.database
        .prepare("DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji_id=?")
        .run(id, userId, emojiId);
    }
  }

  setEssence(id: string, operatorId: string, enabled: boolean): void {
    if (enabled) {
      this.database
        .prepare("INSERT OR IGNORE INTO message_essence(message_id,operator_id,created_at) VALUES(?,?,?)")
        .run(id, operatorId, new Date().toISOString());
    } else {
      this.database.prepare("DELETE FROM message_essence WHERE message_id=?").run(id);
    }
  }

  essence(groupId: string) {
    return this.database
      .prepare(
        `SELECT m.id,e.operator_id,e.created_at FROM message_essence e
        JOIN messages m ON m.id=e.message_id JOIN timeline t ON t.message_id=m.id
        WHERE m.scene_type='group' AND m.scene_id=? AND t.recalled=0 ORDER BY e.created_at DESC,m.id DESC`,
      )
      .all(groupId)
      .map((row) => ({
        messageId: String(row.id),
        operatorId: String(row.operator_id),
        createdAt: String(row.created_at),
      }));
  }

  isEntryCurrent(source: AgentChannelSource, key: string): boolean {
    return Boolean(
      this.database
        .prepare("SELECT 1 FROM timeline WHERE lane=? AND entry_key=? AND recalled=0")
        .get(serializeAgentChannelConversation(source), key),
    );
  }

  appendNotice(
    source: AgentChannelSource,
    eventId: string,
    notice: Record<string, unknown>,
    task?: AgentChannelTask,
  ): void {
    this.database
      .prepare(`INSERT INTO timeline(entry_key,lane,notice) VALUES(?,?,?)`)
      .run(`event:${eventId}`, serializeAgentChannelConversation(source), JSON.stringify(notice));
    if (task) this.bind(source, `event:${eventId}`, task);
  }

  recall(id: string, source: AgentChannelSource, eventId: string, notice: Record<string, unknown>): void {
    this.transaction(() => {
      const tasks = this.tasks(`message:${id}`);
      this.database.prepare("UPDATE timeline SET recalled = 1 WHERE message_id = ?").run(id);
      this.appendNotice(source, eventId, notice);
      for (const task of tasks) this.bind(source, `event:${eventId}`, task);
    });
  }

  bind(source: AgentChannelSource, key: string, task: AgentChannelTask, preserveExisting = false): void {
    this.database
      .prepare(
        `INSERT INTO timeline_tasks(entry_key,session_id,request_id)
        SELECT entry_key,?,? FROM timeline WHERE entry_key = ? AND lane = ?
        ON CONFLICT(entry_key,session_id) DO UPDATE SET request_id = excluded.request_id WHERE ? = 0`,
      )
      .run(task.sessionId, task.requestId, key, serializeAgentChannelConversation(source), preserveExisting ? 1 : 0);
  }

  task(key: string): AgentChannelTask | undefined {
    return this.tasks(key)[0];
  }

  tasks(key: string): AgentChannelTask[] {
    return this.database
      .prepare("SELECT session_id,request_id FROM timeline_tasks WHERE entry_key = ? ORDER BY session_id")
      .all(key)
      .map((row) => ({ sessionId: String(row.session_id), requestId: String(row.request_id) }));
  }

  /** All recipients of the same inbound dispatch form one editable task boundary. */
  dispatchTasks(key: string): AgentChannelTask[] {
    return this.database
      .prepare(
        `SELECT DISTINCT peers.session_id,peers.request_id FROM timeline_tasks selected
      JOIN timeline_tasks own ON own.session_id=selected.session_id AND own.request_id=selected.request_id
      JOIN timeline_tasks peers ON peers.entry_key=own.entry_key
      WHERE selected.entry_key=? ORDER BY peers.session_id`,
      )
      .all(key)
      .map((row) => ({ sessionId: String(row.session_id), requestId: String(row.request_id) }));
  }

  removeRequests(sessionId: string, requestIds: readonly string[]): void {
    this.transaction(() => {
      const lanes = new Set<string>();
      for (const requestId of requestIds) {
        const rows = this.database
          .prepare(
            "SELECT t.entry_key,t.lane,t.message_id FROM timeline t JOIN timeline_tasks r USING(entry_key) WHERE r.session_id = ? AND r.request_id = ?",
          )
          .all(sessionId, requestId);
        this.database
          .prepare("DELETE FROM timeline_tasks WHERE session_id = ? AND request_id = ?")
          .run(sessionId, requestId);
        for (const row of rows) {
          lanes.add(String(row.lane));
          if (this.tasks(String(row.entry_key)).length > 0) continue;
          if (row.message_id !== null) this.database.prepare("DELETE FROM messages WHERE id = ?").run(row.message_id);
          else this.database.prepare("DELETE FROM timeline WHERE entry_key = ?").run(row.entry_key);
        }
      }
      for (const lane of lanes) this.advanceRevision(lane);
    });
  }

  removeSession(sessionId: string): void {
    const requests = this.database
      .prepare("SELECT DISTINCT request_id FROM timeline_tasks WHERE session_id=?")
      .all(sessionId);
    this.removeRequests(
      sessionId,
      requests.map((row) => String(row.request_id)),
    );
  }

  removeSender(senderId: string): void {
    this.transaction(() => {
      const lanes = this.database
        .prepare("SELECT DISTINCT lane FROM messages WHERE json_extract(payload,'$.senderId')=?")
        .all(senderId);
      this.database.prepare("DELETE FROM messages WHERE json_extract(payload,'$.senderId')=?").run(senderId);
      this.database.prepare("DELETE FROM message_reactions WHERE user_id=?").run(senderId);
      for (const row of lanes) this.advanceRevision(String(row.lane));
    });
  }

  timeline(source: AgentChannelSource, limit: number, before?: number): readonly OneBotTimelineEntry[] {
    return this.database
      .prepare(
        `SELECT sequence,entry_key,message_id,notice FROM timeline
      WHERE lane = ? AND recalled = 0 AND (? IS NULL OR sequence < ?) ORDER BY sequence DESC LIMIT ?`,
      )
      .all(serializeAgentChannelConversation(source), before ?? null, before ?? null, limit)
      .map((row) => this.decodeTimelineRow(row));
  }

  cursor(source: AgentChannelSource): AgentChannelTimelineCursor {
    const lane = serializeAgentChannelConversation(source);
    return {
      revision: Number(
        this.database.prepare("SELECT snapshot_revision FROM timeline_revisions WHERE lane=?").get(lane)
          ?.snapshot_revision ?? 0,
      ),
      sequence: Number(
        this.database.prepare("SELECT MAX(sequence) AS sequence FROM timeline WHERE lane=?").get(lane)?.sequence ?? 0,
      ),
    };
  }

  timelineAfter(
    source: AgentChannelSource,
    after: number,
    through: number,
    limit: number,
  ): readonly OneBotTimelineEntry[] {
    return this.database
      .prepare(
        `SELECT sequence,entry_key,message_id,notice FROM timeline
      WHERE lane=? AND recalled=0 AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?`,
      )
      .all(serializeAgentChannelConversation(source), after, through, limit)
      .map((row) => this.decodeTimelineRow(row));
  }

  private decodeTimelineRow(row: Record<string, unknown>): OneBotTimelineEntry {
    const key = String(row.entry_key);
    const task = this.task(key);
    return {
      sequence: Number(row.sequence),
      key,
      ...(row.message_id !== null ? { messageId: String(row.message_id) } : {}),
      ...(typeof row.notice === "string" ? { notice: JSON.parse(row.notice) as Record<string, unknown> } : {}),
      ...(task ? { task } : {}),
    };
  }

  private transaction<T>(operation: () => T): T {
    const database = this.database;
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  history(source: AgentChannelSource, limit: number, before?: string): readonly OneBotGatewayRecord[] {
    return this.database
      .prepare(
        "SELECT id, payload FROM messages WHERE lane = ? AND id IN (SELECT message_id FROM timeline WHERE recalled = 0) AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?",
      )
      .all(serializeAgentChannelConversation(source), before ?? null, before ?? null, limit)
      .map(requiredRow);
  }

  /** One durable cursor per conversation, including conversations containing only notices. */
  latestConversations(): ReadonlyMap<string, OneBotTimelineEntry> {
    const rows = this.database
      .prepare(
        `
      SELECT lane, sequence, entry_key, message_id, notice FROM timeline
      WHERE sequence IN (SELECT MAX(sequence) FROM timeline WHERE recalled=0 GROUP BY lane)
      ORDER BY sequence DESC
    `,
      )
      .all();
    return new Map(
      rows.map((row) => [
        String(row.lane),
        {
          sequence: Number(row.sequence),
          key: String(row.entry_key),
          ...(row.message_id !== null ? { messageId: String(row.message_id) } : {}),
          ...(typeof row.notice === "string" ? { notice: JSON.parse(row.notice) as Record<string, unknown> } : {}),
        },
      ]),
    );
  }

  historyForScene(
    scene: CommonTypes.Scene,
    sceneId: string,
    limit: number,
    before?: string,
    offset = 0,
  ): readonly OneBotGatewayRecord[] {
    return this.database
      .prepare(
        "SELECT id, payload FROM messages WHERE scene_type = ? AND scene_id = ? AND id IN (SELECT message_id FROM timeline WHERE recalled = 0) AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ? OFFSET ?",
      )
      .all(scene === "group" ? "group" : "direct", sceneId, before ?? null, before ?? null, limit, offset)
      .map(requiredRow);
  }

  groups(): readonly { readonly id: string; readonly name: string }[] {
    return this.database
      .prepare("SELECT DISTINCT scene_id FROM messages WHERE scene_type = 'group' ORDER BY scene_id")
      .all()
      .map((row) => ({
        id: String(row.scene_id),
        name: String(row.scene_id),
      }));
  }

  close(): void {
    this.closed = true;
    this.connection?.close();
    this.connection = undefined;
  }
}

/** Stable host-owned storage, independent of gateway connections and configuration. */
export function agentOneBot11MessageStorePath(runtimeDirectory: string): string {
  return path.join(runtimeDirectory, "data", "messages.sqlite");
}

function requiredRow(row: Record<string, unknown>): OneBotGatewayRecord {
  const record = decodeRow(row);
  if (!record) throw new Error("The OneBot history row is missing.");
  return record;
}

function decodeRow(row: Record<string, unknown> | undefined): OneBotGatewayRecord | undefined {
  if (!row) return undefined;
  if (typeof row.payload !== "string") throw new Error("The OneBot history payload is invalid.");
  const payload = JSON.parse(row.payload) as Omit<OneBotGatewayRecord, "id">;
  return { ...payload, id: String(row.id) };
}
