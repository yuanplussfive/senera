import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentDefaults,
  resolveAgentDefaults,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveConfigStoreConfig,
  resolveFrontendConfig,
  resolveModelProviderEndpointConfigs,
  resolveModelProviderRuntimeDefaults,
  resolvePersistenceConfig,
  resolvePresetsConfig,
  resolveSandboxRuntimeConfig,
  resolveServerConfig,
  resolveToolExecutionConfig,
  resolveToolSearchConfig,
  resolveUploadsConfig,
  resolveVectorModelsConfig,
} from "../AgentDefaults.js";
import { mergeActionPlannerClientConfig } from "../Defaults/AgentPlannerDefaults.js";

export function projectEffectiveConfig(config: AgentSystemConfig): AgentSystemConfig {
  return {
    ...config,
    AgentLoop: resolveAgentLoopConfig(config),
    SandboxRuntime: resolveSandboxRuntimeConfig(config),
    ToolExecution: projectResolvedToolExecution(config),
    ToolSearch: resolveToolSearchConfig(config),
    VectorModels: projectResolvedVectorModels(config),
    ToolLearning: projectResolvedToolLearning(config),
    MemoryLearning: projectResolvedMemoryLearning(config),
    Presets: resolvePresetsConfig(config),
    Artifacts: resolveArtifactsConfig(config),
    Uploads: resolveUploadsConfig(config),
    ActionPlanner: projectResolvedActionPlanner(config),
    Frontend: resolveFrontendConfig(config),
    Server: resolveServerConfig(config),
    Persistence: resolvePersistenceConfig(config),
    ConfigStore: resolveConfigStoreConfig(config),
    Extensions: config.Extensions,
    Defaults: {
      ...config.Defaults,
      AgentLoop: resolveAgentLoopConfig(config),
      SandboxRuntime: resolveSandboxRuntimeConfig(config),
      ToolExecution: projectResolvedToolExecution(config),
      ToolSearch: resolveToolSearchConfig(config),
      VectorModels: projectResolvedVectorModels(config),
      ToolLearning: projectResolvedToolLearning(config),
      MemoryLearning: projectResolvedMemoryLearning(config),
      Presets: resolvePresetsConfig(config),
      Artifacts: resolveArtifactsConfig(config),
      Uploads: resolveUploadsConfig(config),
      ActionPlanner: projectResolvedActionPlanner(config),
      Frontend: resolveFrontendConfig(config),
      Server: resolveServerConfig(config),
      Persistence: resolvePersistenceConfig(config),
      ConfigStore: resolveConfigStoreConfig(config),
    },
    ModelProviderEndpoints: resolveModelProviderEndpointConfigs(config),
    ModelProviders: config.ModelProviders.map((provider) =>
      resolveModelProviderRuntimeDefaults(resolveAgentDefaults(config).ModelRuntime, provider),
    ),
    ModelGroups: config.ModelGroups,
  };
}

function projectResolvedActionPlanner(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ActionPlanner"]> {
  const defaults = resolveAgentDefaults(config).ActionPlanner;
  const configured = config.ActionPlanner;
  const sharedClient = mergeActionPlannerClientConfig(defaults.Client, configured?.Client);
  return {
    Enabled: configured?.Enabled ?? defaults.Enabled,
    MaxRepairAttempts: configured?.MaxRepairAttempts ?? defaults.MaxRepairAttempts,
    Evidence: { ...defaults.Evidence, ...configured?.Evidence },
    Client: projectResolvedPlannerClient(sharedClient),
    PlanningClient: projectResolvedPlannerClient(
      mergeActionPlannerClientConfig(sharedClient, configured?.PlanningClient),
    ),
    FinalAnswerClient: projectResolvedPlannerClient(
      mergeActionPlannerClientConfig(sharedClient, configured?.FinalAnswerClient),
    ),
  };
}

function projectResolvedPlannerClient(client: ReturnType<typeof mergeActionPlannerClientConfig>) {
  return {
    ModelProviderId: client.ModelProviderId,
    Temperature: client.Temperature ?? AgentDefaults.ActionPlanner.Client.Temperature,
    MaxTokens: client.MaxTokens ?? AgentDefaults.ActionPlanner.Client.MaxTokens,
  };
}

