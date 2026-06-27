import type Database from "better-sqlite3";
import type {
  EpisodeRow,
  MemoryCandidateRow,
  MemoryItemRow,
  MemoryItemVectorRow,
  MemoryObservationRow,
  SourceRow,
} from "./AgentMemorySqlRows.js";

export interface AgentMemorySqlStatements {
  upsertEpisodeStmt: Database.Statement;
  deleteSourcesByEpisodeStmt: Database.Statement<[string]>;
  insertSourceStmt: Database.Statement;
  deleteSessionStmt: Database.Statement<[string]>;
  selectEpisodeForRequestStmt: Database.Statement<[string, string], EpisodeRow>;
  selectEpisodeByUriStmt: Database.Statement<[string], EpisodeRow>;
  deleteEpisodesFromTimeStmt: Database.Statement<[string, number]>;
  deleteExactEpisodeStmt: Database.Statement<[string, string]>;
  listEpisodesStmt: Database.Statement<[string], EpisodeRow>;
  listCompletedEpisodesStmt: Database.Statement<[], EpisodeRow>;
  listSourcesStmt: Database.Statement<[string], SourceRow>;
  selectSourceByUriStmt: Database.Statement<[string], SourceRow>;
  selectSourcesByEvidenceUriStmt: Database.Statement<[string], SourceRow>;
  selectSourcesByArtifactUriStmt: Database.Statement<[string], SourceRow>;
  insertMemoryCandidateStmt: Database.Statement;
  listPendingMemoryCandidatesStmt: Database.Statement<[string], MemoryCandidateRow>;
  listPendingMemoryCandidatesByTypeStmt: Database.Statement<[string, string], MemoryCandidateRow>;
  promoteMemoryCandidateStmt: Database.Statement<[string, string, number, string, string, string, string]>;
  insertMemoryItemStmt: Database.Statement;
  updateMemoryItemStmt: Database.Statement;
  supersedeMemoryItemStmt: Database.Statement<[string, number, string, string, string, string]>;
  rejectMemoryCandidateStmt: Database.Statement<[string, number, string, string, string, string]>;
  insertMemoryObservationStmt: Database.Statement;
  listMemoryObservationsStmt: Database.Statement<[string], MemoryObservationRow>;
  selectMemoryItemByUriStmt: Database.Statement<[string], MemoryItemRow>;
  listActiveMemoryItemsStmt: Database.Statement<[], MemoryItemRow>;
  upsertMemoryItemVectorStmt: Database.Statement;
  listMemoryItemVectorsStmt: Database.Statement<[string], MemoryItemVectorRow>;
}

export function prepareAgentMemorySqlStatements(db: Database.Database): AgentMemorySqlStatements {
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
    selectMemoryItemByUriStmt: db.prepare<[string], MemoryItemRow>(`
      SELECT * FROM memory_items WHERE uri = ?
    `),
    listActiveMemoryItemsStmt: db.prepare<[], MemoryItemRow>(`
      SELECT * FROM memory_items
      WHERE status = 'active'
      ORDER BY updated_at_ms DESC, id ASC
    `),
    upsertMemoryItemVectorStmt: db.prepare(`
      INSERT INTO memory_item_vectors (
        memory_uri,
        model,
        dimensions,
        embedding_json,
        updated_at,
        updated_at_ms
      )
      VALUES (
        @memory_uri,
        @model,
        @dimensions,
        @embedding_json,
        @updated_at,
        @updated_at_ms
      )
      ON CONFLICT(memory_uri, model) DO UPDATE SET
        dimensions = excluded.dimensions,
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at,
        updated_at_ms = excluded.updated_at_ms
    `),
    listMemoryItemVectorsStmt: db.prepare<[string], MemoryItemVectorRow>(`
      SELECT * FROM memory_item_vectors
      WHERE model = ?
      ORDER BY updated_at_ms DESC, memory_uri ASC
    `),
  };
}
