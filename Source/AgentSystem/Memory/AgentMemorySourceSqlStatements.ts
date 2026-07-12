import type Database from "better-sqlite3";
import type { SourceRow } from "./AgentMemorySqlRows.js";

export interface AgentMemorySourceSqlStatements {
  deleteSourcesByEpisodeStmt: Database.Statement<[string]>;
  insertSourceStmt: Database.Statement;
  listSourcesStmt: Database.Statement<[string], SourceRow>;
  selectSourceByUriStmt: Database.Statement<[string], SourceRow>;
  selectSourcesByEvidenceUriStmt: Database.Statement<[string], SourceRow>;
  selectSourcesByArtifactUriStmt: Database.Statement<[string], SourceRow>;
}

export function prepareAgentMemorySourceSqlStatements(db: Database.Database): AgentMemorySourceSqlStatements {
  return {
    deleteSourcesByEpisodeStmt: db.prepare<[string]>(`
      DELETE FROM memory_sources WHERE episode_id = ?
    `),
    insertSourceStmt: db.prepare(`
      INSERT INTO memory_sources (
        id,
        uri,
        episode_id,
        episode_uri,
        session_id,
        request_id,
        source_kind,
        role,
        text_content,
        summary,
        conversation_entry_id,
        evidence_uri,
        artifact_uri,
        tool_name,
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
        @episode_id,
        @episode_uri,
        @session_id,
        @request_id,
        @source_kind,
        @role,
        @text_content,
        @summary,
        @conversation_entry_id,
        @evidence_uri,
        @artifact_uri,
        @tool_name,
        @created_at,
        @updated_at,
        @created_at_ms,
        @updated_at_ms,
        @time_zone,
        @local_date,
        @local_hour,
        @metadata_json
      )
      ON CONFLICT(uri) DO UPDATE SET
        episode_id = excluded.episode_id,
        episode_uri = excluded.episode_uri,
        session_id = excluded.session_id,
        request_id = excluded.request_id,
        source_kind = excluded.source_kind,
        role = excluded.role,
        text_content = excluded.text_content,
        summary = excluded.summary,
        conversation_entry_id = excluded.conversation_entry_id,
        evidence_uri = excluded.evidence_uri,
        artifact_uri = excluded.artifact_uri,
        tool_name = excluded.tool_name,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        created_at_ms = excluded.created_at_ms,
        updated_at_ms = excluded.updated_at_ms,
        time_zone = excluded.time_zone,
        local_date = excluded.local_date,
        local_hour = excluded.local_hour,
        metadata_json = excluded.metadata_json
    `),
    listSourcesStmt: db.prepare<[string], SourceRow>(`
      SELECT * FROM memory_sources
      WHERE episode_uri = ?
      ORDER BY created_at_ms ASC, source_kind ASC, id ASC
    `),
    selectSourceByUriStmt: db.prepare<[string], SourceRow>(`
      SELECT * FROM memory_sources WHERE uri = ?
    `),
    selectSourcesByEvidenceUriStmt: db.prepare<[string], SourceRow>(`
      SELECT * FROM memory_sources
      WHERE evidence_uri = ?
      ORDER BY created_at_ms ASC, id ASC
    `),
    selectSourcesByArtifactUriStmt: db.prepare<[string], SourceRow>(`
      SELECT * FROM memory_sources
      WHERE artifact_uri = ?
      ORDER BY created_at_ms ASC, id ASC
    `),
  };
}