function projectResolvedToolLearning(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ToolLearning"]> {
  const defaults = resolveAgentDefaults(config).ToolLearning;
  const configured = config.ToolLearning;
  return {
    Enabled: configured?.Enabled ?? defaults.Enabled,
    MaxRepairAttempts: configured?.MaxRepairAttempts ?? defaults.MaxRepairAttempts,
    Patterns: { ...defaults.Patterns, ...configured?.Patterns },
    Client: projectResolvedPlannerClient(mergeActionPlannerClientConfig(defaults.Client, configured?.Client)),
  };
}

function projectResolvedMemoryLearning(config: AgentSystemConfig): NonNullable<AgentSystemConfig["MemoryLearning"]> {
  const defaults = resolveAgentDefaults(config).MemoryLearning;
  const configured = config.MemoryLearning;
  return {
    Enabled: configured?.Enabled ?? defaults.Enabled,
    MaxRepairAttempts: configured?.MaxRepairAttempts ?? defaults.MaxRepairAttempts,
    Promotion: { ...defaults.Promotion, ...configured?.Promotion },
    Client: projectResolvedPlannerClient(mergeActionPlannerClientConfig(defaults.Client, configured?.Client)),
  };
}

function projectResolvedToolExecution(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ToolExecution"]> {
  const resolved = resolveToolExecutionConfig(config);
  return {
    TimeoutSeconds:
      config.ToolExecution?.TimeoutSeconds ??
      config.Defaults?.ToolExecution?.TimeoutSeconds ??
      AgentDefaults.ToolExecution.TimeoutSeconds,
    MaxStdoutBytes: resolved.MaxStdoutBytes,
    MaxStderrBytes: resolved.MaxStderrBytes,
    Environment: {
      Inherit: resolved.Environment.Inherit,
      IncludeOnly: [...resolved.Environment.IncludeOnly],
      Exclude: [...resolved.Environment.Exclude],
      Set: { ...resolved.Environment.Set },
    },
    Resources: {
      MaxActive: resolved.Resources.MaxActive,
      MaxBufferedBytes: resolved.Resources.MaxBufferedBytes,
      MaxInputBytes: resolved.Resources.MaxInputBytes,
      MaxWaitSeconds: resolved.Resources.MaxWaitSeconds,
      IdleTtlSeconds: resolved.Resources.IdleTtlSeconds,
      TerminalTtlSeconds: resolved.Resources.TerminalTtlSeconds,
      SweepIntervalSeconds: resolved.Resources.SweepIntervalSeconds,
      TerminationGraceSeconds: resolved.Resources.TerminationGraceSeconds,
    },
  };
}

function projectResolvedVectorModels(config: AgentSystemConfig): NonNullable<AgentSystemConfig["VectorModels"]> {
  const resolved = resolveVectorModelsConfig(config);
  const defaults = resolveAgentDefaults(config);
  return {
    Embedding: {
      Enabled: resolved.Embedding.Enabled,
      ProviderId:
        config.VectorModels?.Embedding?.ProviderId ??
        config.Defaults?.VectorModels?.Embedding?.ProviderId ??
        AgentDefaults.VectorModels.Embedding.ProviderId,
      Model: resolved.Embedding.Model,
      TimeoutSeconds: config.VectorModels?.Embedding?.TimeoutSeconds ?? defaults.VectorModels.Embedding.TimeoutSeconds,
      MaxNetworkRetries: resolved.Embedding.MaxNetworkRetries,
      Dimensions: resolved.Embedding.Dimensions,
      BatchSize: resolved.Embedding.BatchSize,
      InputMaxChars: resolved.Embedding.InputMaxChars,
    },
    Rerank: {
      Enabled: resolved.Rerank.Enabled,
      ProviderId:
        config.VectorModels?.Rerank?.ProviderId ??
        config.Defaults?.VectorModels?.Rerank?.ProviderId ??
        AgentDefaults.VectorModels.Rerank.ProviderId,
      Model: resolved.Rerank.Model,
      TimeoutSeconds: config.VectorModels?.Rerank?.TimeoutSeconds ?? defaults.VectorModels.Rerank.TimeoutSeconds,
      MaxNetworkRetries: resolved.Rerank.MaxNetworkRetries,
      EndpointPath: resolved.Rerank.EndpointPath,
      CandidateLimit: resolved.Rerank.CandidateLimit,
      TopK: resolved.Rerank.TopK,
    },
  };
}
