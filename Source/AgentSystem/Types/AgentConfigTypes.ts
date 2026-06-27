
export interface AgentDefaultsConfig {
  PluginRoots?: {
    System?: string[];
    User?: string[];
  };
  PluginDiscovery?: {
    ManifestFileName?: string;
    ConfigFileName?: string;
  };
  Cli?: AgentCliConfig;
  ToolExecution?: {
    Mode?: "Process";
    TimeoutSeconds?: number;
    MaxStdoutBytes?: number;
    MaxStderrBytes?: number;
  };
  AgentLoop?: {
    MaxSteps?: number;
    MaxRepairAttempts?: number;
    LoadedTools?: AgentLoadedToolsConfig;
  };
  AgentDelegation?: AgentDelegationConfig;
  ToolSearch?: AgentToolSearchConfig;
  VectorModels?: AgentVectorModelsConfig;
  ToolLearning?: AgentToolLearningConfig;
  MemoryLearning?: AgentMemoryLearningConfig;
  Presets?: AgentPresetsConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: {
    Host?: string;
    Port?: number;
    HotReload?: boolean;
    RequestMaxBytes?: number;
  };
  Persistence?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
  };
  ConfigStore?: AgentConfigStoreConfig;
}

export interface AgentSystemConfig {
  Defaults?: AgentDefaultsConfig;
  PluginRoots?: {
    System?: string[];
    User?: string[];
  };
  PluginDiscovery?: {
    ManifestFileName?: string;
    ConfigFileName?: string;
  };
  XmlProtocol?: {
    MaxDepth?: number;
    MaxTextLength?: number;
    MaxDecisionTokens?: number;
    MaxToolCalls?: number;
    ArrayElementNames?: string[];
    ArrayElementNameSuffix?: string;
  };
  ToolExecution?: {
    Mode?: "Process";
    TimeoutSeconds?: number;
    MaxStdoutBytes?: number;
    MaxStderrBytes?: number;
  };
  PluginDocumentation?: {
    Markdown?: {
      MinNonEmptyLines?: number;
      ExcludePathFragments?: string[];
    };
    ToolDescription?: {
      MinNonEmptyLines?: number;
      SummarySection?: string;
      TriggerSection?: string;
      AvoidSection?: string;
      RequiredSections?: string[];
    };
    DecisionActionDescription?: {
      MinNonEmptyLines?: number;
      SummarySection?: string;
      TriggerSection?: string;
      AvoidSection?: string;
      RequiredSections?: string[];
    };
    PromptXml?: {
      XmlFenceLanguages?: string[];
      CodeFenceLanguages?: string[];
    };
  };
  DefaultModelProviderId?: string;
  ModelProviderEndpoints?: AgentModelProviderEndpointConfig[];
  ModelProviders: AgentModelProviderConfig[];
  ModelGroups?: AgentModelGroupConfig[];
  Cli?: AgentCliConfig;
  AgentLoop?: {
    MaxSteps?: number;
    MaxRepairAttempts?: number;
    LoadedTools?: AgentLoadedToolsConfig;
  };
  AgentDelegation?: AgentDelegationConfig;
  ToolSearch?: AgentToolSearchConfig;
  VectorModels?: AgentVectorModelsConfig;
  ToolLearning?: AgentToolLearningConfig;
  MemoryLearning?: AgentMemoryLearningConfig;
  Presets?: AgentPresetsConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: {
    Host?: string;
    Port?: number;
    HotReload?: boolean;
    RequestMaxBytes?: number;
  };
  Persistence?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
  };
  ConfigStore?: AgentConfigStoreConfig;
}

export interface AgentConfigStoreConfig {
  Enabled?: boolean;
  Kind?: "sqlite";
  DatabasePath?: string;
  MirrorJson?: boolean;
}

export type AgentLoadedToolsConfig = "all" | "dynamic" | string[];

export type ResolvedAgentLoopConfig = Required<NonNullable<AgentSystemConfig["AgentLoop"]>>;

export type AgentDelegationRuntimeMode = "directModel" | "agentLoop";

export interface AgentDelegationRuntimeProfileConfig {
  Mode?: AgentDelegationRuntimeMode;
  ModelProviderId?: string;
  AgentLoop?: {
    MaxSteps?: number;
    MaxRepairAttempts?: number;
    LoadedTools?: AgentLoadedToolsConfig;
  };
}

export interface AgentDelegationMergeConfig {
  ModelProviderId?: string;
}

