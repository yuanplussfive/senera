import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentDefaults } from "./AgentDefaultValues.js";
import type { ResolvedAgentDefaultsConfig } from "./AgentDefaultValues.js";
import { disabledOrSecondsToMilliseconds, secondsToMilliseconds } from "./AgentTimeDefaults.js";

export function resolveAgentDefaults(
  config: Pick<AgentSystemConfig, "Defaults"> | undefined,
): ResolvedAgentDefaultsConfig {
  const defaults = config?.Defaults;

  return {
    PluginRoots: {
      System: defaults?.PluginRoots?.System ?? [...AgentDefaults.PluginRoots.System],
      User: defaults?.PluginRoots?.User ?? [...AgentDefaults.PluginRoots.User],
    },
    PluginDiscovery: {
      ...AgentDefaults.PluginDiscovery,
      ...defaults?.PluginDiscovery,
    },
    ModelProviderEndpoints: AgentDefaults.ModelProviderEndpoints.map((endpoint) => ({ ...endpoint })),
    ModelRuntime: {
      ...AgentDefaults.ModelRuntime,
      ...defaultModelRuntimeMilliseconds(AgentDefaults.ModelRuntime),
    },
    ToolExecution: {
      TimeoutMs: secondsToMilliseconds(
        defaults?.ToolExecution?.TimeoutSeconds ?? AgentDefaults.ToolExecution.TimeoutSeconds,
      ),
      MaxStdoutBytes: defaults?.ToolExecution?.MaxStdoutBytes ?? AgentDefaults.ToolExecution.MaxStdoutBytes,
      MaxStderrBytes: defaults?.ToolExecution?.MaxStderrBytes ?? AgentDefaults.ToolExecution.MaxStderrBytes,
      Environment: {
        ...AgentDefaults.ToolExecution.Environment,
        ...defaults?.ToolExecution?.Environment,
        IncludeOnly: [
          ...(defaults?.ToolExecution?.Environment?.IncludeOnly ?? AgentDefaults.ToolExecution.Environment.IncludeOnly),
        ],
        Exclude: [
          ...(defaults?.ToolExecution?.Environment?.Exclude ?? AgentDefaults.ToolExecution.Environment.Exclude),
        ],
        Set: {
          ...AgentDefaults.ToolExecution.Environment.Set,
          ...(defaults?.ToolExecution?.Environment?.Set ?? {}),
        },
      },
      Resources: resolveExecutionResourceDefaults(defaults?.ToolExecution?.Resources),
    },
    SandboxRuntime: {
      ...AgentDefaults.SandboxRuntime,
      ...defaults?.SandboxRuntime,
      Images: [...new Set([...AgentDefaults.SandboxRuntime.Images, ...(defaults?.SandboxRuntime?.Images ?? [])])],
    },
    AgentLoop: {
      ...AgentDefaults.AgentLoop,
      ...defaults?.AgentLoop,
      PiSessions: {
        ...AgentDefaults.AgentLoop.PiSessions,
        ...defaults?.AgentLoop?.PiSessions,
        Compaction: {
          ...AgentDefaults.AgentLoop.PiSessions.Compaction,
          ...defaults?.AgentLoop?.PiSessions?.Compaction,
          TimeoutMs: secondsToMilliseconds(
            defaults?.AgentLoop?.PiSessions?.Compaction?.TimeoutSeconds ??
              AgentDefaults.AgentLoop.PiSessions.Compaction.TimeoutSeconds,
          ),
        },
      },
      PiTurnLeaseTimeoutMs: secondsToMilliseconds(
        defaults?.AgentLoop?.PiTurnLeaseTimeoutSeconds ?? AgentDefaults.AgentLoop.PiTurnLeaseTimeoutSeconds,
      ),
      RunSettlementTimeoutMs: secondsToMilliseconds(
        defaults?.AgentLoop?.RunSettlementTimeoutSeconds ?? AgentDefaults.AgentLoop.RunSettlementTimeoutSeconds,
      ),
    },
    ToolSearch: {
      Embedding: {
        ...AgentDefaults.ToolSearch.Embedding,
        ...defaults?.ToolSearch?.Embedding,
      },
      Memory: {
        ...AgentDefaults.ToolSearch.Memory,
        ...defaults?.ToolSearch?.Memory,
      },
      Ranking: {
        ...AgentDefaults.ToolSearch.Ranking,
        ...defaults?.ToolSearch?.Ranking,
        IntentGate: {
          ...AgentDefaults.ToolSearch.Ranking.IntentGate,
          ...defaults?.ToolSearch?.Ranking?.IntentGate,
        },
        MemoryExpansion: {
          ...AgentDefaults.ToolSearch.Ranking.MemoryExpansion,
          ...defaults?.ToolSearch?.Ranking?.MemoryExpansion,
        },
      },
      Rerank: {
        ...AgentDefaults.ToolSearch.Rerank,
        ...defaults?.ToolSearch?.Rerank,
        FeatureWeights: {
          ...AgentDefaults.ToolSearch.Rerank.FeatureWeights,
          ...defaults?.ToolSearch?.Rerank?.FeatureWeights,
        },
      },
    },
    VectorModels: {
      Embedding: {
        ...AgentDefaults.VectorModels.Embedding,
        ...defaults?.VectorModels?.Embedding,
        TimeoutMs: secondsToMilliseconds(
          defaults?.VectorModels?.Embedding?.TimeoutSeconds ?? AgentDefaults.VectorModels.Embedding.TimeoutSeconds,
        ),
      },
      Rerank: {
        ...AgentDefaults.VectorModels.Rerank,
        ...defaults?.VectorModels?.Rerank,
        TimeoutMs: secondsToMilliseconds(
          defaults?.VectorModels?.Rerank?.TimeoutSeconds ?? AgentDefaults.VectorModels.Rerank.TimeoutSeconds,
        ),
      },
    },
    ToolLearning: {
      ...AgentDefaults.ToolLearning,
      ...defaults?.ToolLearning,
      Patterns: {
        ...AgentDefaults.ToolLearning.Patterns,
        ...defaults?.ToolLearning?.Patterns,
      },
      Client: {
        ...AgentDefaults.ToolLearning.Client,
        ...defaults?.ToolLearning?.Client,
      },
    },
    MemoryLearning: {
      Promotion: {
        ...AgentDefaults.MemoryLearning.Promotion,
        ...defaults?.MemoryLearning?.Promotion,
      },
    },
    Presets: {
      ...AgentDefaults.Presets,
      ...defaults?.Presets,
    },
    ActionPlanner: {
      ...AgentDefaults.ActionPlanner,
      ...defaults?.ActionPlanner,
      Evidence: {
        ...AgentDefaults.ActionPlanner.Evidence,
        ...defaults?.ActionPlanner?.Evidence,
      },
      Client: {
        ...AgentDefaults.ActionPlanner.Client,
        ...defaults?.ActionPlanner?.Client,
      },
      PlanningClient: {
        ...AgentDefaults.ActionPlanner.PlanningClient,
        ...defaults?.ActionPlanner?.PlanningClient,
      },
      FinalAnswerClient: {
        ...AgentDefaults.ActionPlanner.FinalAnswerClient,
        ...defaults?.ActionPlanner?.FinalAnswerClient,
      },
    },
    Artifacts: {
      ...AgentDefaults.Artifacts,
      ...defaults?.Artifacts,
    },
    Uploads: {
      ...AgentDefaults.Uploads,
      ...defaults?.Uploads,
    },
    Frontend: {
      DevServer: {
        ...AgentDefaults.Frontend.DevServer,
        ...defaults?.Frontend?.DevServer,
      },
      PreviewServer: {
        ...AgentDefaults.Frontend.PreviewServer,
        ...defaults?.Frontend?.PreviewServer,
      },
      Client: {
        ...AgentDefaults.Frontend.Client,
        ...defaults?.Frontend?.Client,
      },
    },
    Server: {
      ...AgentDefaults.Server,
      ...defaults?.Server,
      AccessControl: {
        ...AgentDefaults.Server.AccessControl,
        ...defaults?.Server?.AccessControl,
        AllowedOrigins: [
          ...(defaults?.Server?.AccessControl?.AllowedOrigins ?? AgentDefaults.Server.AccessControl.AllowedOrigins),
        ],
        TrustedProxyAddresses: [
          ...(defaults?.Server?.AccessControl?.TrustedProxyAddresses ??
            AgentDefaults.Server.AccessControl.TrustedProxyAddresses),
        ],
        Session: {
          ...AgentDefaults.Server.AccessControl.Session,
          ...defaults?.Server?.AccessControl?.Session,
        },
        Limits: {
          ...AgentDefaults.Server.AccessControl.Limits,
          ...defaults?.Server?.AccessControl?.Limits,
        },
      },
    },
    Persistence: {
      ...AgentDefaults.Persistence,
      ...defaults?.Persistence,
    },
    ConfigStore: {
      ...AgentDefaults.ConfigStore,
      ...defaults?.ConfigStore,
    },
  };
}

