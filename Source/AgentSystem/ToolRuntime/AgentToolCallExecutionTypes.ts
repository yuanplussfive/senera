import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";

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
  loadedToolNames?: "all" | readonly string[];
  batchId?: string;
  signal?: AbortSignal;
}

export interface AgentToolCallExecutionRequest {
  name: string;
  arguments?: Record<string, unknown>;
  callId?: string;
  index?: number;
}
