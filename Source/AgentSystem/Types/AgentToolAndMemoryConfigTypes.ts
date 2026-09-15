import type {
  AgentActionPlannerClientConfig,
  ResolvedAgentActionPlannerClientConfig,
} from "./AgentPlannerConfigTypes.js";
import type { AgentContinuityAuthority } from "../Continuity/AgentContinuityDomain.js";
import type { AgentContinuityRecallAnchorPolicy } from "../Continuity/AgentContinuityRecallAnchorPolicy.js";
import type { AgentContinuityRuleConsolidationConfig } from "../Continuity/AgentContinuityRuleConsolidationPolicy.js";

export const AgentToolSearchMemoryExpansionModes = {
  Disabled: "disabled",
  Fallback: "fallback",
  Augment: "augment",
} as const;

export type AgentToolSearchMemoryExpansionMode =
  (typeof AgentToolSearchMemoryExpansionModes)[keyof typeof AgentToolSearchMemoryExpansionModes];

export interface AgentToolSearchConfig {
  Fuzzy?: {
    Enabled?: boolean;
    MinScore?: number;
    CandidateLimit?: number;
  };
  Embedding?: {
    Enabled?: boolean;
    ScoreThreshold?: number;
  };
  Memory?: {
    MaxEpisodes?: number;
    HalfLifeDays?: number;
  };
  Ranking?: {
    RrfK?: number;
    MmrLambda?: number;
    MmrCandidateScoreRatio?: number;
    MinScore?: number;
    MaxResults?: number;
    MemoryExpansion?: {
      Mode?: AgentToolSearchMemoryExpansionMode;
      MinConfidence?: number;
      MinEvidence?: number;
      MaxResults?: number;
    };
  };
  Rerank?: {
    Enabled?: boolean;
    CandidateLimit?: number;
    ScoreScale?: number;
    FeatureWeights?: Record<string, number>;
  };
}

export interface ResolvedAgentToolSearchConfig {
  Fuzzy: {
    Enabled: boolean;
    MinScore: number;
    CandidateLimit: number;
  };
  Embedding: {
    Enabled: boolean;
    ScoreThreshold: number;
  };
  Memory: {
    MaxEpisodes: number;
    HalfLifeDays: number;
  };
  Ranking: {
    RrfK: number;
    MmrLambda: number;
    MmrCandidateScoreRatio: number;
    MinScore: number;
    MaxResults: number;
    MemoryExpansion: {
      Mode: AgentToolSearchMemoryExpansionMode;
      MinConfidence: number;
      MinEvidence: number;
      MaxResults: number;
    };
  };
  Rerank: {
    Enabled: boolean;
    CandidateLimit: number;
    ScoreScale: number;
    FeatureWeights: Record<string, number>;
  };
}

export interface AgentVectorModelHttpConfig {
  Enabled?: boolean;
  ProviderId?: string;
  Model?: string;
  TimeoutSeconds?: number;
  MaxNetworkRetries?: number;
}

export interface AgentVectorEmbeddingConfig extends AgentVectorModelHttpConfig {
  Dimensions?: number;
  BatchSize?: number;
  InputMaxChars?: number;
}

export interface AgentVectorRerankConfig extends AgentVectorModelHttpConfig {
  EndpointPath?: string;
  CandidateLimit?: number;
  TopK?: number;
}

export interface AgentVectorModelsConfig {
  Embedding?: AgentVectorEmbeddingConfig;
  Rerank?: AgentVectorRerankConfig;
}

export interface ResolvedAgentVectorModelHttpConfig {
  Enabled: boolean;
  BaseUrl: string;
  ApiKey: string;
  Model: string;
  TimeoutMs: number;
  MaxNetworkRetries: number;
  RetryBaseDelayMs: number;
  RetryMaxDelayMs: number;
  RetryAfterMaxDelayMs: number;
  Headers: Record<string, string>;
}

export interface ResolvedAgentVectorEmbeddingConfig extends ResolvedAgentVectorModelHttpConfig {
  Dimensions: number;
  BatchSize: number;
  InputMaxChars: number;
}

