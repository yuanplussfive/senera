import {
  AgentConversationEntryKinds,
  createConversationEntryId,
  type AgentConversationEntry,
} from "./AgentConversation.js";
import type { AgentConversationEntryMetadata } from "./AgentModelMetadata.js";
import type {
  AgentPlannerJournalEntryRecord,
  AgentToolEvidenceMemoryEntryRecord,
} from "./AgentPlannerMemory.js";
import type { AgentPlannerStateSnapshotRecord } from "./AgentPlannerState.js";
import type { AgentUploadAttachment } from "./Uploads/AgentUploadTypes.js";

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

  projectContextToolResults(
    requestId: string,
    xml: string,
    timestamp = this.now(),
    metadata?: AgentConversationEntryMetadata,
    scope?: string | number,
  ): Extract<AgentConversationEntry, { kind: "context.tool_results" }> {
    return {
      kind: AgentConversationEntryKinds.ContextToolResults,
      id: createConversationEntryId(requestId, "tool_results", scope),
      requestId,
      timestamp,
      xml,
      metadata,
    };
  }

  projectPlannerJournal(
    requestId: string,
    record: AgentPlannerJournalEntryRecord,
    timestamp = this.now(),
    metadata?: AgentConversationEntryMetadata,
    scope?: string | number,
  ): Extract<AgentConversationEntry, { kind: "planner.journal" }> {
    return {
      kind: AgentConversationEntryKinds.PlannerJournal,
      id: createConversationEntryId(requestId, "planner", scope ?? record.step),
      requestId,
      timestamp,
      record,
      metadata,
    };
  }

  projectPlannerStateSnapshot(
    requestId: string,
    record: AgentPlannerStateSnapshotRecord,
    timestamp = this.now(),
    metadata?: AgentConversationEntryMetadata,
    scope?: string | number,
  ): Extract<AgentConversationEntry, { kind: "planner.state_snapshot" }> {
    return {
      kind: AgentConversationEntryKinds.PlannerStateSnapshot,
      id: createConversationEntryId(requestId, "planner_state", scope ?? record.step),
      requestId,
      timestamp,
      record,
      metadata,
    };
  }

  projectToolEvidenceMemory(
    requestId: string,
    record: AgentToolEvidenceMemoryEntryRecord,
    timestamp = this.now(),
    metadata?: AgentConversationEntryMetadata,
    scope?: string | number,
  ): Extract<AgentConversationEntry, { kind: "tool.evidence_memory" }> {
    return {
      kind: AgentConversationEntryKinds.ToolEvidenceMemory,
      id: createConversationEntryId(requestId, "evidence_memory", scope ?? record.step),
      requestId,
      timestamp,
      record,
      metadata,
    };
  }

  private now(): string {
    return new Date().toISOString();
  }
}
