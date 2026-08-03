export type ApprovalKind = "tool_call";
export type ApprovalResolutionScope = "once" | "session";
export type ApprovalDecision = "approve_once" | "approve_session" | "deny" | "deny_and_interrupt";
export type ApprovalDisposition = "proceed" | "continue" | "interrupt";
export type ApprovalStatus = "pending" | "approved" | "denied" | "cancelled" | "expired";

export interface ToolCallApprovalSubjectData {
  kind: "tool_call";
  toolName: string;
  arguments: Record<string, unknown>;
  execution?: {
    target: "Sandbox" | "Local";
    backend: "sandbox" | "local";
    network: "default" | "disabled";
    workspaceMount: "readonly" | "writable";
    availableTargets: Array<"Sandbox" | "Local">;
  };
}

export type ApprovalSubjectData = ToolCallApprovalSubjectData;

interface ApprovalEventData {
  approvalId: string;
  approvalKind: ApprovalKind;
  toolCallId?: string;
  batchId?: string;
  title: string;
  reason: string;
  rule?: string;
  riskSignals?: string[];
  availableDecisions: ApprovalDecision[];
  subject: ApprovalSubjectData;
  createdAt: string;
}

export interface ApprovalRequestedData extends ApprovalEventData {
  status: "pending";
}

export interface ApprovalResolvedData extends ApprovalEventData {
  decision?: ApprovalDecision;
  status: Exclude<ApprovalStatus, "pending">;
  disposition: ApprovalDisposition;
  message?: string;
  scope?: ApprovalResolutionScope;
  resolvedAt: string;
}
