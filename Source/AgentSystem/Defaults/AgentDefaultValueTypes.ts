import type {
  AgentActionPlannerConfig,
  AgentMemoryLearningConfig,
  AgentToolLearningConfig,
  AgentVectorEmbeddingConfig,
  AgentVectorRerankConfig,
  ResolvedAgentArtifactsConfig,
  ResolvedAgentConfigStoreConfig,
  ResolvedAgentFrontendConfig,
  ResolvedAgentLoopConfig,
  ResolvedAgentModelProviderEndpointConfig,
  ResolvedAgentPersistenceConfig,
  ResolvedAgentPresetsConfig,
  ResolvedAgentSandboxRuntimeConfig,
  ResolvedAgentServerConfig,
  ResolvedAgentToolExecutionConfig,
  ResolvedAgentToolSearchConfig,
  ResolvedAgentUploadsConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentModelRuntimeDefaultsConfig } from "../Types/AgentModelConfigTypes.js";

export type { AgentModelRuntimeDefaultsConfig } from "../Types/AgentModelConfigTypes.js";

export interface AgentVectorModelsDefaultsConfig {
  Embedding: Required<AgentVectorEmbeddingConfig>;
  Rerank: Required<AgentVectorRerankConfig>;
}

export type ResolvedAgentModelRuntimeDefaultsConfig = AgentModelRuntimeDefaultsConfig & {
  TimeoutMs: number;
  FirstTokenTimeoutMs: number;
  MaxRequestMs: number;
  RetryBaseDelayMs: number;
  RetryMaxDelayMs: number;
  RetryAfterMaxDelayMs: number;
};

export type ResolvedAgentVectorEmbeddingDefaultsConfig = Required<AgentVectorEmbeddingConfig> & {
  TimeoutMs: number;
};

export type ResolvedAgentVectorRerankDefaultsConfig = Required<AgentVectorRerankConfig> & {
  TimeoutMs: number;
};

export type AgentActionPlannerClientDefaultsConfig = Required<
  Omit<NonNullable<AgentActionPlannerConfig["Client"]>, "ModelProviderId">
> &
  Pick<NonNullable<AgentActionPlannerConfig["Client"]>, "ModelProviderId">;

export type AgentToolLearningDefaultsConfig = Required<Omit<AgentToolLearningConfig, "Client" | "Patterns">> & {
  Client: AgentActionPlannerClientDefaultsConfig;
  Patterns: Required<NonNullable<AgentToolLearningConfig["Patterns"]>>;
};

export type AgentMemoryLearningDefaultsConfig = Required<Omit<AgentMemoryLearningConfig, "Client" | "Promotion">> & {
  Client: AgentActionPlannerClientDefaultsConfig;
  Promotion: Required<NonNullable<AgentMemoryLearningConfig["Promotion"]>>;
};

export type AgentActionPlannerDefaultsConfig = Required<
  Omit<AgentActionPlannerConfig, "Evidence" | "Client" | "PlanningClient" | "FinalAnswerClient">
> & {
  Evidence: Required<NonNullable<AgentActionPlannerConfig["Evidence"]>>;
  Client: AgentActionPlannerClientDefaultsConfig;
  PlanningClient: AgentActionPlannerClientDefaultsConfig;
  FinalAnswerClient: AgentActionPlannerClientDefaultsConfig;
};

export interface ResolvedAgentDefaultsConfig {
  ModelProviderEndpoints: ResolvedAgentModelProviderEndpointConfig[];
  ModelRuntime: ResolvedAgentModelRuntimeDefaultsConfig;
  ToolExecution: ResolvedAgentToolExecutionConfig;
  SandboxRuntime: ResolvedAgentSandboxRuntimeConfig;
  AgentLoop: ResolvedAgentLoopConfig;
  ToolSearch: ResolvedAgentToolSearchConfig;
  VectorModels: {
    Embedding: ResolvedAgentVectorEmbeddingDefaultsConfig;
    Rerank: ResolvedAgentVectorRerankDefaultsConfig;
  };
  ToolLearning: AgentToolLearningDefaultsConfig;
  MemoryLearning: AgentMemoryLearningDefaultsConfig;
  Presets: ResolvedAgentPresetsConfig;
  ActionPlanner: AgentActionPlannerDefaultsConfig;
  Artifacts: ResolvedAgentArtifactsConfig;
  Uploads: ResolvedAgentUploadsConfig;
  Frontend: ResolvedAgentFrontendConfig;
  Server: ResolvedAgentServerConfig;
  Persistence: ResolvedAgentPersistenceConfig;
  ConfigStore: ResolvedAgentConfigStoreConfig;
}
