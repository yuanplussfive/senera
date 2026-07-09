import type { AgentPermissionDecision } from "./AgentSafetyTypes.js";
import type { AgentToolApprovalPolicyInput } from "./AgentToolApprovalPolicy.js";

export interface AgentToolGuardrailAuditor {
  auditToolCall(input: AgentToolApprovalPolicyInput): Promise<AgentPermissionDecision | undefined>;
}
