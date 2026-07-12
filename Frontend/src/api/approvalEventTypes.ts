export type ApprovalKind = "tool_call" | "execution_fallback";
export type ApprovalResolutionScope = "once" | "session";

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
  failureReason: "sandbox_unavailable" | "persistent_sandbox_unsupported";
}

export type ApprovalSubjectData = ToolCallApprovalSubjectData | ExecutionFallbackApprovalSubjectData;

interface ApprovalEventData {
  approvalId: string;
  approvalKind: ApprovalKind;
  title: string;
  reason: string;
  rule?: string;
  riskSignals?: string[];
  subject: ApprovalSubjectData;
  createdAt: string;
}

export interface ApprovalRequestedData extends ApprovalEventData {
  status: "pending";
}

export interface ApprovalResolvedData extends ApprovalEventData {
  status: "approved" | "denied";
  message?: string;
  scope?: ApprovalResolutionScope;
  resolvedAt: string;
}
