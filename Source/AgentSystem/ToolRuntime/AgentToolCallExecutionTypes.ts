import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentToolAccessGrant } from "./AgentToolAccessGrant.js";
import type { AgentToolExposureState } from "./AgentToolExposureState.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentResourceAccessGrant } from "../Execution/SeneraResourceAccess.js";
import type { AgentToolCapabilityCacheEntry } from "../ToolSearch/AgentToolCapabilitySessionCache.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentBrowserTargetAuthorization } from "../Browser/AgentBrowserUrlPolicy.js";
import type { AgentWorkspaceObservationPort } from "../Artifacts/AgentWorkspaceChangeObserver.js";

export type AgentToolCallExecutionResult =
  | {
      kind: "ToolResults";
      value: ExecutedToolCallResult[];
    }
  | {
      kind: "SuspendChildRun";
      value: SuspendChildRunControlResult;
    };

export type AgentExecutionResult = AgentToolCallExecutionResult;

export interface SuspendChildRunControlResult {
  readonly childRunId: string;
  readonly messageId: string;
  readonly message: string;
}

export interface AgentToolCallExecutionContext {
  interaction?: AgentInteractionContext;
  sessionId?: string;
  logicalCacheScope?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  toolAccessGrant: AgentToolAccessGrant;
  resourceAccessGrant?: AgentResourceAccessGrant;
  browserTargetAuthorization?: AgentBrowserTargetAuthorization;
  toolExposure?: AgentToolExposureState;
  batchId?: string;
  batchToolNames?: readonly string[];
  modelMessageIndex?: number;
  modelContentIndex?: number;
  signal?: AbortSignal;
  tokenBudget?: AgentToolTokenBudget;
  approvalMode?: AgentExecutionApprovalMode;
  activeSkills?: readonly AgentActivatedSkill[];
  reusableCapabilities?: readonly AgentToolCapabilityCacheEntry[];
  thinkingLevel?: ModelThinkingLevel;
  onLifecycleSettled?: (status: "completed" | "failed") => void;
  deferResultDetail?: boolean;
  workspaceObservation?: AgentWorkspaceObservationPort;
}

export interface AgentToolCallExecutionRequest {
  name: string;
  arguments?: Record<string, unknown>;
  expectedContractDigest?: string | null;
  callId?: string;
  index?: number;
}
