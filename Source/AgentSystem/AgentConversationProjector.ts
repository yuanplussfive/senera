import {
  AgentConversationEntryKinds,
  createConversationEntryId,
  type AgentConversationEntry,
} from "./AgentConversation.js";
import type { AgentConversationEntryMetadata } from "./AgentModelMetadata.js";

export class AgentConversationProjector {
  projectUserInput(
    requestId: string,
    content: string,
    timestamp = this.now(),
    metadata?: AgentConversationEntryMetadata,
  ): Extract<AgentConversationEntry, { kind: "user.message" }> {
    return {
      kind: AgentConversationEntryKinds.UserMessage,
      id: createConversationEntryId(requestId, "user"),
      requestId,
      timestamp,
      content,
      metadata,
    };
  }

  projectAssistantDecision(
    requestId: string,
    xml: string,
    timestamp = this.now(),
    metadata?: AgentConversationEntryMetadata,
  ): Extract<AgentConversationEntry, { kind: "assistant.decision" }> {
    return {
      kind: AgentConversationEntryKinds.AssistantDecision,
      id: createConversationEntryId(requestId, "assistant"),
      requestId,
      timestamp,
      xml,
      metadata,
    };
  }

  projectContextToolResults(
    requestId: string,
    xml: string,
    timestamp = this.now(),
    metadata?: AgentConversationEntryMetadata,
  ): Extract<AgentConversationEntry, { kind: "context.tool_results" }> {
    return {
      kind: AgentConversationEntryKinds.ContextToolResults,
      id: createConversationEntryId(requestId, "tool_results"),
      requestId,
      timestamp,
      xml,
      metadata,
    };
  }

  private now(): string {
    return new Date().toISOString();
  }
}
