export const AgentConversationEntryKinds = {
  UserMessage: "user.message",
  ContextToolResults: "context.tool_results",
  AssistantDecision: "assistant.decision",
  PlannerJournal: "planner.journal",
  PlannerStateSnapshot: "planner.state_snapshot",
  ToolEvidenceMemory: "tool.evidence_memory",
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
      attachments?: AgentUploadAttachment[];
    })
  | (AgentConversationEntryBase & {
      kind: typeof AgentConversationEntryKinds.ContextToolResults;
      xml: string;
    })
  | (AgentConversationEntryBase & {
      kind: typeof AgentConversationEntryKinds.AssistantDecision;
      xml: string;
    })
  | (AgentConversationEntryBase & {
      kind: typeof AgentConversationEntryKinds.PlannerJournal;
      record: AgentPlannerJournalEntryRecord;
    })
  | (AgentConversationEntryBase & {
      kind: typeof AgentConversationEntryKinds.PlannerStateSnapshot;
      record: AgentPlannerStateSnapshotRecord;
    })
  | (AgentConversationEntryBase & {
      kind: typeof AgentConversationEntryKinds.ToolEvidenceMemory;
      record: AgentToolEvidenceMemoryEntryRecord;
    });

export function createConversationEntryId(
  requestId: string,
  slot: "user" | "tool_results" | "assistant" | "planner" | "planner_state" | "evidence_memory",
  scope?: string | number,
): string {
  return scope === undefined ? `${requestId}:${slot}` : `${requestId}:${slot}:${scope}`;
}
import type { AgentConversationEntryMetadata } from "./AgentModelMetadata.js";
import type {
  AgentPlannerJournalEntryRecord,
  AgentToolEvidenceMemoryEntryRecord,
} from "./AgentPlannerMemory.js";
import type { AgentPlannerStateSnapshotRecord } from "./AgentPlannerState.js";
import type { AgentUploadAttachment } from "./Uploads/AgentUploadTypes.js";
