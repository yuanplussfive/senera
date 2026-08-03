import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentToolAccessGrant } from "./AgentToolAccessGrant.js";
import type { AgentToolExposureState } from "./AgentToolExposureState.js";

export type AgentToolCallExecutionResult =
  | {
      kind: "ToolResults";
      value: ExecutedToolCallResult[];
    }
  | {
      kind: "AskUser";
      value: AskUserControlResult;
    };

export type AgentExecutionResult = AgentToolCallExecutionResult;

export interface AskUserControlResult {
  question: string;
  reason_code?: string;
}

export interface AgentToolCallExecutionContext {
  sessionId?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  toolAccessGrant: AgentToolAccessGrant;
  toolExposure?: AgentToolExposureState;
  batchId?: string;
  signal?: AbortSignal;
  tokenBudget?: AgentToolTokenBudget;
}

export interface AgentToolCallExecutionRequest {
  name: string;
  arguments?: Record<string, unknown>;
  expectedContractDigest?: string | null;
  callId?: string;
  index?: number;
}
