import type { EpisodeRow, SourceRow } from "./AgentMemorySqlRows.js";
import type { AgentMemoryEpisodeRecord, AgentMemorySourceRecord } from "./AgentMemorySourceRepository.js";
import { parseMemoryRowJsonObject } from "./AgentMemoryRowJson.js";

export function rowToEpisode(row: EpisodeRow): AgentMemoryEpisodeRecord {
  return {
    id: row.id,
    uri: row.uri,
    sessionId: row.session_id,
    requestId: row.request_id,
    status: row.status,
    rawUserText: row.raw_user_text,
    standaloneRequest: row.standalone_request,
    contextBasis: row.context_basis,
    topic: row.topic,
    assistantText: row.assistant_text,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    startedAtMs: row.started_at_ms,
    completedAtMs: row.completed_at_ms,
    updatedAtMs: row.updated_at_ms,
    timeZone: row.time_zone,
    localDate: row.local_date,
    localHour: row.local_hour,
    metadata: parseMemoryRowJsonObject(row.metadata_json),
  };
}

export function rowToSource(row: SourceRow): AgentMemorySourceRecord {
  return {
    id: row.id,
    uri: row.uri,
    episodeId: row.episode_id,
    episodeUri: row.episode_uri,
    sessionId: row.session_id,
    requestId: row.request_id,
    sourceKind: row.source_kind,
    role: row.role,
    textContent: row.text_content,
    summary: row.summary,
    conversationEntryId: row.conversation_entry_id,
    evidenceUri: row.evidence_uri,
    artifactUri: row.artifact_uri,
    toolName: row.tool_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    timeZone: row.time_zone,
    localDate: row.local_date,
    localHour: row.local_hour,
    metadata: parseMemoryRowJsonObject(row.metadata_json),
  };
}