export interface ResolvedAgentVectorRerankConfig extends ResolvedAgentVectorModelHttpConfig {
  EndpointPath: string;
  CandidateLimit: number;
  TopK: number;
}

export interface ResolvedAgentVectorModelsConfig {
  Embedding: ResolvedAgentVectorEmbeddingConfig;
  Rerank: ResolvedAgentVectorRerankConfig;
}

export interface AgentToolLearningConfig {
  Enabled?: boolean;
  MaxRepairAttempts?: number;
  Client?: AgentActionPlannerClientConfig;
  Patterns?: {
    MinSupport?: number;
    MaxPromptPatterns?: number;
  };
}

export interface ResolvedAgentToolLearningConfig {
  Enabled: boolean;
  MaxRepairAttempts: number;
  Client: ResolvedAgentActionPlannerClientConfig;
  Patterns: {
    MinSupport: number;
    MaxPromptPatterns: number;
  };
}

export interface AgentContinuityLearningConfig {
  Enabled?: boolean;
  Client?: Omit<AgentActionPlannerClientConfig, "MaxTokens">;
  Runtime?: {
    MaxAttempts?: number;
    RetryBaseDelaySeconds?: number;
    RetryMaxDelaySeconds?: number;
    MaxJobsPerDrain?: number;
  };
  LearningGate?: {
    Enabled?: boolean;
    DeferredDelaySeconds?: number;
  };
  LearningContext?: {
    /**
     * Character budget for recent, source-backed conversation turns supplied
     * only to resolve references such as "this" or "inside it". These turns
     * remain context-only and cannot independently ground a new memory.
     */
    ReferentBudgetCharacters?: number;
    /** Shared character budget for relevant profile and agenda catalogs. */
    CatalogBudgetCharacters?: number;
    /** Character budget for frozen, host-accepted learning demonstrations. */
    VerifiedExampleBudgetCharacters?: number;
  };
  TemporalMemory?: {
    /** Build traceable segment/day/month summaries from completed physical episodes. */
    Enabled?: boolean;
  };
  Recall?: {
    TurnValueClassifier?: {
      Enabled?: boolean;
      /** Probability required before the local classifier can skip text recall. */
      ConfidenceThreshold?: number;
      /** Distinct completed learning examples required for each classifier label. */
      MinimumExamplesPerLabel?: number;
      /** Upper bound of persisted classifier examples. */
      MaxTrainingEntries?: number;
    };
    Prefetch?: {
      Enabled?: boolean;
      CacheTtlSeconds?: number;
    };
    PromptBudget?: {
      MaxProfileEntries?: number;
      MaxFactEntries?: number;
      MaxRelationEntries?: number;
      MaxEventEntries?: number;
      MaxEvidenceEntries?: number;
      MaxCharacters?: number;
    };
    Ranking?: AgentContinuityRecallRankingConfig;
    Semantic?: AgentContinuitySemanticRecallConfig;
  };
}

export interface AgentContinuitySemanticRecallConfig {
  Enabled?: boolean;
  /** Maximum latency contributed by the optional embedding query. */
  TimeoutMs?: number;
  /** Cosine similarity below this value contributes no semantic evidence. */
  ScoreFloor?: number;
  /** Queries shorter than this bypass the embedding call entirely. */
  MinQueryCharacters?: number;
}

export interface ResolvedAgentContinuitySemanticRecallConfig {
  Enabled: boolean;
  TimeoutMs: number;
  ScoreFloor: number;
  MinQueryCharacters: number;
}

export interface AgentContinuityRecallRankingConfig {
  MinimumTextSimilarityScore?: number;
  CandidateScore?: number;
  DirectScore?: number;
  DirectTextSimilarityScore?: number;
  FactIdentityFuzzyScore?: number;
  RecencyHalfLifeDays?: number;
  Weights?: {
    TextSimilarity?: number;
    Lexical?: number;
    Confidence?: number;
    Authority?: number;
    Scope?: number;
    Recency?: number;
    Semantic?: number;
  };
  NearMiss?: {
    MaxEntries?: number;
    MinimumScore?: number;
  };
  Funnel?: {
    MinimumObservations?: number;
    MaxLexicalCandidates?: number;
  };
  Graph?: {
    MaxHops?: number;
  };
  Lexical?: {
    SummaryBoost?: number;
    Prefix?: boolean;
    Fuzzy?: number;
    CombineWith?: "AND" | "OR";
  };
  Similarity?: {
    PhraseFloor?: number;
    CoverageWeight?: number;
    FuzzyWeight?: number;
    CharacterWeight?: number;
    StructuralMismatchWeight?: number;
  };
  Consolidation?: AgentContinuityRuleConsolidationConfig;
  Anchor?: Partial<AgentContinuityRecallAnchorPolicy>;
  Evidence?: {
    MinimumRelatedScore?: number;
    RelativeToBestScore?: number;
    MinimumLifetimeMatchScore?: number;
  };
}

