import { normalizeOpaDecision, type PolicyClient } from "@ai-sdk/policy-opa";
import { AgentToolApprovalPolicyArtifactContract } from "./AgentToolApprovalPolicyArtifact.js";
import type { AgentResourceAccessFacts } from "../Execution/SeneraResourceAccess.js";
import { agentUnknownRecordOrEmpty, readAgentNonEmptyString } from "../Core/AgentUnknownValue.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

export {
  AgentResourceAccessIntents,
  type AgentResourceAccessFacts,
  type AgentResourceAccessIntent,
} from "../Execution/SeneraResourceAccess.js";

export interface AgentResourceAccessDecision {
  readonly action: "allow" | "deny";
  readonly rule: string;
  readonly reason: string;
  readonly riskSignals: readonly string[];
}

export class AgentResourceAccessDeniedError extends AgentBaseError {
  constructor(readonly decision: AgentResourceAccessDecision) {
    super(decision.reason);
  }
}

export class AgentResourceAccessPolicy {
  constructor(private readonly client: PolicyClient) {}

  async authorize(resource: AgentResourceAccessFacts): Promise<AgentResourceAccessDecision> {
    const raw = await this.client.evaluate(AgentToolApprovalPolicyArtifactContract.entrypoints.resourceAccess, {
      resource,
    });
    const normalized = normalizeOpaDecision(raw);
    const metadata = readDecisionMetadata(raw);
    if (normalized.type !== "approved") {
      throw new AgentResourceAccessDeniedError({ action: "deny", ...metadata });
    }
    return { action: "allow", ...metadata };
  }
}

function readDecisionMetadata(value: unknown): Omit<AgentResourceAccessDecision, "action"> {
  const record = agentUnknownRecordOrEmpty(value);
  return {
    rule: readAgentNonEmptyString(record.rule) ?? "resource.unknown",
    reason: readAgentNonEmptyString(record.reason) ?? "资源访问策略没有返回原因。",
    riskSignals: Array.isArray(record.riskSignals)
      ? record.riskSignals.flatMap((item) => readAgentNonEmptyString(item) ?? [])
      : [],
  };
}
