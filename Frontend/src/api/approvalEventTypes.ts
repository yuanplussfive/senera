export interface ApprovalSubjectData {
  kind: "tool_call";
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ApprovalRequestedData {
  approvalId: string;
  approvalKind: "tool_call";
  title: string;
  reason: string;
  rule?: string;
  riskSignals?: string[];
  subject: ApprovalSubjectData;
  createdAt: string;
  status: "pending";
}

export interface ApprovalResolvedData extends Omit<ApprovalRequestedData, "status"> {
  status: "approved" | "denied";
  message?: string;
  resolvedAt: string;
}
