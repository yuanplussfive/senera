import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { SeneraProcessFallbackSubject } from "../Execution/SeneraProcessFallbackAuthorization.js";

export const AgentApprovalKinds = {
  ToolCall: "tool_call",
  ExecutionFallback: "execution_fallback",
} as const;

export type AgentApprovalKind = (typeof AgentApprovalKinds)[keyof typeof AgentApprovalKinds];

export const AgentApprovalStatuses = {
  Pending: "pending",
  Approved: "approved",
  Denied: "denied",
  Cancelled: "cancelled",
  Expired: "expired",
} as const;

export type AgentApprovalStatus = (typeof AgentApprovalStatuses)[keyof typeof AgentApprovalStatuses];

export const AgentApprovalDecisions = {
  ApproveOnce: "approve_once",
  ApproveSession: "approve_session",
  Deny: "deny",
  DenyAndInterrupt: "deny_and_interrupt",
} as const;

export type AgentApprovalDecision = (typeof AgentApprovalDecisions)[keyof typeof AgentApprovalDecisions];

export const AgentApprovalDispositions = {
  Proceed: "proceed",
  Continue: "continue",
  Interrupt: "interrupt",
} as const;

export type AgentApprovalDisposition = (typeof AgentApprovalDispositions)[keyof typeof AgentApprovalDispositions];

export interface AgentApprovalRequest {
  approvalId: string;
  kind: AgentApprovalKind;
  sessionId: string;
  requestId: string;
  step: number;
  toolCallId?: string;
  batchId?: string;
  title: string;
  reason: string;
  rule?: string;
  riskSignals?: readonly string[];
  availableDecisions: readonly AgentApprovalDecision[];
  subject: AgentApprovalSubject;
  createdAt: string;
  deadlineAt?: string;
}

export type AgentApprovalSubject =
  | {
      kind: typeof AgentApprovalKinds.ToolCall;
      toolName: string;
      arguments: Record<string, unknown>;
    }
  | ({
      kind: typeof AgentApprovalKinds.ExecutionFallback;
      fromBackend: string;
      toBackend: string;
      failureReason: string;
    } & SeneraProcessFallbackSubject);

export type AgentApprovalScope = "once" | "session";

export interface AgentApprovalResolution {
  approvalId: string;
  decision?: AgentApprovalDecision;
  status: Exclude<AgentApprovalStatus, "pending">;
  disposition: AgentApprovalDisposition;
  message?: string;
  scope?: AgentApprovalScope;
  resolvedAt: string;
}

export interface AgentApprovalResolveCommand {
  approvalId: string;
  decision: AgentApprovalDecision;
  message?: string;
}

export interface AgentApprovalWaitOptions {
  approval: Omit<AgentApprovalRequest, "approvalId" | "createdAt">;
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
  deadlineMs?: number;
}

export interface AgentApprovalRuntime {
  requestApproval(options: AgentApprovalWaitOptions): Promise<AgentApprovalResolution>;
  resolve(command: AgentApprovalResolveCommand): Promise<AgentApprovalResolution>;
  tryResolve(command: AgentApprovalResolveCommand): Promise<AgentApprovalResolution | undefined>;
  cancelByRequestId(requestId: string, error?: unknown): Promise<number>;
}
