import type { AgentContinuityAuthority } from "./AgentContinuityDomain.js";
import type {
  ResolvedAgentContinuityRecallRankingConfig,
  ResolvedAgentContinuitySemanticRecallConfig,
} from "../Types/AgentToolAndMemoryConfigTypes.js";
import type { AgentContinuityPromptBudgetConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { AgentContinuityRecallAnchorDefaults } from "./AgentContinuityRecallAnchorPolicy.js";
import { DefaultAgentContinuityGraphTraversal } from "./AgentContinuityRelationCatalog.js";
import { projectAgentContinuityRuleConsolidationConfig } from "./AgentContinuityRuleConsolidationPolicy.js";

export const AgentContinuityPromptBudgetDefaults = {
  MaxProfileEntries: 32,
  MaxFactEntries: 24,
  MaxRelationEntries: 24,
  MaxEventEntries: 8,
  MaxEvidenceEntries: 8,
  MaxCharacters: 24_000,
} satisfies AgentContinuityPromptBudgetConfig;

/**
 * The deterministic recall policy has one home. Runtime code consumes the
 * resolved policy; it does not hide scoring constants inside a ranker.
 */
export const AgentContinuityRecallRankingDefaults = {
  MinimumTextSimilarityScore: 0.12,
  CandidateScore: 0.24,
  DirectScore: 0.74,
  DirectTextSimilarityScore: 0.58,
  FactIdentityFuzzyScore: 0.9,
  RecencyHalfLifeDays: 120,
  Weights: {
    TextSimilarity: 0.5,
    Lexical: 0.22,
    Confidence: 0.12,
    Authority: 0.08,
    Scope: 0.05,
    Recency: 0.03,
    Semantic: 0.18,
  },
  NearMiss: {
    MaxEntries: 5,
    MinimumScore: 0.15,
  },
  Funnel: {
    MinimumObservations: 512,
    MaxLexicalCandidates: 256,
  },
  Graph: {
    MaxHops: DefaultAgentContinuityGraphTraversal.maxHops,
  },
  AuthorityScores: {
    user_explicit: 1,
    tool_verified: 0.96,
    system_observed: 0.82,
    model_inferred: 0.64,
  } satisfies Record<AgentContinuityAuthority, number>,
  ScopeScores: {
    sessionMatch: 1,
    other: 0.72,
  } satisfies Record<"sessionMatch" | "other", number>,
  Lexical: {
    SummaryBoost: 3,
    Prefix: true,
    Fuzzy: 0.2,
    CombineWith: "OR",
  },
  Similarity: {
    PhraseFloor: 0.6,
    CoverageWeight: 0.72,
    FuzzyWeight: 0.28,
    CharacterWeight: 0.64,
    StructuralMismatchWeight: 0.8,
  },
  Consolidation: projectAgentContinuityRuleConsolidationConfig(),
  Anchor: AgentContinuityRecallAnchorDefaults,
  Evidence: {
    MinimumRelatedScore: 0.06,
    RelativeToBestScore: 0.72,
    MinimumLifetimeMatchScore: 0.58,
  },
} satisfies ResolvedAgentContinuityRecallRankingConfig;

/**
 * Semantic recall is an explicit opt-in channel. The deterministic lexical
 * and graph indexes are the baseline and do not require a model or vector
 * endpoint.
 */
export const AgentContinuitySemanticRecallDefaults = {
  Enabled: false,
  TimeoutMs: 30_000,
  ScoreFloor: 0.3,
  MinQueryCharacters: 2,
} satisfies ResolvedAgentContinuitySemanticRecallConfig;
