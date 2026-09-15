import type {
  AgentContinuityRecallRankingConfig,
  ResolvedAgentContinuityRecallRankingConfig,
} from "../Types/AgentToolAndMemoryConfigTypes.js";
import { AgentContinuityRecallRankingDefaults } from "./AgentContinuityRecallDefaults.js";
import { resolveAgentContinuityRuleConsolidationPolicy } from "./AgentContinuityRuleConsolidationPolicy.js";

/**
 * Merges one user-facing recall override into the complete runtime policy.
 * Defaults are resolved at the configuration boundary, so ranking and
 * learning code never need to decide whether a nested option was omitted.
 */
export function mergeAgentContinuityRecallRanking(
  base: ResolvedAgentContinuityRecallRankingConfig = AgentContinuityRecallRankingDefaults,
  override?: AgentContinuityRecallRankingConfig,
): ResolvedAgentContinuityRecallRankingConfig {
  const ranking = {
    ...base,
    ...override,
    Lexical: { ...base.Lexical, ...override?.Lexical },
    Similarity: { ...base.Similarity, ...override?.Similarity },
    Anchor: { ...base.Anchor, ...override?.Anchor },
    Evidence: { ...base.Evidence, ...override?.Evidence },
    Weights: { ...base.Weights, ...override?.Weights },
    AuthorityScores: { ...base.AuthorityScores },
    ScopeScores: { ...base.ScopeScores },
    NearMiss: { ...base.NearMiss, ...override?.NearMiss },
    Funnel: { ...base.Funnel, ...override?.Funnel },
    Graph: { ...base.Graph, ...override?.Graph },
    Consolidation: { ...base.Consolidation, ...override?.Consolidation },
  };
  if (!Number.isSafeInteger(ranking.Graph.MaxHops) || ranking.Graph.MaxHops < 0) {
    throw new Error("Continuity recall graph MaxHops must be a non-negative safe integer.");
  }
  resolveAgentContinuityRuleConsolidationPolicy(ranking.Consolidation);
  validateAnchorPolicy(ranking.Anchor);
  return ranking;
}

function validateAnchorPolicy(policy: ResolvedAgentContinuityRecallRankingConfig["Anchor"]): void {
  for (const [name, value] of [
    ["MinimumPhraseCharacters", policy.MinimumPhraseCharacters],
    ["MinimumTokenLength", policy.MinimumTokenLength],
    ["MinimumInformativeTerms", policy.MinimumInformativeTerms],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Continuity recall anchor ${name} must be a positive safe integer.`);
    }
  }
  for (const [name, value] of [
    ["MinimumQueryCoverage", policy.MinimumQueryCoverage],
    ["MinimumLabelCoverage", policy.MinimumLabelCoverage],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Continuity recall anchor ${name} must be between 0 and 1.`);
    }
  }
}
