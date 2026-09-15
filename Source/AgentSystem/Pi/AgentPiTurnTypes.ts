import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type {
  AgentEffectiveModelReceipt,
  AgentModelProviderMetadata,
  AgentModelUsage,
} from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { StepTrace } from "../Core/AgentStepTrace.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentToolResourceLeaseOwner } from "../ToolRuntime/AgentToolResourceScheduler.js";
import type { AgentToolCapabilityCacheEntry } from "../ToolSearch/AgentToolCapabilitySessionCache.js";

export interface AgentPiTurnRequest {
  sessionId?: string;
  logicalCacheScope?: string;
  effectiveModel?: AgentEffectiveModelReceipt;
  requestId: string;
  step: number;
  input: string;
  attachments?: AgentUploadAttachment[];
  interaction?: AgentInteractionContext;
  prompt: string;
  turnContext?: string;
  conversationEntries: AgentConversationEntry[];
  rootCommand: AgentRootCommand;
  approvalMode: AgentExecutionApprovalMode;
  toolAccessGrant: AgentToolAccessGrant;
  loadedToolNames: string[];
  activeSkills: AgentActivatedSkill[];
  /** Host-confirmed dynamic capabilities prepared for this turn. */
  reusableCapabilities?: readonly AgentToolCapabilityCacheEntry[];
  roleplayPresetActive?: boolean;
  prefaceRewriteEnabled?: boolean;
  onPiBranchBoundary?: (entryId: string) => void | Promise<void>;
  /** Full text of the final assistant message emitted by the Pi session. */
  onFinalResponseAvailable?: (content: string) => void | Promise<void>;
  thinkingLevel?: ModelThinkingLevel;
  inheritProjectContext?: boolean;
  /** Assignment owner for child sessions; absent for ordinary conversations. */
  resourceOwner?: AgentToolResourceLeaseOwner;
}

export interface AgentPiTurnResult {
  requestId: string;
  step: number;
  responseText: string;
  modelProvider: AgentModelProviderMetadata;
  usage: AgentModelUsage;
  conversationEntries: AgentConversationEntry[];
  stepTraces: StepTrace[];
  executedTools: ExecutedToolCallResult[];
  loadedToolNames: string[];
  physicalPiSessionId?: string;
}
