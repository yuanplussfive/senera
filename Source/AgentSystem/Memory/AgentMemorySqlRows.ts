import type {
  AgentMemoryCandidateStatus,
  AgentMemoryEpisodeStatus,
  AgentMemoryItemStatus,
  AgentMemoryLearningOperation,
  AgentMemorySourceKind,
  AgentMemoryType,
} from "./AgentMemorySourceRepository.js";

export interface EpisodeRow {
  id: string;
  uri: string;
  session_id: string;
  request_id: string;
  status: AgentMemoryEpisodeStatus;
  raw_user_text: string;
  standalone_request: string;
  context_mode: string;
  context_basis: string;
  topic: string;
  summary: string;
  started_at: string;
  completed_at: string;
  updated_at: string;
  started_at_ms: number;
  completed_at_ms: number;
  updated_at_ms: number;
  time_zone: string;
  local_date: string;
  local_hour: string;
  metadata_json: string;
}

export interface SourceRow {
  id: string;
  uri: string;
  episode_id: string;
  episode_uri: string;
  session_id: string;
  request_id: string;
  source_kind: AgentMemorySourceKind;
  role: string;
  text_content: string | null;
  summary: string | null;
  conversation_entry_id: string;
  evidence_uri: string;
  artifact_uri: string;
  tool_name: string;
  created_at: string;
  updated_at: string;
  created_at_ms: number;
  updated_at_ms: number;
  time_zone: string;
  local_date: string;
  local_hour: string;
  metadata_json: string;
}

export interface MemoryItemRow {
  id: string;
  uri: string;
  type: AgentMemoryType;
  subject: string;
  claim: string;
  how_to_apply: string;
  tags_json: string;
  triggers_json: string;
  source_refs_json: string;
  status: AgentMemoryItemStatus;
  confidence: number;
  session_id: string;
  source_episode_uri: string;
  source_request_id: string;
  created_at: string;
  updated_at: string;
  created_at_ms: number;
  updated_at_ms: number;
  time_zone: string;
  local_date: string;
  local_hour: string;
  metadata_json: string;
}

export interface MemoryCandidateRow {
  id: string;
  uri: string;
  type: AgentMemoryType;
  subject: string;
  claim: string;
  how_to_apply: string;
  tags_json: string;
  triggers_json: string;
  source_refs_json: string;
  status: AgentMemoryCandidateStatus;
  confidence: number;
  embedding_json: string;
  session_id: string;
  source_episode_uri: string;
  source_request_id: string;
  promoted_memory_uri: string;
  created_at: string;
  updated_at: string;
  created_at_ms: number;
  updated_at_ms: number;
  time_zone: string;
  local_date: string;
  local_hour: string;
  metadata_json: string;
}

export interface MemoryItemVectorRow {
  memory_uri: string;
  model: string;
  dimensions: number;
  embedding_json: string;
  updated_at: string;
  updated_at_ms: number;
}

export interface MemoryObservationRow {
  id: string;
  uri: string;
  memory_uri: string;
  operation: AgentMemoryLearningOperation;
  candidate_uris_json: string;
  source_refs_json: string;
  reason: string;
  confidence: number;
  session_id: string;
  source_episode_uri: string;
  source_request_id: string;
  created_at: string;
  created_at_ms: number;
  time_zone: string;
  local_date: string;
  local_hour: string;
  metadata_json: string;
}