export interface ResolvedAgentContinuityRecallRankingConfig {
  MinimumTextSimilarityScore: number;
  CandidateScore: number;
  DirectScore: number;
  DirectTextSimilarityScore: number;
  FactIdentityFuzzyScore: number;
  RecencyHalfLifeDays: number;
  Weights: {
    TextSimilarity: number;
    Lexical: number;
    Confidence: number;
    Authority: number;
    Scope: number;
    Recency: number;
    Semantic: number;
  };
  NearMiss: {
    MaxEntries: number;
    MinimumScore: number;
  };
  Funnel: {
    MinimumObservations: number;
    MaxLexicalCandidates: number;
  };
  Graph: {
    MaxHops: number;
  };
  AuthorityScores: Record<AgentContinuityAuthority, number>;
  ScopeScores: {
    sessionMatch: number;
    other: number;
  };
  Lexical: {
    SummaryBoost: number;
    Prefix: boolean;
    Fuzzy: number;
    CombineWith: "AND" | "OR";
  };
  Similarity: {
    PhraseFloor: number;
    CoverageWeight: number;
    FuzzyWeight: number;
    CharacterWeight: number;
    StructuralMismatchWeight: number;
  };
  Consolidation: Required<AgentContinuityRuleConsolidationConfig>;
  Anchor: AgentContinuityRecallAnchorPolicy;
  Evidence: {
    MinimumRelatedScore: number;
    RelativeToBestScore: number;
    MinimumLifetimeMatchScore: number;
  };
}

export interface AgentContinuityLearningRecallConfig {
  TurnValueClassifier: {
    Enabled: boolean;
    ConfidenceThreshold: number;
    MinimumExamplesPerLabel: number;
    MaxTrainingEntries: number;
  };
  Prefetch: {
    Enabled: boolean;
    CacheTtlSeconds: number;
  };
  PromptBudget: AgentContinuityPromptBudgetConfig;
  Ranking: ResolvedAgentContinuityRecallRankingConfig;
  Semantic: ResolvedAgentContinuitySemanticRecallConfig;
}

export interface AgentContinuityPromptBudgetConfig {
  MaxProfileEntries: number;
  MaxFactEntries: number;
  MaxRelationEntries: number;
  MaxEventEntries: number;
  MaxEvidenceEntries: number;
  MaxCharacters: number;
}

export interface AgentContinuityLearningGateConfig {
  Enabled: boolean;
  DeferredDelaySeconds: number;
}

export interface AgentContinuityLearningContextConfig {
  ReferentBudgetCharacters: number;
  CatalogBudgetCharacters: number;
  VerifiedExampleBudgetCharacters: number;
}

export interface AgentTemporalMemoryConfig {
  Enabled: boolean;
}

export interface AgentContinuityLearningRuntimeConfig {
  MaxAttempts: number;
  RetryBaseDelaySeconds: number;
  RetryMaxDelaySeconds: number;
  MaxJobsPerDrain: number;
}

export interface ResolvedAgentContinuityLearningConfig {
  Enabled: boolean;
  Client: ResolvedAgentActionPlannerClientConfig;
  Runtime: AgentContinuityLearningRuntimeConfig;
  LearningGate: AgentContinuityLearningGateConfig;
  LearningContext: AgentContinuityLearningContextConfig;
  TemporalMemory: AgentTemporalMemoryConfig;
  Recall: AgentContinuityLearningRecallConfig;
  UsesDefaultModel: boolean;
}
