import type Database from "better-sqlite3";
import { agentSql } from "../Database/AgentSql.js";
import {
  AgentChannelChatTypes,
  type AgentChannelChatType,
  type AgentChannelKind,
  type AgentChannelSource,
} from "./AgentChannelTypes.js";

/** One durable (account, conversation) -> senera session mapping row. */
export interface AgentChannelSessionMapping {
  readonly platform: AgentChannelKind;
  readonly chatType: AgentChannelChatType;
  readonly chatId: string;
  readonly userId: string;
  readonly threadId?: string;
  readonly sessionId: string;
  readonly epoch: number;
  readonly updatedAt: string;
}

interface ChannelSessionRow {
  readonly platform: string;
  readonly chat_type: string;
  readonly chat_id: string;
  readonly user_id: string;
  readonly thread_id: string | null;
  readonly session_id: string;
  readonly epoch: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ChannelSessionStatements {
  readonly getByLane: Database.Statement;
  readonly getBySession: Database.Statement;
  readonly upsert: Database.Statement;
  readonly resetEpoch: Database.Statement;
  readonly touch: Database.Statement;
  readonly listAll: Database.Statement;
}

/**
 * Persists the mapping between a channel conversation lane and the senera
 * session that serves it. The mapping survives restarts so a conversation can
 * resume exactly where it stopped, and a `/new` only bumps the epoch instead
 * of deleting history.
 */
export class AgentChannelSessionMappingStore {
  private readonly statements: ChannelSessionStatements;

  constructor(private readonly connection: Database.Database) {
    this.statements = prepareStatements(connection);
  }

  getByLane(source: AgentChannelSource): AgentChannelSessionMapping | undefined {
    const row = this.statements.getByLane.get(laneParams(source)) as ChannelSessionRow | undefined;
    return row ? decodeRow(row) : undefined;
  }

  getBySession(sessionId: string): AgentChannelSessionMapping | undefined {
    const row = this.statements.getBySession.get(sessionId) as ChannelSessionRow | undefined;
    return row ? decodeRow(row) : undefined;
  }

  /** Creates the initial mapping for a lane or bumps the epoch (after /new). */
  resetEpoch(source: AgentChannelSource, sessionId: string, epoch: number, now: string): void {
    this.statements.resetEpoch.run({
      platform: source.platform,
      chat_type: source.chatType,
      chat_id: source.chatId,
      user_id: source.userId,
      thread_id: source.threadId ?? "",
      session_id: sessionId,
      epoch,
      created_at: now,
      updated_at: now,
    });
  }

  upsert(source: AgentChannelSource, sessionId: string, epoch: number, now: string): void {
    this.statements.upsert.run({
      platform: source.platform,
      chat_type: source.chatType,
      chat_id: source.chatId,
      user_id: source.userId,
      thread_id: source.threadId ?? "",
      session_id: sessionId,
      epoch,
      created_at: now,
      updated_at: now,
    });
  }

  touch(source: AgentChannelSource, now: string): void {
    this.statements.touch.run({
      platform: source.platform,
      chat_type: source.chatType,
      chat_id: source.chatId,
      user_id: source.userId,
      thread_id: source.threadId ?? "",
      updated_at: now,
    });
  }

  listAll(): AgentChannelSessionMapping[] {
    return (this.statements.listAll.all() as ChannelSessionRow[]).map(decodeRow);
  }

  close(): void {
    // The connection is owned by the caller.
    void this.connection;
  }
}

function laneParams(source: AgentChannelSource): Record<string, string> {
  return {
    platform: source.platform,
    chat_type: source.chatType,
    chat_id: source.chatId,
    user_id: source.userId,
    thread_id: source.threadId ?? "",
  };
}

function decodeRow(row: ChannelSessionRow): AgentChannelSessionMapping {
  return {
    platform: row.platform as AgentChannelKind,
    chatType: row.chat_type as AgentChannelChatType,
    chatId: row.chat_id,
    userId: row.user_id,
    threadId: row.thread_id ?? undefined,
    sessionId: row.session_id,
    epoch: row.epoch,
    updatedAt: row.updated_at,
  };
}

function prepareStatements(connection: Database.Database): ChannelSessionStatements {
  return {
    getByLane: connection.prepare(
      agentSql`SELECT platform, chat_type, chat_id, user_id, thread_id, session_id, epoch, created_at, updated_at
        FROM channel_sessions
        WHERE platform = @platform AND chat_type = @chat_type AND chat_id = @chat_id
          AND user_id = @user_id AND thread_id IS @thread_id`,
    ),
    getBySession: connection.prepare(
      agentSql`SELECT platform, chat_type, chat_id, user_id, thread_id, session_id, epoch, created_at, updated_at
        FROM channel_sessions
        WHERE session_id = ? LIMIT 1`,
    ),
    resetEpoch: connection.prepare(
      agentSql`INSERT INTO channel_sessions (platform, chat_type, chat_id, user_id, thread_id, session_id, epoch, created_at, updated_at)
        VALUES (@platform, @chat_type, @chat_id, @user_id, @thread_id, @session_id, @epoch, @created_at, @updated_at)
        ON CONFLICT (platform, chat_type, chat_id, user_id, thread_id) DO UPDATE SET
          session_id = excluded.session_id, epoch = excluded.epoch,
          updated_at = excluded.updated_at`,
    ),
    upsert: connection.prepare(
      agentSql`INSERT INTO channel_sessions (platform, chat_type, chat_id, user_id, thread_id, session_id, epoch, created_at, updated_at)
        VALUES (@platform, @chat_type, @chat_id, @user_id, @thread_id, @session_id, @epoch, @created_at, @updated_at)
        ON CONFLICT (platform, chat_type, chat_id, user_id, thread_id) DO UPDATE SET
          session_id = excluded.session_id, epoch = excluded.epoch, updated_at = excluded.updated_at`,
    ),
    touch: connection.prepare(
      agentSql`UPDATE channel_sessions
        SET updated_at = @updated_at
        WHERE platform = @platform AND chat_type = @chat_type AND chat_id = @chat_id
          AND user_id = @user_id AND thread_id IS @thread_id`,
    ),
    listAll: connection.prepare(
      agentSql`SELECT platform, chat_type, chat_id, user_id, thread_id, session_id, epoch, created_at, updated_at
        FROM channel_sessions ORDER BY updated_at DESC`,
    ),
  };
}

export const AgentChannelChatTypeValues = Object.values(AgentChannelChatTypes);
