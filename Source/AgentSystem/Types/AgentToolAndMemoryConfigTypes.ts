import type {
  AgentActionPlannerClientConfig,
  ResolvedAgentActionPlannerClientConfig,
} from "./AgentPlannerConfigTypes.js";

export const AgentToolSearchChannelWeightKeys = [
  "bm25",
  "exact",
  "example",
  "fuzzy",
  "semantic",
  "structural",
  "memory",
] as const;

export type AgentToolSearchChannelWeightKey = (typeof AgentToolSearchChannelWeightKeys)[number];

export interface AgentToolSearchConfig {
  Fuzzy?: {
    Enabled?: boolean;
    MinScore?: number;
  };
  Embedding?: {
    Enabled?: boolean;
  };
  Tokenize?: {
    /** Retrieval-only stopwords removed from query tokens before lexical and
     * fuzzy matching. Empty disables filtering. */
    Stopwords?: string[];
  };
  Memory?: {
    MaxEpisodes?: number;
    HalfLifeDays?: number;
  };
  Ranking?: {
    RrfK?: number;
    ChannelWeights?: Partial<Record<AgentToolSearchChannelWeightKey, number>>;
  };
  Disclosure?: {
    /** Model-facing BPE budget for a single ToolSearch discovery wire. */
    TokenBudget?: number;
  };
  Rerank?: {
    Enabled?: boolean;
    ScoreScale?: number;
    FeatureWeights?: Record<string, number>;
  };
}

export interface ResolvedAgentToolSearchConfig {
  Fuzzy: {
    Enabled: boolean;
    MinScore: number;
  };
  Embedding: {
    Enabled: boolean;
  };
  Tokenize: {
    Stopwords: string[];
  };
  Memory: {
    MaxEpisodes: number;
    HalfLifeDays: number;
  };
  Ranking: {
    RrfK: number;
    ChannelWeights: Record<string, number>;
  };
  Disclosure: {
    TokenBudget: number;
  };
  Rerank: {
    Enabled: boolean;
    ScoreScale: number;
    FeatureWeights: Record<string, number>;
  };
}

/**
 * State-card configuration. The structural card is projected deterministically
 * from the session log; the model resolves the current turn relation and
 * standalone request synchronously. Leaving `Client.ModelProviderId` empty inherits the
 * current default (Pi) model, which is the recommended setup.
 */
export interface AgentStateCardConfig {
  Enabled?: boolean;
  Client?: Omit<AgentActionPlannerClientConfig, "MaxTokens">;
  /** Character budget for the conversation history handed to the rewrite model. */
  HistoryBudgetCharacters?: number;
}

export interface ResolvedAgentStateCardConfig {
  Enabled: boolean;
  Client: ResolvedAgentActionPlannerClientConfig;
  HistoryBudgetCharacters: number;
  UsesDefaultModel: boolean;
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
  MemOS?: {
    /** Similarity threshold for MemOS automatic graph links. */
    AutoLinkThreshold?: number;
    /** Native read-only near-duplicate detection, independent of graph links. */
    RecallDedupeThreshold?: number;
    /** Maximum vector comparisons in one background duplicate scan. */
    RecallDedupeMaxPairs?: number;
    /** Number of completed state-card turns supplied as extraction context. */
    FragmentHistoryTurns?: number;
    /** Number of active semantic knowledge candidates supplied to reconciliation. */
    KnowledgeCandidateLimit?: number;
    /** Model-token ceiling for assistant previews used by semantic extraction. */
    AssistantPreviewTokens?: number;
    /** Maximum model-token payload for one daily/monthly digest batch. */
    DigestInputTokenBudget?: number;
    /** Maximum characters emitted by fragment and period summaries. */
    DigestSummaryCharacterLimit?: number;
  };
  Recall?: {
    PromptBudget?: {
      MaxTokens?: number;
    };
  };
}

export interface AgentContinuityLearningRecallConfig {
  PromptBudget: AgentContinuityPromptBudgetConfig;
}

export interface AgentContinuityPromptBudgetConfig {
  MaxTokens: number;
}

export interface AgentContinuityMemOSConfig {
  AutoLinkThreshold: number;
  RecallDedupeThreshold: number;
  RecallDedupeMaxPairs: number;
  FragmentHistoryTurns: number;
  KnowledgeCandidateLimit: number;
  AssistantPreviewTokens: number;
  DigestInputTokenBudget: number;
  DigestSummaryCharacterLimit: number;
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
  MemOS: AgentContinuityMemOSConfig;
  Recall: AgentContinuityLearningRecallConfig;
  UsesDefaultModel: boolean;
}
