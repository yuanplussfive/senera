import type { AgentContinuityAuthority, AgentContinuityRuleMaturity } from "./AgentContinuityDomain.js";

/** User-facing shape for the shared continuity consolidation policy. */
export interface AgentContinuityRuleConsolidationConfig {
  readonly MinimumEquivalentEffectScore?: number;
  readonly ActiveIndependentEvidence?: number;
  readonly EstablishedIndependentEvidence?: number;
}

export interface AgentContinuityRuleConsolidationPolicy {
  readonly minimumEquivalentEffectScore: number;
  readonly activeIndependentEvidence: number;
  readonly establishedIndependentEvidence: number;
}

export const AgentContinuityRuleConsolidationDefaults: AgentContinuityRuleConsolidationPolicy = {
  minimumEquivalentEffectScore: 0.9,
  activeIndependentEvidence: 2,
  establishedIndependentEvidence: 3,
};

export function projectAgentContinuityRuleConsolidationConfig(
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): Required<AgentContinuityRuleConsolidationConfig> {
  return {
    MinimumEquivalentEffectScore: policy.minimumEquivalentEffectScore,
    ActiveIndependentEvidence: policy.activeIndependentEvidence,
    EstablishedIndependentEvidence: policy.establishedIndependentEvidence,
  };
}

export function resolveAgentContinuityRuleConsolidationPolicy(
  config?: AgentContinuityRuleConsolidationConfig,
): AgentContinuityRuleConsolidationPolicy {
  const policy = {
    minimumEquivalentEffectScore:
      config?.MinimumEquivalentEffectScore ?? AgentContinuityRuleConsolidationDefaults.minimumEquivalentEffectScore,
    activeIndependentEvidence:
      config?.ActiveIndependentEvidence ?? AgentContinuityRuleConsolidationDefaults.activeIndependentEvidence,
    establishedIndependentEvidence:
      config?.EstablishedIndependentEvidence ?? AgentContinuityRuleConsolidationDefaults.establishedIndependentEvidence,
  };
  validateAgentContinuityRuleConsolidationPolicy(policy);
  return policy;
}

export function validateAgentContinuityRuleConsolidationPolicy(policy: AgentContinuityRuleConsolidationPolicy): void {
  if (
    !Number.isFinite(policy.minimumEquivalentEffectScore) ||
    policy.minimumEquivalentEffectScore < 0 ||
    policy.minimumEquivalentEffectScore > 1
  ) {
    throw new Error("Continuity consolidation equivalent-effect score must be between 0 and 1.");
  }
  if (!Number.isSafeInteger(policy.activeIndependentEvidence) || policy.activeIndependentEvidence < 1) {
    throw new Error("Continuity consolidation active evidence threshold must be a positive safe integer.");
  }
  if (
    !Number.isSafeInteger(policy.establishedIndependentEvidence) ||
    policy.establishedIndependentEvidence < policy.activeIndependentEvidence
  ) {
    throw new Error("Continuity consolidation established evidence threshold must not be below the active threshold.");
  }
}

export function resolveAgentContinuityRuleMaturity(
  authority: AgentContinuityAuthority,
  supportCount: number,
  policy: AgentContinuityRuleConsolidationPolicy,
): AgentContinuityRuleMaturity {
  if (supportCount >= policy.establishedIndependentEvidence) return "established";
  if (authority !== "model_inferred" || supportCount >= policy.activeIndependentEvidence) return "active";
  return "candidate";
}
