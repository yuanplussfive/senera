import { uniqueTrimmed } from "./AgentMemoryCollections.js";
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
import type {
  EpisodeRow,
  MemoryCandidateRow,
  MemoryItemRow,
  MemoryItemVectorRow,
  MemoryObservationRow,
  SourceRow,
} from "./AgentMemorySqlRows.js";

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
    metadata: parseJsonObject(row.metadata_json),
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
    metadata: parseJsonObject(row.metadata_json),
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
    tags: parseJsonStringArray(row.tags_json),
    triggers: parseJsonStringArray(row.triggers_json),
    sourceRefs: parseJsonStringArray(row.source_refs_json),
    reason: readMetadataString(row.metadata_json, "learningReason"),
    confidence: row.confidence,
    embedding: parseJsonNumberArray(row.embedding_json),
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
    metadata: parseJsonObject(row.metadata_json),
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
    tags: parseJsonStringArray(row.tags_json),
    triggers: parseJsonStringArray(row.triggers_json),
    sourceRefs: parseJsonStringArray(row.source_refs_json),
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
    metadata: parseJsonObject(row.metadata_json),
  };
}

export function rowToMemoryItemVector(row: MemoryItemVectorRow): AgentMemoryItemVectorRecord {
  return {
    memoryUri: row.memory_uri,
    model: row.model,
    dimensions: row.dimensions,
    embedding: parseJsonNumberArray(row.embedding_json) ?? [],
    updatedAt: row.updated_at,
    updatedAtMs: row.updated_at_ms,
  };
}

export function rowToMemoryObservation(row: MemoryObservationRow): AgentMemoryObservationRecord {
  return {
    id: row.id,
    uri: row.uri,
    memoryUri: row.memory_uri,
    operation: row.operation,
    candidateUris: parseJsonStringArray(row.candidate_uris_json),
    sourceRefs: parseJsonStringArray(row.source_refs_json),
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
    metadata: parseJsonObject(row.metadata_json),
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function parseJsonStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? uniqueTrimmed(parsed.filter((item): item is string => typeof item === "string"))
    : [];
}

function parseJsonNumberArray(value: string): number[] | undefined {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return undefined;
  }
  return parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function readMetadataString(metadataJson: string, key: string): string {
  const value = parseJsonObject(metadataJson)[key];
  return typeof value === "string" ? value : "";
}
