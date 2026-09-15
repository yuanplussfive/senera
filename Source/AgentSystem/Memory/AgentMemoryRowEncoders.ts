import type { AgentMemoryEpisodeRecord, AgentMemorySourceRecord } from "./AgentMemorySourceRepository.js";

export function episodeToRow(record: AgentMemoryEpisodeRecord): Record<string, unknown> {
  return {
    id: record.id,
    uri: record.uri,
    session_id: record.sessionId,
    request_id: record.requestId,
    status: record.status,
    raw_user_text: record.rawUserText,
    standalone_request: record.standaloneRequest,
    context_mode: record.contextMode,
    context_basis: record.contextBasis,
    topic: record.topic,
    summary: record.assistantPreview,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    updated_at: record.updatedAt,
    started_at_ms: record.startedAtMs,
    completed_at_ms: record.completedAtMs,
    updated_at_ms: record.updatedAtMs,
    time_zone: record.timeZone,
    local_date: record.localDate,
    local_hour: record.localHour,
    metadata_json: JSON.stringify(record.metadata),
  };
}

export function sourceToRow(record: AgentMemorySourceRecord): Record<string, unknown> {
  return {
    id: record.id,
    uri: record.uri,
    episode_id: record.episodeId,
    episode_uri: record.episodeUri,
    session_id: record.sessionId,
    request_id: record.requestId,
    source_kind: record.sourceKind,
    role: record.role,
    text_content: record.textContent,
    summary: record.summary,
    conversation_entry_id: record.conversationEntryId,
    evidence_uri: record.evidenceUri,
    artifact_uri: record.artifactUri,
    tool_name: record.toolName,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    created_at_ms: record.createdAtMs,
    updated_at_ms: record.updatedAtMs,
    time_zone: record.timeZone,
    local_date: record.localDate,
    local_hour: record.localHour,
    metadata_json: JSON.stringify(record.metadata),
  };
}
