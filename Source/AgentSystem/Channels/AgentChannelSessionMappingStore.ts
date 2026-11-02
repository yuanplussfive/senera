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
  readonly authority?: string;
  readonly agentId?: string;
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
  readonly authority: string;
  readonly agent_id: string;
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

  /** Adopt the pre-directory group lane once, retaining its session and epoch. */
  adoptAgentLane(source: AgentChannelSource): AgentChannelSessionMapping | undefined {
    if (source.platform !== "onebot11" || source.authority || source.chatType !== "group" || !source.agentId)
      return undefined;
    const legacy = this.getByLane({ ...source, agentId: undefined });
    if (!legacy) return undefined;
    this.connection
      .prepare(
        agentSql`UPDATE channel_sessions SET agent_id = @agent_id WHERE authority = @authority AND platform = @platform AND chat_type = @chat_type AND chat_id = @chat_id AND user_id = @user_id AND thread_id = @thread_id AND agent_id = ''`,
      )
      .run(laneParams(source));
    return this.getByLane(source);
  }

  /** Creates the initial mapping for a lane or bumps the epoch (after /new). */
  resetEpoch(source: AgentChannelSource, sessionId: string, epoch: number, now: string): void {
    this.statements.resetEpoch.run({
      ...laneParams(source),
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
      ...laneParams(source),
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
      ...laneParams(source),
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

  removeLane(source: AgentChannelSource): void {
    this.connection
      .prepare(
        agentSql`DELETE FROM channel_sessions WHERE authority=@authority AND platform=@platform AND chat_type=@chat_type
      AND chat_id=@chat_id AND user_id=@user_id AND agent_id=@agent_id AND thread_id IS @thread_id`,
      )
      .run(laneParams(source));
  }

  close(): void {
    // The connection is owned by the caller.
    void this.connection;
  }
}

function laneParams(source: AgentChannelSource): Record<string, string> {
  return {
    authority: source.authority ?? "",
    agent_id: source.chatType === "group" ? (source.agentId ?? "") : "",
    platform: source.platform,
    chat_type: source.chatType,
    chat_id: source.chatId,
    user_id: source.userId,
    thread_id: source.threadId ?? "",
  };
}

function decodeRow(row: ChannelSessionRow): AgentChannelSessionMapping {
  return {
    ...(row.authority ? { authority: row.authority } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
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
      agentSql`SELECT authority, platform, chat_type, chat_id, user_id, agent_id, thread_id, session_id, epoch, created_at, updated_at
        FROM channel_sessions
        WHERE authority = @authority AND platform = @platform AND chat_type = @chat_type AND chat_id = @chat_id
          AND user_id = @user_id AND agent_id = @agent_id AND thread_id IS @thread_id`,
    ),
    getBySession: connection.prepare(
      agentSql`SELECT authority, platform, chat_type, chat_id, user_id, agent_id, thread_id, session_id, epoch, created_at, updated_at
        FROM channel_sessions
        WHERE session_id = ? LIMIT 1`,
    ),
    resetEpoch: connection.prepare(
      agentSql`INSERT INTO channel_sessions (authority, platform, chat_type, chat_id, user_id, agent_id, thread_id, session_id, epoch, created_at, updated_at)
        VALUES (@authority, @platform, @chat_type, @chat_id, @user_id, @agent_id, @thread_id, @session_id, @epoch, @created_at, @updated_at)
        ON CONFLICT (authority, platform, chat_type, chat_id, user_id, agent_id, thread_id) DO UPDATE SET
          session_id = excluded.session_id, epoch = excluded.epoch,
          updated_at = excluded.updated_at`,
    ),
    upsert: connection.prepare(
      agentSql`INSERT INTO channel_sessions (authority, platform, chat_type, chat_id, user_id, agent_id, thread_id, session_id, epoch, created_at, updated_at)
        VALUES (@authority, @platform, @chat_type, @chat_id, @user_id, @agent_id, @thread_id, @session_id, @epoch, @created_at, @updated_at)
        ON CONFLICT (authority, platform, chat_type, chat_id, user_id, agent_id, thread_id) DO UPDATE SET
          session_id = excluded.session_id, epoch = excluded.epoch, updated_at = excluded.updated_at`,
    ),
    touch: connection.prepare(
      agentSql`UPDATE channel_sessions
        SET updated_at = @updated_at
        WHERE authority = @authority AND platform = @platform AND chat_type = @chat_type AND chat_id = @chat_id
          AND user_id = @user_id AND agent_id = @agent_id AND thread_id IS @thread_id`,
    ),
    listAll: connection.prepare(
      agentSql`SELECT authority, platform, chat_type, chat_id, user_id, agent_id, thread_id, session_id, epoch, created_at, updated_at
        FROM channel_sessions ORDER BY updated_at DESC`,
    ),
  };
}

export const AgentChannelChatTypeValues = Object.values(AgentChannelChatTypes);
