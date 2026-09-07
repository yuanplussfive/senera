import crypto from "node:crypto";
import type { AgentContinuityRule, AgentContinuityRuleAction } from "./AgentContinuityDomain.js";
import { agentContinuityConditionKey } from "./AgentContinuityConditionCanonicalizer.js";

export interface AgentContinuityRuleIdentity {
  readonly conditionKey: string;
  readonly effectKey: string;
  readonly semanticKey: string;
}

export function createAgentContinuityRuleIdentity(
  rule: Pick<AgentContinuityRule, "scope" | "condition" | "action">,
): AgentContinuityRuleIdentity {
  const conditionKey = digest(agentContinuityConditionKey(rule.condition));
  const effectKey = digest(normalizeRuleEffect(rule.action));
  return {
    conditionKey,
    effectKey,
    semanticKey: digest(
      JSON.stringify([
        rule.scope.kind,
        rule.scope.id,
        conditionKey,
        rule.action.kind,
        rule.action.activation,
        effectKey,
      ]),
    ),
  };
}

export function normalizeRuleEffect(action: AgentContinuityRuleAction): string {
  return action.summary
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function digest(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
