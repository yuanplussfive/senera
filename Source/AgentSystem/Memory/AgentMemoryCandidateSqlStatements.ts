import type Database from "better-sqlite3";
import type { MemoryCandidateRow } from "./AgentMemorySqlRows.js";

export interface AgentMemoryCandidateSqlStatements {
  insertMemoryCandidateStmt: Database.Statement;
  listPendingMemoryCandidatesStmt: Database.Statement<[string], MemoryCandidateRow>;
  listPendingMemoryCandidatesByTypeStmt: Database.Statement<[string, string], MemoryCandidateRow>;
  promoteMemoryCandidateStmt: Database.Statement<[string, string, number, string, string, string, string]>;
  rejectMemoryCandidateStmt: Database.Statement<[string, number, string, string, string, string]>;
}

export function prepareAgentMemoryCandidateSqlStatements(db: Database.Database): AgentMemoryCandidateSqlStatements {
  return {
    insertMemoryCandidateStmt: db.prepare(`
      INSERT INTO memory_candidates (
        id,
        uri,
        type,
        subject,
        claim,
        how_to_apply,
        tags_json,
        triggers_json,
        source_refs_json,
        status,
        confidence,
        embedding_json,
        session_id,
        source_episode_uri,
        source_request_id,
        promoted_memory_uri,
        created_at,
        updated_at,
        created_at_ms,
        updated_at_ms,
        time_zone,
        local_date,
        local_hour,
        metadata_json
      )
      VALUES (
        @id,
        @uri,
        @type,
        @subject,
        @claim,
        @how_to_apply,
        @tags_json,
        @triggers_json,
        @source_refs_json,
        @status,
        @confidence,
        @embedding_json,
        @session_id,
        @source_episode_uri,
        @source_request_id,
        @promoted_memory_uri,
        @created_at,
        @updated_at,
        @created_at_ms,
        @updated_at_ms,
        @time_zone,
        @local_date,
        @local_hour,
        @metadata_json
      )
    `),
    listPendingMemoryCandidatesStmt: db.prepare<[string], MemoryCandidateRow>(`
      SELECT * FROM memory_candidates
      WHERE session_id = ? AND status = 'pending'
      ORDER BY created_at_ms ASC, id ASC
    `),
    listPendingMemoryCandidatesByTypeStmt: db.prepare<[string, string], MemoryCandidateRow>(`
      SELECT * FROM memory_candidates
      WHERE session_id = ? AND status = 'pending' AND type = ?
      ORDER BY created_at_ms ASC, id ASC
    `),
    promoteMemoryCandidateStmt: db.prepare<[string, string, number, string, string, string, string]>(`
      UPDATE memory_candidates SET
        status = 'promoted',
        promoted_memory_uri = ?,
        updated_at = ?,
        updated_at_ms = ?,
        time_zone = ?,
        local_date = ?,
        local_hour = ?
      WHERE uri = ?
    `),
    rejectMemoryCandidateStmt: db.prepare<[string, number, string, string, string, string]>(`
      UPDATE memory_candidates SET
        status = 'rejected',
        updated_at = ?,
        updated_at_ms = ?,
        time_zone = ?,
        local_date = ?,
        local_hour = ?
      WHERE uri = ?
    `),
  };
}
