import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentToolTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import type { AgentPiToolDetails } from "./AgentPiToolResultDetails.js";
import type { AgentPiTurnState } from "./AgentPiTurnState.js";
import type { AgentNativeToolApi, AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentToolResourceLeaseOwner } from "../ToolRuntime/AgentToolResourceScheduler.js";
import type { AgentToolCapabilityCacheEntry } from "../ToolSearch/AgentToolCapabilitySessionCache.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { ToolDefinition, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolComposition, AgentToolCompositionState } from "../ToolRuntime/AgentToolComposition.js";

export {
  AgentPiToolResultStatuses,
  type AgentPiToolResultStatus,
  type AgentPiToolDetails,
} from "./AgentPiToolResultDetails.js";

export type AgentPiToolSchema = TSchema & Record<string, unknown>;
export type AgentPiToolDefinition = Pick<
  ToolDefinition<AgentPiToolSchema, AgentPiToolDetails>,
  "name" | "label" | "description" | "parameters" | "executionMode" | "exposure"
> & {
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: AgentPiToolUpdate,
    context?: ExtensionToolContext,
  ): Promise<AgentPiToolResult>;
};
export type AgentPiToolResult = AgentToolResult<AgentPiToolDetails>;
export type AgentPiToolUpdate = AgentToolUpdateCallback<AgentPiToolDetails>;

export interface AgentPiToolProjectionContext {
  interaction?: AgentInteractionContext;
  sessionId?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  visibleToolNames?: readonly string[];
  /** Dynamic tools explicitly selected for native schema exposure this turn. */
  nativeToolNames?: readonly string[];
  toolAccessGrant?: AgentToolAccessGrant;
  toolExposure?: AgentToolExposureState;
  turnState?: AgentPiTurnState;
  signal?: AbortSignal;
  activeSkills?: readonly AgentActivatedSkill[];
  rootCommand?: AgentRootCommand;
  approvalMode?: AgentExecutionApprovalMode;
  tokenBudget?: AgentToolTokenBudget;
  thinkingLevel?: ModelThinkingLevel;
  /** Assignment owner, present only for child-run sessions with a lease. */
  resourceOwner?: AgentToolResourceLeaseOwner;
  reusableCapabilities?: readonly AgentToolCapabilityCacheEntry[];
  compositionState?: AgentToolCompositionState;
}

export interface AgentPiToolExecutionInput {
  tool: RegisteredTool;
  toolCallId: string;
  params: Record<string, unknown>;
  signal?: AbortSignal;
  context: AgentPiToolProjectionContext;
  /** Host-visible note appended to the observation, e.g. dropped wrapper keys. */
  notice?: string;
  composition?: AgentToolComposition;
}

export type AgentPiModelApi = "senera-planning" | AgentNativeToolApi;

export type AgentPiModelProjection = Model<AgentPiModelApi>;

export interface AgentPiProviderProjection {
  providerId: string;
  model: AgentPiModelProjection;
  toolPlanningMode: AgentModelToolPlanningMode;
}