export interface AgentDelegationTemplateConfig {
  ChildSystemPrompt?: string;
  MergeSystemPrompt?: string;
}

export interface AgentDelegationConfig {
  RuntimeProfileDefaults?: AgentDelegationRuntimeProfileConfig;
  RuntimeProfiles?: Record<string, AgentDelegationRuntimeProfileConfig>;
  Templates?: AgentDelegationTemplateConfig;
  Merge?: AgentDelegationMergeConfig;
}

export interface ResolvedAgentDelegationRuntimeProfileConfig {
  Name: string;
  Mode: AgentDelegationRuntimeMode;
  ModelProviderId?: string;
  AgentLoop: ResolvedAgentLoopConfig;
}

export interface ResolvedAgentDelegationConfig {
  RuntimeProfileDefaults?: Omit<ResolvedAgentDelegationRuntimeProfileConfig, "Name">;
  RuntimeProfiles: Record<string, ResolvedAgentDelegationRuntimeProfileConfig>;
  Templates: Required<AgentDelegationTemplateConfig>;
  Merge: AgentDelegationMergeConfig;
}

export interface ResolvedAgentPluginRootsConfig {
  System: string[];
  User: string[];
}

export interface ResolvedAgentPluginDiscoveryConfig {
  ManifestFileName: string;
  ConfigFileName: string;
}

export interface ResolvedAgentToolExecutionConfig {
  Mode: "Process";
  TimeoutMs: number;
  MaxStdoutBytes: number;
  MaxStderrBytes: number;
}

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

export interface AgentPresetsConfig {
  Enabled?: boolean;
  RootDir?: string;
  StateFile?: string;
}

export interface ResolvedAgentPresetsConfig {
  Enabled: boolean;
  RootDir: string;
  StateFile: string;
}

export interface AgentArtifactsConfig {
  RootDir?: string;
  SummaryMaxChars?: number;
  RawJsonMaxBytes?: number;
  TextFileMaxBytes?: number;
}

export interface ResolvedAgentArtifactsConfig {
  RootDir: string;
  SummaryMaxChars: number;
  RawJsonMaxBytes: number;
  TextFileMaxBytes: number;
}

export interface AgentUploadsConfig {
  RootDir?: string;
  MaxFileBytes?: number;
}

export interface ResolvedAgentUploadsConfig {
  RootDir: string;
  MaxFileBytes: number;
}

export interface AgentActionPlannerConfig {
  Enabled?: boolean;
  MaxRepairAttempts?: number;
  Evidence?: AgentActionPlannerEvidenceConfig;
  Client?: AgentActionPlannerClientConfig;
  TurnUnderstandingClient?: AgentActionPlannerClientConfig;
  TaskFrameClient?: AgentActionPlannerClientConfig;
  EvidenceClient?: AgentActionPlannerClientConfig;
}

export interface AgentActionPlannerEvidenceConfig {
  StalledStepLag?: number;
}

export type AgentActionPlannerClientProvider =
  | "openai-generic"
  | "openai-responses"
  | "anthropic"
  | "google-ai";

export interface AgentActionPlannerClientConfig {
  ModelProviderId?: string;
  Provider?: AgentActionPlannerClientProvider;
  Temperature?: number;
  /** -1 means do not send a provider token limit field. */
  MaxTokens?: number;
}

export interface ResolvedAgentActionPlannerConfig {
  Enabled: boolean;
  MaxRepairAttempts: number;
  Evidence: Required<AgentActionPlannerEvidenceConfig>;
  Client: ResolvedAgentActionPlannerClientConfig;
  TurnUnderstandingClient: ResolvedAgentActionPlannerClientConfig;
  TaskFrameClient: ResolvedAgentActionPlannerClientConfig;
  EvidenceClient: ResolvedAgentActionPlannerClientConfig;
}

export interface ResolvedAgentActionPlannerClientConfig {
  ModelProviderId?: string;
  Provider: AgentActionPlannerClientProvider;
  BaseUrl: string;
  ApiKey: string;
  Model: string;
  Temperature: number;
  MaxTokens: number;
}

export interface AgentFrontendServerConfig {
  Host?: string;
  Port?: number;
  StrictPort?: boolean;
}

export interface AgentFrontendClientConfig {
  WebSocketUrl?: string;
  ModelLabel?: string;
  UserName?: string;
  EmptySuggestions?: string[];
}

