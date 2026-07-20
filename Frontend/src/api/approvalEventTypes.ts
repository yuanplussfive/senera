export type ApprovalKind = "tool_call" | "execution_fallback";
export type ApprovalResolutionScope = "once" | "session";
export type ApprovalDecision = "approve_once" | "approve_session" | "deny" | "deny_and_interrupt";
export type ApprovalDisposition = "proceed" | "continue" | "interrupt";
export type ApprovalStatus = "pending" | "approved" | "denied" | "cancelled" | "expired";

export interface ToolCallApprovalSubjectData {
  kind: "tool_call";
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ExecutionFallbackApprovalSubjectData {
  kind: "execution_fallback";
  pluginName: string;
  pluginTitle: string;
  pluginVersion: string;
  manifestDigest: string;
  rootKind: "System" | "User";
  trustLevel?: string;
  toolName: string;
  boundary: "Sandbox" | "SandboxPreferred";
  network: "Allow" | "Deny";
  workspace: "ReadOnly" | "ReadWrite";
  permissions: string[];
  fromBackend: string;
  toBackend: string;
  failureReason: "sandbox_unavailable" | "persistent_sandbox_unsupported" | "terminal_capability_unsupported";
}

export type ApprovalSubjectData = ToolCallApprovalSubjectData | ExecutionFallbackApprovalSubjectData;

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
