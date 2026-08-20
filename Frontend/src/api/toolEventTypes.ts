import type { BackendLocalizedMessage } from "../i18n/backendMessage";
import type {
  AgentToolResultPresentation,
  AgentToolResultPresentationChange,
  AgentToolResultPresentationEvidence,
  AgentToolResultPresentationFact,
} from "../../../Source/AgentSystem/Types/ToolRuntimeTypes";

export type ToolResultPresentation = Omit<AgentToolResultPresentation, "failure">;
export type ToolResultPresentationFact = AgentToolResultPresentationFact;
export type ToolResultPresentationEvidence = AgentToolResultPresentationEvidence;
export type ToolResultPresentationChange = AgentToolResultPresentationChange;

export interface ToolCallsPlannedData {
  toolCount: number;
  tools: string[];
  calls?: Array<{ callId: string; toolName: string; purpose?: string }>;
  status?: "planned" | "discovery_escalated" | "blocked";
  executionMode?: "parallel" | "sequential";
  batchId?: string;
  reason?: string;
  issues?: string[];
}

export interface ToolEventOrigin {
  kind: "system" | "mcp";
  name: string;
  capability?: string;
  server?: string;
  tool?: string;
}

export interface ToolCallStartedData {
  index: number;
  toolName: string;
  callId: string;
  /** Redacted, bounded arguments for live workflow inspection. */
  arguments?: unknown;
  origin?: ToolEventOrigin;
  batchId?: string;
  /** Explicit backend lifecycle start; diagnostic views reject spans without it. */
  startedAt?: string;
}

export interface ToolCallOutputData {
  toolName: string;
  callId: string;
  stream: "stdout" | "stderr";
  outputSequence: number;
  text: string;
  byteLength: number;
  totalBytes: number;
  batchId?: string;
  resourceId?: string;
}

export interface ToolCallProgressData {
  toolName: string;
  callId: string;
  progressSequence: number;
  message?: string;
  completed?: number;
  total?: number;
  unit?: string;
  taskId?: string;
  state?: string;
  terminal?: boolean;
  pollIntervalMs?: number;
  batchId?: string;
  resourceId?: string;
}

export interface ToolCallCompletedData {
  index: number;
  toolName: string;
  callId: string;
  batchId?: string;
  /** Explicit backend lifecycle start; diagnostic views reject spans without it. */
  startedAt?: string;
  /** Explicit backend lifecycle duration. Clients must not infer it. */
  durationMs?: number;
  presentation?: ToolResultPresentation;
  origin?: ToolEventOrigin;
}

export interface ToolCallFailedData {
  index: number;
  toolName: string;
  callId: string;
  batchId?: string;
  code?: string;
  message: string;
  localizedMessage?: BackendLocalizedMessage;
  /** Explicit backend lifecycle start; diagnostic views reject spans without it. */
  startedAt?: string;
  /** Explicit backend lifecycle duration. Clients must not infer it. */
  durationMs?: number;
  origin?: ToolEventOrigin;
}

export interface ToolCallResultDetailData {
  detailId: string;
  index: number;
  toolName: string;
  callId: string;
  batchId?: string;
  presentation?: ToolResultPresentation;
  /** Raw tool return value; lifecycle and presentation metadata are separate. */
  value: unknown;
  origin?: ToolEventOrigin;
}

export interface AssistantMessageCreatedData {
  messageId: string;
  kind: "tool_preface" | "final_answer" | "ask_user";
  content: string;
  terminal: boolean;
  toolCount?: number;
  batchId?: string;
  toolCallIds?: string[];
  reasonCode?: string;
}
