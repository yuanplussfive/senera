import type {
  AgentActionPlannerConfig,
  AgentContinuityLearningConfig,
  AgentContinuityLearningContextConfig,
  AgentContinuityLearningGateConfig,
  AgentContinuityLearningRuntimeConfig,
  AgentContinuityLearningRecallConfig,
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
  ResolvedAgentPromptConfig,
  ResolvedAgentSandboxRuntimeConfig,
  ResolvedAgentServerConfig,
  ResolvedAgentToolExecutionConfig,
  ResolvedAgentToolSearchConfig,
  ResolvedAgentTodosConfig,
  ResolvedAgentUploadsConfig,
  ResolvedAgentWorldConfig,
  ResolvedAgentInferenceBudgetConfig,
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

export type AgentContinuityLearningClientDefaultsConfig = Required<
  Omit<NonNullable<AgentContinuityLearningConfig["Client"]>, "ModelProviderId">
> &
  Pick<NonNullable<AgentContinuityLearningConfig["Client"]>, "ModelProviderId">;

export type AgentContinuityLearningDefaultsConfig = Required<
  Omit<AgentContinuityLearningConfig, "Client" | "Runtime" | "LearningGate" | "LearningContext" | "TemporalMemory">
> & {
  Client: AgentContinuityLearningClientDefaultsConfig;
  Runtime: AgentContinuityLearningRuntimeConfig;
  LearningGate: AgentContinuityLearningGateConfig;
  LearningContext: AgentContinuityLearningContextConfig;
  TemporalMemory: Required<NonNullable<AgentContinuityLearningConfig["TemporalMemory"]>>;
  Recall: AgentContinuityLearningRecallConfig;
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
  InferenceBudget: ResolvedAgentInferenceBudgetConfig;
  ToolExecution: ResolvedAgentToolExecutionConfig;
  SandboxRuntime: ResolvedAgentSandboxRuntimeConfig;
  AgentLoop: ResolvedAgentLoopConfig;
  ToolSearch: ResolvedAgentToolSearchConfig;
  VectorModels: {
    Embedding: ResolvedAgentVectorEmbeddingDefaultsConfig;
    Rerank: ResolvedAgentVectorRerankDefaultsConfig;
  };
  ToolLearning: AgentToolLearningDefaultsConfig;
  Todos: ResolvedAgentTodosConfig;
  ContinuityLearning: AgentContinuityLearningDefaultsConfig;
  Presets: ResolvedAgentPresetsConfig;
  ActionPlanner: AgentActionPlannerDefaultsConfig;
  Artifacts: ResolvedAgentArtifactsConfig;
  Uploads: ResolvedAgentUploadsConfig;
  Frontend: ResolvedAgentFrontendConfig;
  Server: ResolvedAgentServerConfig;
  Prompt: ResolvedAgentPromptConfig;
  World: ResolvedAgentWorldConfig;
  Persistence: ResolvedAgentPersistenceConfig;
  ConfigStore: ResolvedAgentConfigStoreConfig;
}
