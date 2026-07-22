import { type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentTerminalResult } from "../Runtime/AgentExecutionProjector.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { AgentMemoryLearningJobRecord } from "./AgentMemoryLearningJob.js";

export { DefaultAgentMemoryTimeZone } from "./AgentMemoryTime.js";
export { InMemoryAgentMemorySourceRepository } from "./AgentMemoryInMemorySourceRepository.js";
export { AgentMemoryLearningJobStatuses, AgentMemoryLearningJobStatusValues } from "./AgentMemoryLearningJob.js";
export type { AgentMemoryLearningJobRecord, AgentMemoryLearningJobStatus } from "./AgentMemoryLearningJob.js";
export {
  DefaultAgentMemoryDatabasePath,
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "./AgentMemorySqliteSourceRepository.js";

export type AgentMemoryEpisodeStatus = "completed" | "memory_anchor";
export type AgentMemorySourceKind = "user_message" | "assistant_final" | "tool_evidence" | "artifact";
export const AgentMemoryTypes = ["profile", "preference", "knowledge", "scene"] as const;
export type AgentMemoryType = (typeof AgentMemoryTypes)[number];
export type AgentMemoryItemStatus = "active" | "superseded" | "archived" | "needs_review";
export type AgentMemoryCandidateStatus = "pending" | "promoted" | "rejected";
export type AgentMemoryLearningOperation = "create" | "reinforce" | "update" | "supersede" | "reject";
export interface AgentMemoryEpisodeRecord {
  id: string;
  uri: string;
  sessionId: string;
  requestId: string;
  status: AgentMemoryEpisodeStatus;
  rawUserText: string;
  standaloneRequest: string;
  contextMode: string;
  contextBasis: string;
  topic: string;
  summary: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  startedAtMs: number;
  completedAtMs: number;
  updatedAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemorySourceRecord {
  id: string;
  uri: string;
  episodeId: string;
  episodeUri: string;
  sessionId: string;
  requestId: string;
  sourceKind: AgentMemorySourceKind;
  role: string;
  textContent: string | null;
  summary: string | null;
  conversationEntryId: string;
  evidenceUri: string;
  artifactUri: string;
  toolName: string;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
  updatedAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemoryItemRecord {
  id: string;
  uri: string;
  type: AgentMemoryType;
  subject: string;
  claim: string;
  howToApply: string;
  tags: string[];
  triggers: string[];
  sourceRefs: string[];
  status: AgentMemoryItemStatus;
  confidence: number;
  sessionId: string;
  sourceEpisodeUri: string;
  sourceRequestId: string;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
  updatedAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemoryItemVectorRecord {
  memoryUri: string;
  model: string;
  dimensions: number;
  embedding: number[];
  updatedAt: string;
  updatedAtMs: number;
}

export interface AgentMemoryItemVectorWrite {
  memoryUri: string;
  model: string;
  embedding: number[];
  updatedAt?: string;
}

export type AgentMemoryDirectWriteOperation = "create" | "reinforce" | "update" | "supersede";

export interface AgentMemoryDirectWriteInput {
  operation: AgentMemoryDirectWriteOperation;
  type: AgentMemoryType;
  subject: string;
  claim: string;
  howToApply: string;
  tags: readonly string[];
  triggers: readonly string[];
  confidence: number;
  targetMemoryUri?: string;
  reason?: string;
  requestId?: string;
  writtenAt?: string;
}

export interface AgentMemoryLearningActionRecord {
  operation: AgentMemoryLearningOperation;
  type: AgentMemoryType;
  subject: string;
  claim: string;
  howToApply: string;
  tags: string[];
  triggers: string[];
  sourceRefs: string[];
  targetMemoryUri?: string;
  reason: string;
  confidence: number;
}

export interface AgentMemoryConsolidationActionRecord extends AgentMemoryLearningActionRecord {
  candidateUris: string[];
}

export interface AgentMemoryCandidateDraft {
  type: AgentMemoryType;
  subject: string;
  claim: string;
  howToApply: string;
  tags: string[];
  triggers: string[];
  sourceRefs: string[];
  reason: string;
  confidence: number;
  embedding?: number[];
}

export interface AgentMemoryCandidateRecord extends AgentMemoryCandidateDraft {
  id: string;
  uri: string;
  status: AgentMemoryCandidateStatus;
  sessionId: string;
  sourceEpisodeUri: string;
  sourceRequestId: string;
  promotedMemoryUri: string;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
  updatedAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemoryObservationRecord {
  id: string;
  uri: string;
  memoryUri: string;
  writeSequence: number;
  operation: AgentMemoryLearningOperation;
  candidateUris: string[];
  sourceRefs: string[];
  reason: string;
  confidence: number;
  sessionId: string;
  sourceEpisodeUri: string;
  sourceRequestId: string;
  createdAt: string;
  createdAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemoryRecordedTurn {
  episode: AgentMemoryEpisodeRecord;
  sources: AgentMemorySourceRecord[];
}

export interface AgentMemoryLearningWriteInput {
  episode: AgentMemoryEpisodeRecord;
  actions: readonly AgentMemoryConsolidationActionRecord[];
  learnedAt?: string;
}

export interface AgentMemoryCandidateWriteInput {
  episode: AgentMemoryEpisodeRecord;
  candidates: readonly AgentMemoryCandidateDraft[];
  learnedAt?: string;
}

export interface AgentMemoryCompletedTurnInput {
  sessionId: string;
  requestId: string;
  startedAt: string;
  completedAt: string;
  userEntry: Extract<AgentConversationEntry, { kind: "user.message" }>;
  assistantEntry: Extract<AgentConversationEntry, { kind: "assistant.decision" }>;
  terminal: AgentTerminalResult;
  turnUnderstanding?: TurnUnderstanding;
  conversationEntries: readonly AgentConversationEntry[];
  modelProvider?: AgentModelProviderMetadata;
}

export interface AgentMemorySourceRepository {
  recordCompletedTurn(input: AgentMemoryCompletedTurnInput): AgentMemoryRecordedTurn;
  recordMemoryCandidates(input: AgentMemoryCandidateWriteInput): AgentMemoryCandidateRecord[];
  applyMemoryLearning(input: AgentMemoryLearningWriteInput): AgentMemoryItemRecord[];
  writeDirectMemory(input: AgentMemoryDirectWriteInput): AgentMemoryItemRecord;
  deleteSession(sessionId: string): void;
  deleteFromSessionRequest(sessionId: string, requestId: string): void;
  listEpisodes(sessionId: string): AgentMemoryEpisodeRecord[];
  listCompletedEpisodes(): AgentMemoryEpisodeRecord[];
  findEpisodesByUris(uris: readonly string[]): AgentMemoryEpisodeRecord[];
  listSources(episodeUri: string): AgentMemorySourceRecord[];
  findMemorySourcesByRefs(refs: readonly string[]): AgentMemorySourceRecord[];
  listPendingMemoryCandidates(sessionId: string, type?: AgentMemoryType): AgentMemoryCandidateRecord[];
  listMemoryCandidatesForEpisode(episodeUri: string): AgentMemoryCandidateRecord[];
  listActiveMemoryItems(): AgentMemoryItemRecord[];
  findMemoryItemsByUris(uris: readonly string[]): AgentMemoryItemRecord[];
  listMemoryObservations(memoryUri: string): AgentMemoryObservationRecord[];
  upsertMemoryItemVectors(records: readonly AgentMemoryItemVectorWrite[]): void;
  listMemoryItemVectors(model: string): AgentMemoryItemVectorRecord[];
  enqueueMemoryLearningJob(episodeUri: string, nowMs: number): void;
  resetRunningMemoryLearningJobs(nowMs: number): void;
  listDueMemoryLearningJobs(nowMs: number, limit: number): AgentMemoryLearningJobRecord[];
  nextMemoryLearningJobAtMs(): number | undefined;
  markMemoryLearningJobRunning(episodeUri: string, nowMs: number): AgentMemoryLearningJobRecord | undefined;
  markMemoryLearningJobCompleted(episodeUri: string, nowMs: number): void;
  markMemoryLearningJobFailed(
    episodeUri: string,
    input: { terminal: boolean; nextAttemptAtMs: number; lastError: string; updatedAtMs: number },
  ): void;
  listMemoryLearningJobs(): AgentMemoryLearningJobRecord[];
  close(): void;
}
