import type { AgentToolResult, AgentToolUpdateCallback, AgentTool } from "@earendil-works/pi-agent-core";
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

export {
  AgentPiToolResultStatuses,
  type AgentPiToolResultStatus,
  type AgentPiToolDetails,
} from "./AgentPiToolResultDetails.js";

export type AgentPiToolSchema = TSchema & Record<string, unknown>;
export type AgentPiToolDefinition = AgentTool<AgentPiToolSchema, AgentPiToolDetails>;
export type AgentPiToolResult = AgentToolResult<AgentPiToolDetails>;
export type AgentPiToolUpdate = AgentToolUpdateCallback<AgentPiToolDetails>;

export interface AgentPiToolProjectionContext {
  sessionId?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  visibleToolNames?: readonly string[];
  toolAccessGrant?: AgentToolAccessGrant;
  toolExposure?: AgentToolExposureState;
  turnState?: AgentPiTurnState;
  signal?: AbortSignal;
  activeSkills?: readonly AgentActivatedSkill[];
  rootCommand?: AgentRootCommand;
  approvalMode?: AgentExecutionApprovalMode;
  tokenBudget?: AgentToolTokenBudget;
  thinkingLevel?: ModelThinkingLevel;
}

export interface AgentPiToolExecutionInput {
  tool: RegisteredTool;
  toolCallId: string;
  params: Record<string, unknown>;
  signal?: AbortSignal;
  context: AgentPiToolProjectionContext;
}

export type AgentPiModelApi = "senera-planning" | AgentNativeToolApi;

export type AgentPiModelProjection = Model<AgentPiModelApi>;

export interface AgentPiProviderProjection {
  providerId: string;
  model: AgentPiModelProjection;
  toolPlanningMode: AgentModelToolPlanningMode;
}
