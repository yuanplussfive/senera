import type Database from "better-sqlite3";
import type { MemoryItemRow } from "./AgentMemorySqlRows.js";

export interface AgentMemoryItemSqlStatements {
  insertMemoryItemStmt: Database.Statement;
  updateMemoryItemStmt: Database.Statement;
  supersedeMemoryItemStmt: Database.Statement<[string, number, string, string, string, string]>;
  selectMemoryItemByUriStmt: Database.Statement<[string], MemoryItemRow>;
  listActiveMemoryItemsStmt: Database.Statement<[], MemoryItemRow>;
}

export function prepareAgentMemoryItemSqlStatements(
  db: Database.Database,
): AgentMemoryItemSqlStatements {
  return {
    insertMemoryItemStmt: db.prepare(`
      INSERT INTO memory_items (
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
        session_id,
        source_episode_uri,
        source_request_id,
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
        @session_id,
        @source_episode_uri,
        @source_request_id,
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
    updateMemoryItemStmt: db.prepare(`
      UPDATE memory_items SET
        type = @type,
        subject = @subject,
        claim = @claim,
        how_to_apply = @how_to_apply,
        tags_json = @tags_json,
        triggers_json = @triggers_json,
        source_refs_json = @source_refs_json,
        status = @status,
        confidence = @confidence,
        session_id = @session_id,
        source_episode_uri = @source_episode_uri,
        source_request_id = @source_request_id,
        updated_at = @updated_at,
        updated_at_ms = @updated_at_ms,
        time_zone = @time_zone,
        local_date = @local_date,
        local_hour = @local_hour,
        metadata_json = @metadata_json
      WHERE uri = @uri
    `),
    supersedeMemoryItemStmt: db.prepare<[string, number, string, string, string, string]>(`
      UPDATE memory_items SET
        status = 'superseded',
        updated_at = ?,
        updated_at_ms = ?,
        time_zone = ?,
        local_date = ?,
        local_hour = ?
      WHERE uri = ?
    `),
    selectMemoryItemByUriStmt: db.prepare<[string], MemoryItemRow>(`
      SELECT * FROM memory_items WHERE uri = ?
    `),
    listActiveMemoryItemsStmt: db.prepare<[], MemoryItemRow>(`
      SELECT * FROM memory_items
      WHERE status = 'active'
      ORDER BY updated_at_ms DESC, id ASC
    `),
  };
}

