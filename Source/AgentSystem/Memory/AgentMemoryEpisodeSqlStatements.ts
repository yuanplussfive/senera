import type Database from "better-sqlite3";
import type { EpisodeRow } from "./AgentMemorySqlRows.js";

export interface AgentMemoryEpisodeSqlStatements {
  upsertEpisodeStmt: Database.Statement;
  deleteSessionStmt: Database.Statement<[string]>;
  selectEpisodeForRequestStmt: Database.Statement<[string, string], EpisodeRow>;
  selectEpisodeByUriStmt: Database.Statement<[string], EpisodeRow>;
  deleteEpisodesFromTimeStmt: Database.Statement<[string, number]>;
  deleteExactEpisodeStmt: Database.Statement<[string, string]>;
  listEpisodesStmt: Database.Statement<[string], EpisodeRow>;
  listCompletedEpisodesStmt: Database.Statement<[], EpisodeRow>;
}

export function prepareAgentMemoryEpisodeSqlStatements(
  db: Database.Database,
): AgentMemoryEpisodeSqlStatements {
  return {
    upsertEpisodeStmt: db.prepare(`
      INSERT INTO memory_episodes (
        id,
        uri,
        session_id,
        request_id,
        status,
        raw_user_text,
        standalone_request,
        context_mode,
        context_basis,
        topic,
        summary,
        started_at,
        completed_at,
        updated_at,
        started_at_ms,
        completed_at_ms,
        updated_at_ms,
        time_zone,
        local_date,
        local_hour,
        metadata_json
      )
      VALUES (
        @id,
        @uri,
        @session_id,
        @request_id,
        @status,
        @raw_user_text,
        @standalone_request,
        @context_mode,
        @context_basis,
        @topic,
        @summary,
        @started_at,
        @completed_at,
        @updated_at,
        @started_at_ms,
        @completed_at_ms,
        @updated_at_ms,
        @time_zone,
        @local_date,
        @local_hour,
        @metadata_json
      )
      ON CONFLICT(session_id, request_id) DO UPDATE SET
        status = excluded.status,
        raw_user_text = excluded.raw_user_text,
        standalone_request = excluded.standalone_request,
        context_mode = excluded.context_mode,
        context_basis = excluded.context_basis,
        topic = excluded.topic,
        summary = excluded.summary,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at,
        started_at_ms = excluded.started_at_ms,
        completed_at_ms = excluded.completed_at_ms,
        updated_at_ms = excluded.updated_at_ms,
        time_zone = excluded.time_zone,
        local_date = excluded.local_date,
        local_hour = excluded.local_hour,
        metadata_json = excluded.metadata_json
    `),
    deleteSessionStmt: db.prepare<[string]>(`
      DELETE FROM memory_episodes WHERE session_id = ?
    `),
    selectEpisodeForRequestStmt: db.prepare<[string, string], EpisodeRow>(`
      SELECT * FROM memory_episodes WHERE session_id = ? AND request_id = ?
    `),
    selectEpisodeByUriStmt: db.prepare<[string], EpisodeRow>(`
      SELECT * FROM memory_episodes WHERE uri = ?
    `),
    deleteEpisodesFromTimeStmt: db.prepare<[string, number]>(`
      DELETE FROM memory_episodes
      WHERE session_id = ? AND started_at_ms >= ?
    `),
    deleteExactEpisodeStmt: db.prepare<[string, string]>(`
      DELETE FROM memory_episodes WHERE session_id = ? AND request_id = ?
    `),
    listEpisodesStmt: db.prepare<[string], EpisodeRow>(`
      SELECT * FROM memory_episodes
      WHERE session_id = ?
      ORDER BY started_at_ms ASC
    `),
    listCompletedEpisodesStmt: db.prepare<[], EpisodeRow>(`
      SELECT * FROM memory_episodes
      WHERE status = 'completed'
      ORDER BY completed_at_ms DESC, id ASC
    `),
  };
}

