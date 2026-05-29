export const AgentConversationEntryKinds = {
  UserMessage: "user.message",
  ContextToolResults: "context.tool_results",
  AssistantDecision: "assistant.decision",
} as const;

export type AgentConversationEntryKind =
  typeof AgentConversationEntryKinds[keyof typeof AgentConversationEntryKinds];

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
    })
  | (AgentConversationEntryBase & {
      kind: typeof AgentConversationEntryKinds.ContextToolResults;
      xml: string;
    })
  | (AgentConversationEntryBase & {
      kind: typeof AgentConversationEntryKinds.AssistantDecision;
      xml: string;
    });

export function createConversationEntryId(
  requestId: string,
  slot: "user" | "tool_results" | "assistant",
): string {
  return `${requestId}:${slot}`;
}
import type { AgentConversationEntryMetadata } from "./AgentModelMetadata.js";
