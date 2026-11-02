import {
  AgentConversationEntryKinds,
  createConversationEntryId,
  type AgentConversationEntry,
} from "./AgentConversation.js";
import type { AgentConversationEntryMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";

export class AgentConversationProjector {
  projectUserInput(
    requestId: string,
    content: string,
    timestamp = this.now(),
    metadata?: AgentConversationEntryMetadata,
    attachments?: readonly AgentUploadAttachment[],
  ): Extract<AgentConversationEntry, { kind: "user.message" }> {
    return {
      kind: AgentConversationEntryKinds.UserMessage,
      id: createConversationEntryId(requestId, "user"),
      requestId,
      timestamp,
      content,
      attachments: attachments && attachments.length > 0 ? [...attachments] : undefined,
      metadata,
    };
  }

  projectAssistantDecision(
    requestId: string,
    xml: string,
    timestamp = this.now(),
    metadata?: AgentConversationEntryMetadata,
    scope?: string | number,
  ): Extract<AgentConversationEntry, { kind: "assistant.decision" }> {
    return {
      kind: AgentConversationEntryKinds.AssistantDecision,
      id: createConversationEntryId(requestId, "assistant", scope),
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
