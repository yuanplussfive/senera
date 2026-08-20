import type Database from "better-sqlite3";
import type { MemoryObservationRow } from "./AgentMemorySqlRows.js";

export interface AgentMemoryObservationSqlStatements {
  insertMemoryObservationStmt: Database.Statement;
  listMemoryObservationsStmt: Database.Statement<[string], MemoryObservationRow>;
  nextMemoryObservationWriteSequenceStmt: Database.Statement<[string], { next_write_sequence: number }>;
}

export function prepareAgentMemoryObservationSqlStatements(db: Database.Database): AgentMemoryObservationSqlStatements {
  return {
    insertMemoryObservationStmt: db.prepare(`
      INSERT INTO memory_observations (
        id,
        uri,
        memory_uri,
        write_sequence,
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
        @write_sequence,
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
      ORDER BY created_at_ms ASC, write_sequence ASC
    `),
    nextMemoryObservationWriteSequenceStmt: db.prepare<[string], { next_write_sequence: number }>(`
      SELECT COALESCE(MAX(write_sequence), 0) + 1 AS next_write_sequence
      FROM memory_observations
      WHERE memory_uri = ?
    `),
  };
}
