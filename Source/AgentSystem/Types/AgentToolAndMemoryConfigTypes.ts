import type {
  AgentActionPlannerClientConfig,
  ResolvedAgentActionPlannerClientConfig,
} from "./AgentPlannerConfigTypes.js";

export const AgentToolSearchMemoryExpansionModes = {
  Disabled: "disabled",
  Fallback: "fallback",
  Augment: "augment",
} as const;

export type AgentToolSearchMemoryExpansionMode =
  (typeof AgentToolSearchMemoryExpansionModes)[keyof typeof AgentToolSearchMemoryExpansionModes];

export interface AgentToolSearchConfig {
  Embedding?: {
    Enabled?: boolean;
    ModelProviderId?: string;
    Model?: string;
    Dimensions?: number;
    BatchSize?: number;
    InputMaxChars?: number;
    ScoreThreshold?: number;
  };
  Memory?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
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
  Embedding: {
    Enabled: boolean;
    ModelProviderId?: string;
    Model: string;
    Dimensions: number;
    BatchSize: number;
    InputMaxChars: number;
    ScoreThreshold: number;
  };
  Memory: {
    Kind: "sqlite" | "memory";
    DatabasePath: string;
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

export interface AgentMemoryLearningConfig {
  Promotion?: {
    MinSupport?: number;
    MaxClusterSize?: number;
    MinSimilarity?: number;
  };
}

export interface ResolvedAgentMemoryLearningConfig {
  Promotion: {
    MinSupport: number;
    MaxClusterSize: number;
    MinSimilarity: number;
  };
}
