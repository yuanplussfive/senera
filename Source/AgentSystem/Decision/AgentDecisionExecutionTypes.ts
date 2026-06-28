import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type {
  AgentDecision,
  ExecutedToolCallResult,
} from "../Types/ToolRuntimeTypes.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessRunner.js";

export type AgentToolCallsDecision = Extract<AgentDecision, { kind: "ToolCalls" }>;

export type AgentToolCallDecision =
  AgentToolCallsDecision["payload"]["tool_call"][number];

export type AgentExecutionResult =
  | {
      kind: "ToolResults";
      value: ExecutedToolCallResult[];
    }
  | {
      kind: "AskUser";
      value: AskUserControlResult;
    };

export interface AskUserControlResult {
  question: string;
  reason_code?: string;
}

export interface AgentDecisionExecutionContext {
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  loadedToolNames?: "all" | readonly string[];
  signal?: AbortSignal;
}

export type AgentToolControlResult = {
  kind: "AskUser";
  value: AskUserControlResult;
};

export interface ResolvedDecisionToolCall {
  call: AgentToolCallDecision;
  index: number;
  tool: RegisteredTool;
}

export interface ExecutedDecisionToolCall {
  callId: string;
  index: number;
  tool: RegisteredTool;
  args: Record<string, unknown>;
  execution: AgentToolProcessRunResult;
  workspaceCapture: ExecutedToolCallResult["workspaceCapture"];
  control?: AgentToolControlResult;
}
