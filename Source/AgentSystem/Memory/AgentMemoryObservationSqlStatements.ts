import type Database from "better-sqlite3";
import type { MemoryObservationRow } from "./AgentMemorySqlRows.js";

export interface AgentMemoryObservationSqlStatements {
  insertMemoryObservationStmt: Database.Statement;
  listMemoryObservationsStmt: Database.Statement<[string], MemoryObservationRow>;
}

export function prepareAgentMemoryObservationSqlStatements(
  db: Database.Database,
): AgentMemoryObservationSqlStatements {
  return {
    insertMemoryObservationStmt: db.prepare(`
      INSERT INTO memory_observations (
        id,
        uri,
        memory_uri,
        operation,
        candidate_uris_json,
        source_refs_json,
        reason,
        confidence,
        session_id,
        source_episode_uri,
        source_request_id,
        created_at,
        created_at_ms,
        time_zone,
        local_date,
        local_hour,
        metadata_json
      )
      VALUES (
        @id,
        @uri,
        @memory_uri,
        @operation,
        @candidate_uris_json,
        @source_refs_json,
        @reason,
        @confidence,
        @session_id,
        @source_episode_uri,
        @source_request_id,
        @created_at,
        @created_at_ms,
        @time_zone,
        @local_date,
        @local_hour,
        @metadata_json
      )
    `),
    listMemoryObservationsStmt: db.prepare<[string], MemoryObservationRow>(`
      SELECT * FROM memory_observations
      WHERE memory_uri = ?
      ORDER BY created_at_ms ASC, id ASC
    `),
  };
}