export interface AgentFrontendConfig {
  DevServer?: AgentFrontendServerConfig;
  PreviewServer?: AgentFrontendServerConfig;
  Client?: AgentFrontendClientConfig;
}

export interface ResolvedAgentFrontendConfig {
  DevServer: Required<AgentFrontendServerConfig>;
  PreviewServer: Required<AgentFrontendServerConfig>;
  Client: Required<AgentFrontendClientConfig>;
}

export interface AgentModelProviderConfig {
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: AgentModelCapabilitiesConfig;
  ContextWindowTokens?: number;
  MaxModelOutputTokens?: number;
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  Model: string;
  Temperature?: number;
  MaxOutputTokens?: number;
  Stream?: boolean;
  TimeoutSeconds?: number;
  FirstTokenTimeoutSeconds?: number;
  MaxRequestSeconds?: number;
  MaxNetworkRetries?: number;
}

export interface AgentModelCapabilitiesConfig {
  Chat?: boolean;
  Embedding?: boolean;
  Rerank?: boolean;
  Vision?: boolean;
  ImageOutput?: boolean;
  Reasoning?: boolean;
  ToolCalling?: boolean;
}

export type AgentModelGroupMatchKind = "exact" | "prefix" | "suffix" | "includes";

export interface AgentModelGroupConfig {
  Id: string;
  Label: string;
  Icon?: string;
  Match?: AgentModelGroupMatchKind;
  Values?: string[];
  Strategies?: AgentModelGroupStrategyConfig[];
}

export interface AgentModelGroupStrategyConfig {
  Match: AgentModelGroupMatchKind;
  Values: string[];
}

export interface AgentModelProviderEndpointConfig {
  Id: string;
  Icon?: string;
  Enabled?: boolean;
  Kind?: "OpenAICompatible";
  BaseUrl?: string;
  ApiKey?: string;
  ApiVersion?: string;
  Headers?: Record<string, string>;
}

export interface ResolvedAgentModelProviderEndpointConfig {
  Id: string;
  Icon: string;
  Enabled: boolean;
  Kind: "OpenAICompatible";
  BaseUrl: string;
  ApiKey: string;
  ApiVersion: string;
  Headers: Record<string, string>;
}

export interface AgentModelRuntimeDefaultsConfig {
  Kind: "OpenAICompatible";
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  Model: string;
  Capabilities: Required<AgentModelCapabilitiesConfig>;
  ContextWindowTokens: number;
  MaxModelOutputTokens: number;
  Temperature: number;
  MaxOutputTokens: number;
  Stream: boolean;
  TimeoutSeconds: number;
  FirstTokenTimeoutSeconds: number;
  MaxRequestSeconds: number;
  MaxNetworkRetries: number;
}

export interface ResolvedAgentModelProviderConfig {
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: AgentModelCapabilitiesConfig;
  ContextWindowTokens?: number;
  MaxModelOutputTokens?: number;
  Kind: "OpenAICompatible";
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  BaseUrl: string;
  ApiKey: string;
  ApiVersion: string;
  Model: string;
  Temperature: number;
  MaxOutputTokens: number;
  Stream: boolean;
  TimeoutMs: number;
  FirstTokenTimeoutMs: number;
  MaxRequestMs: number;
  MaxNetworkRetries: number;
  Headers: Record<string, string>;
}

export interface ResolvedAgentPersistenceConfig {
  Kind: "sqlite" | "memory";
  DatabasePath: string;
}

export interface ResolvedAgentConfigStoreConfig {
  Enabled: boolean;
  Kind: "sqlite";
  DatabasePath: string;
  MirrorJson: boolean;
}

export interface AgentModelProviderListItem {
  id: string;
  icon?: string;
  capabilities: Required<AgentModelCapabilitiesConfig>;
  kind: ResolvedAgentModelProviderConfig["Kind"];
  endpoint: ResolvedAgentModelProviderConfig["Endpoint"];
  baseUrl: string;
  model: string;
  isDefault: boolean;
}

export interface AgentCliConfig {
  Connection?: {
    Url?: string;
    SessionId?: string;
    TimeoutSeconds?: number;
  };
  Display?: {
    EventDisplayMode?: "activity" | "compact" | "verbose";
    DetailMode?: "none" | "errors" | "tools" | "xml" | "all";
    ShowXml?: boolean;
    StreamXml?: boolean;
    LivePreview?: boolean;
    PreviewMode?: "block" | "line";
    PreviewTokenLimit?: number;
  };
}

