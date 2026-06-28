import type {
  AgentActionPlannerConfig,
  AgentCliConfig,
  AgentSystemConfig,
  AgentToolLearningConfig,
  AgentVectorEmbeddingConfig,
  AgentVectorRerankConfig,
  ResolvedAgentArtifactsConfig,
  ResolvedAgentConfigStoreConfig,
  ResolvedAgentDelegationConfig,
  ResolvedAgentFrontendConfig,
  ResolvedAgentLoopConfig,
  ResolvedAgentMemoryLearningConfig,
  ResolvedAgentModelProviderEndpointConfig,
  ResolvedAgentPersistenceConfig,
  ResolvedAgentPluginDiscoveryConfig,
  ResolvedAgentPluginRootsConfig,
  ResolvedAgentPresetsConfig,
  ResolvedAgentToolExecutionConfig,
  ResolvedAgentToolSearchConfig,
  ResolvedAgentUploadsConfig,
} from "../Types/AgentConfigTypes.js";

export type ResolvedAgentCliDefaultsConfig = {
  Connection: {
    Url: string;
    TimeoutSeconds: number;
    SessionId?: string;
  };
  Display: {
    EventDisplayMode: NonNullable<NonNullable<AgentCliConfig["Display"]>["EventDisplayMode"]>;
    DetailMode: NonNullable<NonNullable<AgentCliConfig["Display"]>["DetailMode"]>;
    ShowXml: boolean;
    StreamXml: boolean;
    LivePreview: boolean;
    PreviewMode?: NonNullable<NonNullable<AgentCliConfig["Display"]>["PreviewMode"]>;
    PreviewTokenLimit: number;
  };
};

export interface AgentVectorModelsDefaultsConfig {
  Embedding: Required<AgentVectorEmbeddingConfig>;
  Rerank: Required<AgentVectorRerankConfig>;
}

export type AgentModelRuntimeDefaultsConfig = {
  Kind: "OpenAICompatible";
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
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

export type AgentActionPlannerClientDefaultsConfig =
  Required<Omit<NonNullable<AgentActionPlannerConfig["Client"]>, "ModelProviderId">>
  & Pick<NonNullable<AgentActionPlannerConfig["Client"]>, "ModelProviderId">;

export type AgentToolLearningDefaultsConfig =
  Required<Omit<AgentToolLearningConfig, "Client" | "Patterns">>
  & {
    Client: AgentActionPlannerClientDefaultsConfig;
    Patterns: Required<NonNullable<AgentToolLearningConfig["Patterns"]>>;
  };

export type AgentActionPlannerDefaultsConfig =
  Required<Omit<
    AgentActionPlannerConfig,
    "Evidence" | "Client" | "TurnUnderstandingClient" | "TaskFrameClient" | "EvidenceClient"
  >>
  & {
    Evidence: Required<NonNullable<AgentActionPlannerConfig["Evidence"]>>;
    Client: AgentActionPlannerClientDefaultsConfig;
    TurnUnderstandingClient: AgentActionPlannerClientDefaultsConfig;
    TaskFrameClient: AgentActionPlannerClientDefaultsConfig;
    EvidenceClient: AgentActionPlannerClientDefaultsConfig;
  };

export interface ResolvedAgentDefaultsConfig {
  PluginRoots: ResolvedAgentPluginRootsConfig;
  PluginDiscovery: ResolvedAgentPluginDiscoveryConfig;
  ModelProviderEndpoints: ResolvedAgentModelProviderEndpointConfig[];
  ModelRuntime: ResolvedAgentModelRuntimeDefaultsConfig;
  Cli: ResolvedAgentCliDefaultsConfig;
  ToolExecution: ResolvedAgentToolExecutionConfig;
  AgentLoop: ResolvedAgentLoopConfig;
  AgentDelegation: ResolvedAgentDelegationConfig;
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
  Server: Required<NonNullable<AgentSystemConfig["Server"]>>;
  Persistence: ResolvedAgentPersistenceConfig;
  ConfigStore: ResolvedAgentConfigStoreConfig;
}
