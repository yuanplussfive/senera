export const AgentConversationEntryKinds = {
  UserMessage: "user.message",
  AssistantDecision: "assistant.decision",
} as const;

export type AgentConversationEntryKind = (typeof AgentConversationEntryKinds)[keyof typeof AgentConversationEntryKinds];

interface AgentConversationEntryBase {
  id: string;
  requestId: string;
  timestamp: string;
  metadata?: AgentConversationEntryMetadata;
}

export type AgentConversationEntry =
  | (AgentConversationEntryBase & {
      kind: typeof AgentConversationEntryKinds.UserMessage;
      content: string;
      attachments?: AgentUploadAttachment[];
    })
  | (AgentConversationEntryBase & {
      kind: typeof AgentConversationEntryKinds.AssistantDecision;
      xml: string;
    });

export function createConversationEntryId(
  requestId: string,
  slot: "user" | "assistant",
  scope?: string | number,
): string {
  return scope === undefined ? `${requestId}:${slot}` : `${requestId}:${slot}:${scope}`;
}
import type { AgentConversationEntryMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
