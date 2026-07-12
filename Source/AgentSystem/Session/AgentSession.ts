import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentSessionMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
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
}
