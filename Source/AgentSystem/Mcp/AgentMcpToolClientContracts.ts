import { AgentBaseError } from "../Core/AgentBaseError.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { SeneraPersistentProcessSpawner } from "../Execution/SeneraPersistentProcessTypes.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type { AgentInteractionInputOwner } from "../Interaction/AgentInteractionInputTypes.js";
import type { AgentMcpRuntimeEndpoint } from "../McpPackages/AgentMcpPackageTypes.js";
import { AgentMcpProtocol } from "./AgentMcpProtocol.js";
import type { AgentMcpSamplingHandler } from "./AgentMcpSamplingRuntime.js";
import type { AgentMcpToolOutput } from "./AgentMcpToolOutputProtocol.js";
import type { AgentMcpToolsChangedHandler } from "./AgentMcpToolCatalogChange.js";

export interface AgentMcpToolProgress {
  readonly progress: number;
  readonly total?: number;
  readonly message?: string;
}

export interface AgentMcpToolCallCorrelation {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly step?: number;
  readonly toolCallId?: string;
  readonly batchId?: string;
}

export interface AgentMcpToolCallOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: AgentMcpToolProgress) => void;
  readonly onOutput?: (output: AgentMcpToolOutputEvent) => void;
  readonly task?: boolean;
  readonly onTask?: (task: AgentMcpToolTask) => void;
  readonly correlation?: AgentMcpToolCallCorrelation;
  readonly resumableEvents?: boolean;
  readonly taskEventCursor?: AgentMcpTaskEventCursor;
  readonly interactionOwner?: AgentInteractionInputOwner;
  readonly interactionEventSink?: AgentEventSink;
}

export type AgentMcpToolOutputEvent = Omit<AgentMcpToolOutput, "outputToken">;

export interface AgentMcpTaskEventCursor {
  value: number;
}

export interface AgentMcpToolTask {
  readonly taskId: string;
  readonly status: "working" | "input_required" | "completed" | "failed" | "cancelled";
  readonly statusMessage?: string;
  readonly pollInterval?: number;
  readonly terminal: boolean;
}

export interface AgentMcpToolClientOptions {
  readonly server: AgentMcpRuntimeEndpoint;
  readonly requestTimeoutMs: number;
  readonly spawnPersistentProcess: SeneraPersistentProcessSpawner;
  readonly executionProfile: SeneraProcessExecutionProfile;
  readonly terminationGraceMs: number;
  readonly maxFrameBytes?: number;
  readonly maxStderrBytes?: number;
  readonly signal?: AbortSignal;
  readonly interactionInput?: AgentInteractionInputRuntime;
  readonly sampling?: AgentMcpSamplingHandler;
  readonly onToolsChanged?: AgentMcpToolsChangedHandler;
}

export class AgentMcpTaskDetachedError extends AgentBaseError {
  constructor(
    readonly toolName: string,
    readonly taskId: string,
    options?: ErrorOptions,
  ) {
    super(`MCP task ${taskId} for ${toolName} detached from its client connection.`, options);
  }
}

export class AgentMcpTaskCancelledError extends AgentBaseError {
  constructor(readonly taskId: string) {
    super(`MCP task ${taskId} was cancelled.`);
  }
}

export class AgentMcpTaskInputRequiredError extends AgentBaseError {
  constructor(readonly taskId: string) {
    super(`MCP task ${taskId} requires interactive input, but this tool did not declare elicitation support.`);
  }
}

export class AgentMcpTaskEventCapabilityError extends AgentBaseError {
  constructor(readonly serverId: string) {
    super(
      `MCP server ${serverId} does not support ${AgentMcpProtocol.taskEvents.capability} version ${AgentMcpProtocol.taskEvents.version}.`,
    );
  }
}

export class AgentMcpUrlElicitationDeclinedError extends AgentBaseError {
  constructor(
    readonly elicitationId: string,
    readonly action: "decline" | "cancel",
  ) {
    super(`MCP URL elicitation ${elicitationId} was ${action === "decline" ? "declined" : "cancelled"}.`);
  }
}

export class AgentMcpTaskEventGapError extends AgentBaseError {
  constructor(
    readonly taskId: string,
    readonly deliveredCursor: number,
    readonly pageCursor: number,
  ) {
    super(`MCP task ${taskId} event replay has a gap after cursor ${deliveredCursor}; page ended at ${pageCursor}.`);
  }
}
