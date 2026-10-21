import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type {
  AgentEffectiveModelReceipt,
  AgentSessionMetadata,
  AgentSessionModelPreference,
} from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";

export const AgentSessionStatuses = {
  Idle: "idle",
  Running: "running",
} as const;

export type AgentSessionStatus = (typeof AgentSessionStatuses)[keyof typeof AgentSessionStatuses];

export interface AgentSessionActiveRequest {
  requestId: string;
  input: string;
  startedAt: string;
  attachments?: AgentUploadAttachment[];
  /** Set as soon as the runtime resolves the provider for this turn. */
  effectiveModel?: AgentEffectiveModelReceipt;
}

export interface AgentSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: AgentSessionStatus;
  conversation: AgentConversationEntry[];
  metadata?: AgentSessionMetadata;
  activeRequest?: AgentSessionActiveRequest;
}

export interface AgentSessionSnapshot {
  sessionId: string;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  messageCount: number;
  turnCount: number;
  activeRequestId?: string;
  /** Origin channel for sessions created by a connector (QQ, Telegram, etc.). */
  channel?: AgentSessionMetadata["channel"];
  /** Durable conversation model preference, effective on the next turn. */
  modelProviderId?: string;
  /** The provider actually used by the active or most recent turn. */
  effectiveModel?: AgentEffectiveModelReceipt;
  /** Explicit next-turn preference, kept separate from the effective model. */
  modelPreference?: AgentSessionModelPreference;
}
