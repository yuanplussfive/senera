import type {
  AgentModelProviderEndpointConfig,
  AgentSystemConfig,
} from "../Types/AgentConfigTypes.js";
import {
  AgentDefaults,
  resolveActionPlannerConfig,
  resolveAgentDefaults,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveConfigStoreConfig,
  resolveFrontendConfig,
  resolveMemoryLearningConfig,
  resolvePersistenceConfig,
  resolvePresetsConfig,
  resolveServerConfig,
  resolveToolExecutionConfig,
  resolveToolLearningConfig,
  resolveToolSearchConfig,
  resolveUploadsConfig,
  resolveVectorModelsConfig,
} from "../AgentDefaults.js";

export function projectEffectiveConfig(config: AgentSystemConfig): AgentSystemConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...config,
    AgentLoop: resolveAgentLoopConfig(config),
    ToolExecution: projectResolvedToolExecution(config),
    ToolSearch: resolveToolSearchConfig(config),
    VectorModels: projectResolvedVectorModels(config),
    ToolLearning: projectResolvedToolLearning(config),
    MemoryLearning: resolveMemoryLearningConfig(config),
    Presets: resolvePresetsConfig(config),
    Artifacts: resolveArtifactsConfig(config),
    Uploads: resolveUploadsConfig(config),
    ActionPlanner: projectResolvedActionPlanner(config),
    Frontend: resolveFrontendConfig(config),
    Server: resolveServerConfig(config),
    Persistence: resolvePersistenceConfig(config),
    ConfigStore: resolveConfigStoreConfig(config),
    Defaults: {
      ...config.Defaults,
      AgentLoop: resolveAgentLoopConfig(config),
      ToolExecution: projectResolvedToolExecution(config),
      ToolSearch: resolveToolSearchConfig(config),
      VectorModels: projectResolvedVectorModels(config),
      ToolLearning: projectResolvedToolLearning(config),
      MemoryLearning: resolveMemoryLearningConfig(config),
      Presets: resolvePresetsConfig(config),
      Artifacts: resolveArtifactsConfig(config),
      Uploads: resolveUploadsConfig(config),
      ActionPlanner: projectResolvedActionPlanner(config),
      Frontend: resolveFrontendConfig(config),
      Server: resolveServerConfig(config),
      Persistence: resolvePersistenceConfig(config),
      ConfigStore: resolveConfigStoreConfig(config),
    },
    ModelProviderEndpoints: projectModelProviderEndpoints(config),
    ModelProviders: config.ModelProviders.map((provider) => ({
      ...AgentDefaults.ModelRuntime,
      ...provider,
    })),
    ModelGroups: config.ModelGroups,
  };
}

function projectModelProviderEndpoints(config: AgentSystemConfig) {
  const endpointsById = new Map<string, AgentModelProviderEndpointConfig>();
  for (const endpoint of AgentDefaults.ModelProviderEndpoints) {
    endpointsById.set(endpoint.Id, endpoint);
  }
  for (const endpoint of config.ModelProviderEndpoints ?? []) {
    endpointsById.set(endpoint.Id, {
      ...defaultModelProviderEndpointFields(endpoint.Id),
      ...endpoint,
    });
  }
  return [...endpointsById.values()];
}

function defaultModelProviderEndpointFields(id: string) {
  return AgentDefaults.ModelProviderEndpoints.find((endpoint) => endpoint.Id === id) ?? {
    Id: id,
    Icon: "",
    Enabled: true,
    Kind: "OpenAICompatible" as const,
    BaseUrl: "",
    ApiKey: "",
    ApiVersion: "2023-06-01",
    Headers: {},
  };
}

function projectResolvedActionPlanner(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ActionPlanner"]> {
  const resolved = resolveActionPlannerConfig(config);
  return {
    Enabled: resolved.Enabled,
    MaxRepairAttempts: resolved.MaxRepairAttempts,
    Evidence: resolved.Evidence,
    Client: projectResolvedPlannerClient(resolved.Client),
    TurnUnderstandingClient: projectResolvedPlannerClient(resolved.TurnUnderstandingClient),
    PlanningClient: projectResolvedPlannerClient(resolved.PlanningClient),
  };
}

function projectResolvedPlannerClient(
  client: ReturnType<typeof resolveActionPlannerConfig>["Client"],
) {
  return {
    ModelProviderId: client.ModelProviderId,
    Provider: client.Provider,
    Temperature: client.Temperature,
    MaxTokens: client.MaxTokens,
  };
}

function projectResolvedToolLearning(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ToolLearning"]> {
  const resolved = resolveToolLearningConfig(config);
  return {
    Enabled: resolved.Enabled,
    MaxRepairAttempts: resolved.MaxRepairAttempts,
    Patterns: resolved.Patterns,
    Client: projectResolvedPlannerClient(resolved.Client),
  };
}

function projectResolvedToolExecution(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ToolExecution"]> {
  const resolved = resolveToolExecutionConfig(config);
  return {
    TimeoutSeconds: config.ToolExecution?.TimeoutSeconds
      ?? config.Defaults?.ToolExecution?.TimeoutSeconds
      ?? AgentDefaults.ToolExecution.TimeoutSeconds,
    MaxStdoutBytes: resolved.MaxStdoutBytes,
    MaxStderrBytes: resolved.MaxStderrBytes,
  };
}

function projectResolvedVectorModels(config: AgentSystemConfig): NonNullable<AgentSystemConfig["VectorModels"]> {
  const resolved = resolveVectorModelsConfig(config);
  const defaults = resolveAgentDefaults(config);
  return {
    Embedding: {
      Enabled: resolved.Embedding.Enabled,
      ProviderId: config.VectorModels?.Embedding?.ProviderId
        ?? config.Defaults?.VectorModels?.Embedding?.ProviderId
        ?? AgentDefaults.VectorModels.Embedding.ProviderId,
      Model: resolved.Embedding.Model,
      TimeoutSeconds: config.VectorModels?.Embedding?.TimeoutSeconds
        ?? defaults.VectorModels.Embedding.TimeoutSeconds,
      MaxNetworkRetries: resolved.Embedding.MaxNetworkRetries,
      Dimensions: resolved.Embedding.Dimensions,
      BatchSize: resolved.Embedding.BatchSize,
      InputMaxChars: resolved.Embedding.InputMaxChars,
    },
    Rerank: {
      Enabled: resolved.Rerank.Enabled,
      ProviderId: config.VectorModels?.Rerank?.ProviderId
        ?? config.Defaults?.VectorModels?.Rerank?.ProviderId
        ?? AgentDefaults.VectorModels.Rerank.ProviderId,
      Model: resolved.Rerank.Model,
      TimeoutSeconds: config.VectorModels?.Rerank?.TimeoutSeconds
        ?? defaults.VectorModels.Rerank.TimeoutSeconds,
      MaxNetworkRetries: resolved.Rerank.MaxNetworkRetries,
      EndpointPath: resolved.Rerank.EndpointPath,
      CandidateLimit: resolved.Rerank.CandidateLimit,
      TopK: resolved.Rerank.TopK,
    },
  };
}
