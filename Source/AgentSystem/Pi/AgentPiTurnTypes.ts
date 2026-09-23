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
import type { AgentResidentState } from "../Continuity/AgentResidentState.js";

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
  liveContext?: string;
  conversationEntries: AgentConversationEntry[];
  rootCommand: AgentRootCommand;
  approvalMode: AgentExecutionApprovalMode;
  toolAccessGrant: AgentToolAccessGrant;
  loadedToolNames: string[];
  activeSkills: AgentActivatedSkill[];
  /** Host-confirmed dynamic capabilities prepared for this turn. */
  reusableCapabilities?: readonly AgentToolCapabilityCacheEntry[];
  /** Cross-request lookup used by the execution bridge to accept a dynamic
   * tool whose contract was confirmed earlier in the session. */
  reusableCapabilityLookup?: (toolName: string) => AgentToolCapabilityCacheEntry | undefined;
  roleplayPresetActive?: boolean;
  prefaceRewriteEnabled?: boolean;
  /** Explicit UI-controlled final-answer rewrite; independent from roleplay presets. */
  finalResponseRewriteEnabled?: boolean;
  onPiBranchBoundary?: (entryId: string) => void | Promise<void>;
  /** Full text of the final assistant message emitted by the Pi session. */
  onFinalResponseAvailable?: (content: string) => void | Promise<void>;
  thinkingLevel?: ModelThinkingLevel;
  inheritProjectContext?: boolean;
  /** Assignment owner for child sessions; absent for ordinary conversations. */
  resourceOwner?: AgentToolResourceLeaseOwner;
  /** Durable resident stance entering this turn; seeds the live in-turn stance. */
  seedResidentState?: AgentResidentState;
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
