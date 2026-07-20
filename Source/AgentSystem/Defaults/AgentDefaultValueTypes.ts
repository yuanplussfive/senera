import type {
  AgentActionPlannerConfig,
  AgentSystemConfig,
  AgentToolLearningConfig,
  AgentVectorEmbeddingConfig,
  AgentVectorRerankConfig,
  ResolvedAgentArtifactsConfig,
  ResolvedAgentConfigStoreConfig,
  ResolvedAgentFrontendConfig,
  ResolvedAgentLoopConfig,
  ResolvedAgentMemoryLearningConfig,
  ResolvedAgentModelProviderEndpointConfig,
  ResolvedAgentPersistenceConfig,
  ResolvedAgentPluginDiscoveryConfig,
  ResolvedAgentPluginRootsConfig,
  ResolvedAgentPresetsConfig,
  ResolvedAgentSandboxRuntimeConfig,
  ResolvedAgentServerConfig,
  ResolvedAgentToolExecutionConfig,
  ResolvedAgentToolSearchConfig,
  ResolvedAgentUploadsConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentModelEndpointKind } from "../ModelEndpoints/AgentModelEndpointContract.js";

export interface AgentVectorModelsDefaultsConfig {
  Embedding: Required<AgentVectorEmbeddingConfig>;
  Rerank: Required<AgentVectorRerankConfig>;
}

export type AgentModelRuntimeDefaultsConfig = {
  Kind: "OpenAICompatible";
  Endpoint: AgentModelEndpointKind;
  Model: string;
  Capabilities: Required<NonNullable<AgentSystemConfig["ModelProviders"][number]["Capabilities"]>>;
  ContextWindowTokens: number;
  MaxModelOutputTokens: number;
  Temperature: number;
  MaxOutputTokens: number;
  Stream: boolean;
  TimeoutSeconds: number;
  FirstTokenTimeoutSeconds: number;
  MaxRequestSeconds: number;
  MaxNetworkRetries: number;
  MaxResponseBytes: number;
  MaxSseEventBytes: number;
  MaxSseEvents: number;
};

export type ResolvedAgentModelRuntimeDefaultsConfig = AgentModelRuntimeDefaultsConfig & {
  TimeoutMs: number;
  FirstTokenTimeoutMs: number;
  MaxRequestMs: number;
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

export type AgentActionPlannerDefaultsConfig = Required<
  Omit<AgentActionPlannerConfig, "Evidence" | "Client" | "PlanningClient" | "FinalAnswerClient">
> & {
  Evidence: Required<NonNullable<AgentActionPlannerConfig["Evidence"]>>;
  Client: AgentActionPlannerClientDefaultsConfig;
  PlanningClient: AgentActionPlannerClientDefaultsConfig;
  FinalAnswerClient: AgentActionPlannerClientDefaultsConfig;
};

export interface ResolvedAgentDefaultsConfig {
  PluginRoots: ResolvedAgentPluginRootsConfig;
  PluginDiscovery: ResolvedAgentPluginDiscoveryConfig;
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
  MemoryLearning: ResolvedAgentMemoryLearningConfig;
  Presets: ResolvedAgentPresetsConfig;
  ActionPlanner: AgentActionPlannerDefaultsConfig;
  Artifacts: ResolvedAgentArtifactsConfig;
  Uploads: ResolvedAgentUploadsConfig;
  Frontend: ResolvedAgentFrontendConfig;
  Server: ResolvedAgentServerConfig;
  Persistence: ResolvedAgentPersistenceConfig;
  ConfigStore: ResolvedAgentConfigStoreConfig;
}
