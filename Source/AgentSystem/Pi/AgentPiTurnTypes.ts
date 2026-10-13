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
import type { AgentStateCard } from "../StateCard/AgentStateCardTypes.js";
import type { AgentToolSearchObservation } from "../ToolSearch/AgentToolSearchUsageMemory.js";

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
  rootCommand: AgentRootCommand;
  approvalMode: AgentExecutionApprovalMode;
  toolAccessGrant: AgentToolAccessGrant;
  loadedToolNames: string[];
  /** Explicitly selected Dynamic tools exposed as provider-native schemas. */
  nativeToolNames: string[];
  activeSkills: AgentActivatedSkill[];
  stateCard?: AgentStateCard;
  /** Host-confirmed dynamic capabilities prepared for this turn. */
  reusableCapabilities?: readonly AgentToolCapabilityCacheEntry[];
  /** Cross-request lookup used by the execution bridge to accept a dynamic
   * tool whose contract was confirmed earlier in the session. */
  reusableCapabilityLookup?: (toolName: string) => AgentToolCapabilityCacheEntry | undefined;
  personaActive?: boolean;
  prefaceRewriteEnabled?: boolean;
  /** Explicit UI-controlled final-answer rewrite; independent from persona text. */
  finalResponseRewriteEnabled?: boolean;
  onPiBranchBoundary?: (entryId: string) => void | Promise<void>;
  /** Full text of the final assistant message emitted by the Pi session. */
  onFinalResponseAvailable?: (content: string, messageIndex: number, contentIndex?: number) => void | Promise<void>;
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
  stepTraces: StepTrace[];
  executedTools: ExecutedToolCallResult[];
  loadedToolNames: string[];
  physicalPiSessionId?: string;
  routingObservation?: AgentToolSearchObservation;
}
