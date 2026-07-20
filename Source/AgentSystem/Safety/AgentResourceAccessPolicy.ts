import { normalizeOpaDecision, type PolicyClient } from "@ai-sdk/policy-opa";
import { AgentToolApprovalPolicyArtifactContract } from "./AgentToolApprovalPolicyArtifact.js";
import type { AgentResourceAccessFacts } from "../Execution/SeneraResourceAccess.js";

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

export class AgentResourceAccessDeniedError extends Error {
  constructor(readonly decision: AgentResourceAccessDecision) {
    super(decision.reason);
    this.name = "AgentResourceAccessDeniedError";
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
  const record = readRecord(value);
  return {
    rule: readString(record.rule) ?? "resource.unknown",
    reason: readString(record.reason) ?? "资源访问策略没有返回原因。",
    riskSignals: Array.isArray(record.riskSignals) ? record.riskSignals.flatMap((item) => readString(item) ?? []) : [],
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
