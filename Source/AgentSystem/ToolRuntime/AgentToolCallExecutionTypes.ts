import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentToolAccessGrant } from "./AgentToolAccessGrant.js";
import type { AgentToolExposureState } from "./AgentToolExposureState.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentResourceAccessGrant } from "../Execution/SeneraResourceAccess.js";

export type AgentToolCallExecutionResult =
  | {
      kind: "ToolResults";
      value: ExecutedToolCallResult[];
    }
  | {
      kind: "AskUser";
      value: AskUserControlResult;
    }
  | {
      kind: "SuspendChildRun";
      value: SuspendChildRunControlResult;
    };

export type AgentExecutionResult = AgentToolCallExecutionResult;

export interface AskUserControlResult {
  question: string;
  reason_code?: string;
}

export interface SuspendChildRunControlResult {
  readonly childRunId: string;
  readonly messageId: string;
  readonly message: string;
}

export interface AgentToolCallExecutionContext {
  sessionId?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  toolAccessGrant: AgentToolAccessGrant;
  resourceAccessGrant?: AgentResourceAccessGrant;
  toolExposure?: AgentToolExposureState;
  batchId?: string;
  batchToolNames?: readonly string[];
  signal?: AbortSignal;
  tokenBudget?: AgentToolTokenBudget;
  approvalMode?: AgentExecutionApprovalMode;
  activeSkills?: readonly AgentActivatedSkill[];
  thinkingLevel?: ModelThinkingLevel;
  onLifecycleSettled?: (status: "completed" | "failed") => void;
  deferResultDetail?: boolean;
}

export interface AgentToolCallExecutionRequest {
  name: string;
  arguments?: Record<string, unknown>;
  expectedContractDigest?: string | null;
  callId?: string;
  index?: number;
}
