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
  resolveSandboxRuntimeConfig,
  resolveServerConfig,
  resolveToolExecutionConfig,
  resolveAgentTodosConfig,
  resolveToolSearchConfig,
  resolveUploadsConfig,
  resolveAgentPromptConfig,
  resolveAgentInferenceBudgetConfig,
  resolveAgentMcpConnectionsConfig,
} from "../AgentDefaults.js";
import { mergeActionPlannerClientConfig } from "../Defaults/AgentPlannerDefaults.js";

export function projectEffectiveConfig(config: AgentSystemConfig): AgentSystemConfig {
  return {
    ...config,
    AgentLoop: resolveAgentLoopConfig(config),
    Todos: resolveAgentTodosConfig(config),
    SandboxRuntime: resolveSandboxRuntimeConfig(config),
    ToolExecution: projectResolvedToolExecution(config),
    ToolSearch: resolveToolSearchConfig(config),
    StateCard: projectResolvedStateCard(config),
    ContinuityLearning: projectResolvedContinuityLearning(config),
    Artifacts: resolveArtifactsConfig(config),
    Uploads: resolveUploadsConfig(config),
    ActionPlanner: projectResolvedActionPlanner(config),
    Frontend: resolveFrontendConfig(config),
    Server: resolveServerConfig(config),
    Persistence: resolvePersistenceConfig(config),
    ConfigStore: resolveConfigStoreConfig(config),
    Prompt: resolveAgentPromptConfig(config),
    InferenceBudget: resolveAgentInferenceBudgetConfig(config),
    McpConnections: projectResolvedMcpConnections(config),
    Extensions: config.Extensions,
    Defaults: {
      ...config.Defaults,
      AgentLoop: resolveAgentLoopConfig(config),
      Todos: resolveAgentTodosConfig(config),
      SandboxRuntime: resolveSandboxRuntimeConfig(config),
      ToolExecution: projectResolvedToolExecution(config),
      ToolSearch: resolveToolSearchConfig(config),
      StateCard: projectResolvedStateCard(config),
      ContinuityLearning: projectResolvedContinuityLearning(config),
      Artifacts: resolveArtifactsConfig(config),
      Uploads: resolveUploadsConfig(config),
      ActionPlanner: projectResolvedActionPlanner(config),
      Frontend: resolveFrontendConfig(config),
      Server: resolveServerConfig(config),
      Persistence: resolvePersistenceConfig(config),
      ConfigStore: resolveConfigStoreConfig(config),
      Prompt: resolveAgentPromptConfig(config),
      InferenceBudget: resolveAgentDefaults(config).InferenceBudget,
      McpConnections: projectResolvedMcpConnections(config),
    },
    ModelProviderEndpoints: resolveModelProviderEndpointConfigs(config),
    ModelProviders: config.ModelProviders.map((provider) =>
      resolveModelProviderRuntimeDefaults(resolveAgentDefaults(config).ModelRuntime, provider),
    ),
    ModelGroups: config.ModelGroups,
  };
}

function projectResolvedMcpConnections(config: AgentSystemConfig): NonNullable<AgentSystemConfig["McpConnections"]> {
  const resolved = resolveAgentMcpConnectionsConfig(config);
  return {
    IdleTtlSeconds: resolved.IdleTtlMs / 1_000,
    SweepIntervalSeconds: resolved.SweepIntervalMs / 1_000,
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

function projectResolvedStateCard(config: AgentSystemConfig): NonNullable<AgentSystemConfig["StateCard"]> {
  const defaults = resolveAgentDefaults(config).StateCard;
  const configured = config.StateCard;
  return {
    Enabled: configured?.Enabled ?? defaults.Enabled,
    HistoryBudgetCharacters: configured?.HistoryBudgetCharacters ?? defaults.HistoryBudgetCharacters,
    Client: projectResolvedContinuityClient({ ...defaults.Client, ...configured?.Client }),
  };
}

function projectResolvedContinuityLearning(
  config: AgentSystemConfig,
): NonNullable<AgentSystemConfig["ContinuityLearning"]> {
  const defaults = resolveAgentDefaults(config).ContinuityLearning;
  const configured = config.ContinuityLearning;
  return {
    Enabled: configured?.Enabled ?? defaults.Enabled,
    Runtime: {
      ...defaults.Runtime,
      ...configured?.Runtime,
    },
    Recall: {
      ...defaults.Recall,
      PromptBudget: {
        ...defaults.Recall.PromptBudget,
        ...configured?.Recall?.PromptBudget,
      },
    },
    MemOS: {
      ...defaults.MemOS,
      ...configured?.MemOS,
    },
    Client: projectResolvedContinuityClient({ ...defaults.Client, ...configured?.Client }),
  };
}

function projectResolvedContinuityClient(
  client: NonNullable<AgentSystemConfig["ContinuityLearning"]>["Client"] & Record<string, unknown>,
) {
  return {
    ModelProviderId: client?.ModelProviderId,
    Temperature: client?.Temperature ?? AgentDefaults.ContinuityLearning.Client.Temperature,
  };
}

function projectResolvedToolExecution(config: AgentSystemConfig): NonNullable<AgentSystemConfig["ToolExecution"]> {
  const resolved = resolveToolExecutionConfig(config);
  return {
    TimeoutSeconds:
      config.ToolExecution?.TimeoutSeconds ??
      config.Defaults?.ToolExecution?.TimeoutSeconds ??
      AgentDefaults.ToolExecution.TimeoutSeconds,
    MaxConcurrentCallsPerRun: resolved.MaxConcurrentCallsPerRun,
    MaxStdoutBytes: resolved.MaxStdoutBytes,
    MaxStderrBytes: resolved.MaxStderrBytes,
    SemanticAudit: { ...resolved.SemanticAudit },
    Environment: {
      Inherit: resolved.Environment.Inherit,
      IncludeOnly: [...resolved.Environment.IncludeOnly],
      Exclude: [...resolved.Environment.Exclude],
      Set: { ...resolved.Environment.Set },
    },
    Resources: {
      MaxActive: resolved.Resources.MaxActive,
      MaxBufferedBytes: resolved.Resources.MaxBufferedBytes,
      OutputBatchMaxBytes: resolved.Resources.OutputBatchMaxBytes,
      OutputBatchMaxDelayMs: resolved.Resources.OutputBatchMaxDelayMs,
      MaxInputBytes: resolved.Resources.MaxInputBytes,
      InitialYieldSeconds: resolved.Resources.InitialYieldSeconds,
      MaxWaitSeconds: resolved.Resources.MaxWaitSeconds,
      IdleTtlSeconds: resolved.Resources.IdleTtlSeconds,
      TerminalTtlSeconds: resolved.Resources.TerminalTtlSeconds,
      SweepIntervalSeconds: resolved.Resources.SweepIntervalSeconds,
      TerminationGraceSeconds: resolved.Resources.TerminationGraceSeconds,
    },
  };
}
