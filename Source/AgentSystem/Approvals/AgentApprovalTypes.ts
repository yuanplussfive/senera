import type { AgentEventSink } from "../Events/AgentEvent.js";

export const AgentApprovalKinds = {
  ToolCall: "tool_call",
} as const;

export type AgentApprovalKind =
  typeof AgentApprovalKinds[keyof typeof AgentApprovalKinds];

export const AgentApprovalStatuses = {
  Pending: "pending",
  Approved: "approved",
  Denied: "denied",
  Cancelled: "cancelled",
} as const;

export type AgentApprovalStatus =
  typeof AgentApprovalStatuses[keyof typeof AgentApprovalStatuses];

export interface AgentApprovalRequest {
  approvalId: string;
  kind: AgentApprovalKind;
  requestId: string;
  step: number;
  title: string;
  reason: string;
  rule?: string;
  riskSignals?: readonly string[];
  subject: AgentApprovalSubject;
  createdAt: string;
}

export type AgentApprovalSubject =
  | {
      kind: typeof AgentApprovalKinds.ToolCall;
      toolName: string;
      arguments: Record<string, unknown>;
    };

export interface AgentApprovalResolution {
  approvalId: string;
  status: Extract<AgentApprovalStatus, "approved" | "denied">;
  message?: string;
  resolvedAt: string;
}

export interface AgentApprovalWaitOptions {
  approval: Omit<AgentApprovalRequest, "approvalId" | "createdAt">;
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

export interface AgentApprovalRuntime {
  requestApproval(options: AgentApprovalWaitOptions): Promise<AgentApprovalResolution>;
  resolve(resolution: Omit<AgentApprovalResolution, "resolvedAt">): AgentApprovalResolution;
  tryResolve(resolution: Omit<AgentApprovalResolution, "resolvedAt">): AgentApprovalResolution | undefined;
  cancelByRequestId(requestId: string, error?: unknown): number;
}
