import { projectMemoryTime } from "./AgentMemoryTime.js";
import type {
  AgentMemoryCandidateRecord,
  AgentMemoryEpisodeRecord,
  AgentMemoryItemRecord,
  AgentMemoryItemVectorRecord,
  AgentMemoryItemVectorWrite,
  AgentMemoryObservationRecord,
  AgentMemorySourceRecord,
} from "./AgentMemorySourceRepository.js";

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
    summary: record.summary,
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

export function memoryItemToRow(record: AgentMemoryItemRecord): Record<string, unknown> {
  return {
    id: record.id,
    uri: record.uri,
    type: record.type,
    subject: record.subject,
    claim: record.claim,
    how_to_apply: record.howToApply,
    tags_json: JSON.stringify(record.tags),
    triggers_json: JSON.stringify(record.triggers),
    source_refs_json: JSON.stringify(record.sourceRefs),
    status: record.status,
    confidence: record.confidence,
    session_id: record.sessionId,
    source_episode_uri: record.sourceEpisodeUri,
    source_request_id: record.sourceRequestId,
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

export function memoryCandidateToRow(record: AgentMemoryCandidateRecord): Record<string, unknown> {
  return {
    id: record.id,
    uri: record.uri,
    type: record.type,
    subject: record.subject,
    claim: record.claim,
    how_to_apply: record.howToApply,
    tags_json: JSON.stringify(record.tags),
    triggers_json: JSON.stringify(record.triggers),
    source_refs_json: JSON.stringify(record.sourceRefs),
    status: record.status,
    confidence: record.confidence,
    embedding_json: JSON.stringify(record.embedding ?? []),
    session_id: record.sessionId,
    source_episode_uri: record.sourceEpisodeUri,
    source_request_id: record.sourceRequestId,
    promoted_memory_uri: record.promotedMemoryUri,
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

export function memoryItemVectorToRow(record: AgentMemoryItemVectorWrite): Record<string, unknown> {
  const normalized = buildMemoryItemVector(record);
  return {
    memory_uri: normalized.memoryUri,
    model: normalized.model,
    dimensions: normalized.dimensions,
    embedding_json: JSON.stringify(normalized.embedding),
    updated_at: normalized.updatedAt,
    updated_at_ms: normalized.updatedAtMs,
  };
}

export function memoryObservationToRow(record: AgentMemoryObservationRecord): Record<string, unknown> {
  return {
    id: record.id,
    uri: record.uri,
    memory_uri: record.memoryUri,
    operation: record.operation,
    candidate_uris_json: JSON.stringify(record.candidateUris),
    source_refs_json: JSON.stringify(record.sourceRefs),
    reason: record.reason,
    confidence: record.confidence,
    session_id: record.sessionId,
    source_episode_uri: record.sourceEpisodeUri,
    source_request_id: record.sourceRequestId,
    created_at: record.createdAt,
    created_at_ms: record.createdAtMs,
    time_zone: record.timeZone,
    local_date: record.localDate,
    local_hour: record.localHour,
    metadata_json: JSON.stringify(record.metadata),
  };
}

export function buildMemoryItemVector(record: AgentMemoryItemVectorWrite): AgentMemoryItemVectorRecord {
  const updatedAt = record.updatedAt ?? new Date().toISOString();
  const time = projectMemoryTime(updatedAt);
  return {
    memoryUri: record.memoryUri,
    model: record.model,
    dimensions: record.embedding.length,
    embedding: [...record.embedding],
    updatedAt,
    updatedAtMs: time.epochMs,
  };
}

export function memoryItemVectorKey(memoryUri: string, model: string): string {
  return `${memoryUri}\0${model}`;
}
