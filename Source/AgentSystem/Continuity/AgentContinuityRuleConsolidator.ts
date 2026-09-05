import type { AgentContinuityRule } from "./AgentContinuityDomain.js";
import type { AgentContinuityRuleDraft } from "./AgentContinuitySqliteTypes.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import { createAgentContinuityRuleIdentity } from "./AgentContinuityRuleIdentity.js";
import {
  AgentContinuityRuleConsolidationDefaults,
  type AgentContinuityRuleConsolidationPolicy,
} from "./AgentContinuityRuleConsolidationPolicy.js";

export type AgentContinuityRuleRelation = "equivalent" | "revises" | "independent";

export interface AgentContinuityRuleMatch {
  readonly relation: AgentContinuityRuleRelation;
  readonly rule?: AgentContinuityRule;
  readonly similarity: number;
}

export class AgentContinuityRuleConsolidator {
  constructor(
    private readonly policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
    private readonly similarity: AgentContinuityTextSimilarity = new AgentContinuityTextSimilarity(),
  ) {}

  match(draft: AgentContinuityRuleDraft, candidates: readonly AgentContinuityRule[]): AgentContinuityRuleMatch {
    const identity = createAgentContinuityRuleIdentity(draft);
    const targeted = draft.targetRuleUri
      ? candidates.find(
          (candidate) =>
            candidate.uri === draft.targetRuleUri &&
            candidate.scope.kind === draft.scope.kind &&
            candidate.scope.id === draft.scope.id &&
            candidate.action.kind === draft.action.kind,
        )
      : undefined;
    if (targeted && draft.replaceTarget) return { relation: "revises", rule: targeted, similarity: 0 };
    const eligible = candidates.filter((candidate) => {
      const candidateIdentity = createAgentContinuityRuleIdentity(candidate);
      return (
        candidate.scope.kind === draft.scope.kind &&
        candidate.scope.id === draft.scope.id &&
        candidate.action.kind === draft.action.kind &&
        candidate.action.activation === draft.action.activation &&
        candidateIdentity.conditionKey === identity.conditionKey &&
        !candidate.supersededBy
      );
    });
    if (draft.targetRuleUri) {
      const equivalentTarget = eligible.find((candidate) => candidate.uri === draft.targetRuleUri);
      if (equivalentTarget) return { relation: "equivalent", rule: equivalentTarget, similarity: 1 };
    }
    let best: AgentContinuityRule | undefined;
    let bestScore = 0;
    for (const candidate of eligible) {
      const score = this.similarity.compare(draft.action.summary, candidate.action.summary).score;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best && bestScore >= this.policy.minimumEquivalentEffectScore) {
      return { relation: "equivalent", rule: best, similarity: bestScore };
    }
    return { relation: "independent", similarity: bestScore };
  }
}