function resolveExecutionResourceDefaults(
  configured: NonNullable<NonNullable<AgentSystemConfig["Defaults"]>["ToolExecution"]>["Resources"],
) {
  const resources = {
    ...AgentDefaults.ToolExecution.Resources,
    ...configured,
  };
  return {
    ...resources,
    MaxWaitMs: secondsToMilliseconds(resources.MaxWaitSeconds),
    IdleTtlMs: secondsToMilliseconds(resources.IdleTtlSeconds),
    TerminalTtlMs: secondsToMilliseconds(resources.TerminalTtlSeconds),
    SweepIntervalMs: secondsToMilliseconds(resources.SweepIntervalSeconds),
    TerminationGraceMs: secondsToMilliseconds(resources.TerminationGraceSeconds),
  };
}

function defaultModelRuntimeMilliseconds(runtime: typeof AgentDefaults.ModelRuntime): {
  TimeoutMs: number;
  FirstTokenTimeoutMs: number;
  MaxRequestMs: number;
  RetryBaseDelayMs: number;
  RetryMaxDelayMs: number;
  RetryAfterMaxDelayMs: number;
} {
  return {
    TimeoutMs: secondsToMilliseconds(runtime.TimeoutSeconds),
    FirstTokenTimeoutMs: disabledOrSecondsToMilliseconds(runtime.FirstTokenTimeoutSeconds),
    MaxRequestMs: disabledOrSecondsToMilliseconds(runtime.MaxRequestSeconds),
    RetryBaseDelayMs: secondsToMilliseconds(runtime.RetryBaseDelaySeconds),
    RetryMaxDelayMs: secondsToMilliseconds(runtime.RetryMaxDelaySeconds),
    RetryAfterMaxDelayMs: secondsToMilliseconds(runtime.RetryAfterMaxDelaySeconds),
  };
}
