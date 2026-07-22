import type {
  AgentMemoryCandidateRecord,
  AgentMemoryEpisodeRecord,
  AgentMemoryItemRecord,
  AgentMemoryItemVectorRecord,
  AgentMemoryObservationRecord,
  AgentMemorySourceRecord,
} from "./AgentMemorySourceRepository.js";
import type {
  EpisodeRow,
  MemoryCandidateRow,
  MemoryItemRow,
  MemoryItemVectorRow,
  MemoryObservationRow,
  SourceRow,
} from "./AgentMemorySqlRows.js";
import {
  parseMemoryRowJsonObject,
  parseMemoryRowNumberArray,
  parseMemoryRowStringArray,
  readMemoryRowMetadataString,
} from "./AgentMemoryRowJson.js";

export function rowToEpisode(row: EpisodeRow): AgentMemoryEpisodeRecord {
  return {
    id: row.id,
    uri: row.uri,
    sessionId: row.session_id,
    requestId: row.request_id,
    status: row.status,
    rawUserText: row.raw_user_text,
    standaloneRequest: row.standalone_request,
    contextMode: row.context_mode,
    contextBasis: row.context_basis,
    topic: row.topic,
    summary: row.summary,
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

export function rowToMemoryCandidate(row: MemoryCandidateRow): AgentMemoryCandidateRecord {
  return {
    id: row.id,
    uri: row.uri,
    type: row.type,
    subject: row.subject,
    claim: row.claim,
    howToApply: row.how_to_apply,
    tags: parseMemoryRowStringArray(row.tags_json),
    triggers: parseMemoryRowStringArray(row.triggers_json),
    sourceRefs: parseMemoryRowStringArray(row.source_refs_json),
    reason: readMemoryRowMetadataString(row.metadata_json, "learningReason"),
    confidence: row.confidence,
    embedding: parseMemoryRowNumberArray(row.embedding_json),
    status: row.status,
    sessionId: row.session_id,
    sourceEpisodeUri: row.source_episode_uri,
    sourceRequestId: row.source_request_id,
    promotedMemoryUri: row.promoted_memory_uri,
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

export function rowToMemoryItem(row: MemoryItemRow): AgentMemoryItemRecord {
  return {
    id: row.id,
    uri: row.uri,
    type: row.type,
    subject: row.subject,
    claim: row.claim,
    howToApply: row.how_to_apply,
    tags: parseMemoryRowStringArray(row.tags_json),
    triggers: parseMemoryRowStringArray(row.triggers_json),
    sourceRefs: parseMemoryRowStringArray(row.source_refs_json),
    status: row.status,
    confidence: row.confidence,
    sessionId: row.session_id,
    sourceEpisodeUri: row.source_episode_uri,
    sourceRequestId: row.source_request_id,
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

export function rowToMemoryItemVector(row: MemoryItemVectorRow): AgentMemoryItemVectorRecord {
  return {
    memoryUri: row.memory_uri,
    model: row.model,
    dimensions: row.dimensions,
    embedding: parseMemoryRowNumberArray(row.embedding_json) ?? [],
    updatedAt: row.updated_at,
    updatedAtMs: row.updated_at_ms,
  };
}

export function rowToMemoryObservation(row: MemoryObservationRow): AgentMemoryObservationRecord {
  return {
    id: row.id,
    uri: row.uri,
    memoryUri: row.memory_uri,
    writeSequence: row.write_sequence,
    operation: row.operation,
    candidateUris: parseMemoryRowStringArray(row.candidate_uris_json),
    sourceRefs: parseMemoryRowStringArray(row.source_refs_json),
    reason: row.reason,
    confidence: row.confidence,
    sessionId: row.session_id,
    sourceEpisodeUri: row.source_episode_uri,
    sourceRequestId: row.source_request_id,
    createdAt: row.created_at,
    createdAtMs: row.created_at_ms,
    timeZone: row.time_zone,
    localDate: row.local_date,
    localHour: row.local_hour,
    metadata: parseMemoryRowJsonObject(row.metadata_json),
  };
}
