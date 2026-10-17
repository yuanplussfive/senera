import { type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentTerminalResult } from "../Runtime/AgentExecutionProjector.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentStateCard } from "../StateCard/AgentStateCardTypes.js";

export { DefaultAgentMemoryTimeZone } from "./AgentMemoryTime.js";
export { InMemoryAgentMemorySourceRepository } from "./AgentMemoryInMemorySourceRepository.js";
export { SqliteAgentMemorySourceRepository } from "./AgentMemorySqliteSourceRepository.js";

export type AgentMemoryEpisodeStatus = "completed";
export type AgentMemorySourceKind = "user_message" | "assistant_final" | "tool_evidence" | "artifact";

export interface AgentMemoryEpisodeRecord {
  id: string;
  uri: string;
  sessionId: string;
  requestId: string;
  status: AgentMemoryEpisodeStatus;
  rawUserText: string;
  standaloneRequest: string;
  contextBasis: string;
  topic: string;
  /** Physical final text; learning previews are bounded by the configured model tokenizer. */
  assistantText: string;
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

export interface AgentMemoryRecordedTurn {
  episode: AgentMemoryEpisodeRecord;
  sources: AgentMemorySourceRecord[];
}

export interface AgentMemoryDeletionImpact {
  readonly sessionId: string;
  /** The deletion boundary used by derived-state sinks. Legacy callers omit it and mean session scope. */
  readonly scope?: "session" | "from_request";
  readonly requestId?: string;
  readonly requestIds?: readonly string[];
  readonly episodeUris: readonly string[];
  readonly sourceUris: readonly string[];
}

export interface AgentMemoryCompletedTurnInput {
  sessionId: string;
  requestId: string;
  startedAt: string;
  completedAt: string;
  userEntry: Extract<AgentConversationEntry, { kind: "user.message" }>;
  assistantEntry: Extract<AgentConversationEntry, { kind: "assistant.decision" }>;
  terminal: AgentTerminalResult;
  executedTools: readonly ExecutedToolCallResult[];
  modelProvider?: AgentModelProviderMetadata;
  /** The resolved scenario card used to prepare the completed turn. */
  stateCard?: AgentStateCard;
}

export interface AgentMemorySourceRepository {
  /** O(1) revision for cache invalidation; changes after any physical history mutation. */
  catalogRevision(): string;
  recordCompletedTurn(input: AgentMemoryCompletedTurnInput): AgentMemoryRecordedTurn;
  deleteSession(sessionId: string): AgentMemoryDeletionImpact;
  deleteFromSessionRequest(sessionId: string, requestId: string): AgentMemoryDeletionImpact;
  listEpisodes(sessionId: string): AgentMemoryEpisodeRecord[];
  listCompletedEpisodes(): AgentMemoryEpisodeRecord[];
  findEpisodesByUris(uris: readonly string[]): AgentMemoryEpisodeRecord[];
  listSources(episodeUri: string): AgentMemorySourceRecord[];
  close(): void;
}
