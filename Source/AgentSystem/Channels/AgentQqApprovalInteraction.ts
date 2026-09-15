import { AgentApprovalDecisions } from "../Approvals/AgentApprovalTypes.js";

export function parseAgentQqApprovalInteraction(buttonData: string | undefined):
  | {
      readonly approvalId: string;
      readonly decision: (typeof AgentApprovalDecisions)[keyof typeof AgentApprovalDecisions];
    }
  | undefined {
  const match = /^approve:(.+):(allow-once|allow-always|deny)$/u.exec(buttonData?.trim() ?? "");
  if (!match) return undefined;
  const decision =
    match[2] === "allow-once"
      ? AgentApprovalDecisions.ApproveOnce
      : match[2] === "allow-always"
        ? AgentApprovalDecisions.ApproveSession
        : AgentApprovalDecisions.Deny;
  return { approvalId: match[1]!, decision };
}
