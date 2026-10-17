import type {
  AgentInferenceBudgetConfig,
  AgentSystemConfig,
  ResolvedAgentInferenceBudgetConfig,
} from "../Types/AgentConfigTypes.js";
import { AgentDefaults } from "./AgentDefaultValues.js";
import type { ResolvedAgentDefaultsConfig } from "./AgentDefaultValues.js";
import { disabledOrSecondsToMilliseconds, secondsToMilliseconds } from "./AgentTimeDefaults.js";

export function resolveAgentDefaults(
  config: Pick<AgentSystemConfig, "Defaults"> | undefined,
): ResolvedAgentDefaultsConfig {
  const defaults = config?.Defaults;

  return {
    ModelProviderEndpoints: AgentDefaults.ModelProviderEndpoints.map((endpoint) => ({ ...endpoint })),
    ModelRuntime: {
      ...AgentDefaults.ModelRuntime,
      ...defaultModelRuntimeMilliseconds(AgentDefaults.ModelRuntime),
    },
    InferenceBudget: resolveAgentInferenceBudget(defaults?.InferenceBudget, AgentDefaults.InferenceBudget),
    ToolExecution: {
      TimeoutMs: secondsToMilliseconds(
        defaults?.ToolExecution?.TimeoutSeconds ?? AgentDefaults.ToolExecution.TimeoutSeconds,
      ),
      MaxConcurrentCallsPerRun:
        defaults?.ToolExecution?.MaxConcurrentCallsPerRun ?? AgentDefaults.ToolExecution.MaxConcurrentCallsPerRun,
      MaxStdoutBytes: defaults?.ToolExecution?.MaxStdoutBytes ?? AgentDefaults.ToolExecution.MaxStdoutBytes,
      MaxStderrBytes: defaults?.ToolExecution?.MaxStderrBytes ?? AgentDefaults.ToolExecution.MaxStderrBytes,
      SemanticAudit: {
        ...AgentDefaults.ToolExecution.SemanticAudit,
        ...defaults?.ToolExecution?.SemanticAudit,
      },
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
      Docker: {
        ...AgentDefaults.SandboxRuntime.Docker,
        ...defaults?.SandboxRuntime?.Docker,
      },
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
      Fuzzy: {
        ...AgentDefaults.ToolSearch.Fuzzy,
        ...defaults?.ToolSearch?.Fuzzy,
      },
      Embedding: {
        ...AgentDefaults.ToolSearch.Embedding,
        ...defaults?.ToolSearch?.Embedding,
      },
      Memory: {
        ...AgentDefaults.ToolSearch.Memory,
        ...defaults?.ToolSearch?.Memory,
      },
      Tokenize: {
        ...AgentDefaults.ToolSearch.Tokenize,
        ...defaults?.ToolSearch?.Tokenize,
      },
      Ranking: {
        ...AgentDefaults.ToolSearch.Ranking,
        ...defaults?.ToolSearch?.Ranking,
        ChannelWeights: {
          ...AgentDefaults.ToolSearch.Ranking.ChannelWeights,
          ...defaults?.ToolSearch?.Ranking?.ChannelWeights,
        },
      },
      Disclosure: {
        ...AgentDefaults.ToolSearch.Disclosure,
        ...defaults?.ToolSearch?.Disclosure,
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
    StateCard: {
      ...AgentDefaults.StateCard,
      ...defaults?.StateCard,
      Client: {
        ...AgentDefaults.StateCard.Client,
        ...defaults?.StateCard?.Client,
      },
    },
    Todos: {
      ...AgentDefaults.Todos,
      ...defaults?.Todos,
    },
    ContinuityLearning: {
      Enabled: defaults?.ContinuityLearning?.Enabled ?? AgentDefaults.ContinuityLearning.Enabled,
      Client: {
        ...AgentDefaults.ContinuityLearning.Client,
        ...defaults?.ContinuityLearning?.Client,
      },
      Runtime: {
        ...AgentDefaults.ContinuityLearning.Runtime,
        ...defaults?.ContinuityLearning?.Runtime,
      },
      MemOS: {
        ...AgentDefaults.ContinuityLearning.MemOS,
        ...defaults?.ContinuityLearning?.MemOS,
      },
      Recall: {
        ...AgentDefaults.ContinuityLearning.Recall,
        PromptBudget: {
          ...AgentDefaults.ContinuityLearning.Recall.PromptBudget,
          ...defaults?.ContinuityLearning?.Recall?.PromptBudget,
        },
      },
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
      EventWriter: {
        ...AgentDefaults.Persistence.EventWriter,
        ...defaults?.Persistence?.EventWriter,
      },
      Logs: {
        ...AgentDefaults.Persistence.Logs,
        ...defaults?.Persistence?.Logs,
      },
    },
    ConfigStore: {
      ...AgentDefaults.ConfigStore,
      ...defaults?.ConfigStore,
    },
    Prompt: {
      ...AgentDefaults.Prompt,
      ...defaults?.Prompt,
    },
  };
}

export function resolveAgentInferenceBudgetConfig(config: AgentSystemConfig): ResolvedAgentInferenceBudgetConfig {
  return resolveAgentInferenceBudget(config.InferenceBudget, resolveAgentDefaults(config).InferenceBudget);
}

function resolveAgentInferenceBudget(
  configured: AgentInferenceBudgetConfig | undefined,
  base: ResolvedAgentInferenceBudgetConfig | typeof AgentDefaults.InferenceBudget,
): ResolvedAgentInferenceBudgetConfig {
  const defaults = base;
  const laneWeights = {
    ...defaults.LaneWeights,
    ...(configured?.LaneWeights ?? {}),
  };
  for (const [lane, weight] of Object.entries(laneWeights)) {
    if (!lane.trim() || !Number.isFinite(weight) || weight <= 0) {
      throw new RangeError(`Inference budget lane weight must be positive: ${lane}`);
    }
  }
  const resolved = {
    Enabled: configured?.Enabled ?? defaults.Enabled,
    WindowSeconds: configured?.WindowSeconds ?? defaults.WindowSeconds,
    MaxRequests: configured?.MaxRequests ?? defaults.MaxRequests,
    MaxEstimatedInputTokens: configured?.MaxEstimatedInputTokens ?? defaults.MaxEstimatedInputTokens,
    MaxEstimatedOutputTokens: configured?.MaxEstimatedOutputTokens ?? defaults.MaxEstimatedOutputTokens,
    MaxConcurrent: configured?.MaxConcurrent ?? defaults.MaxConcurrent,
    ForegroundReserveFraction: configured?.ForegroundReserveFraction ?? defaults.ForegroundReserveFraction,
    LaneWeights: laneWeights,
  };
  if (!Number.isFinite(resolved.WindowSeconds) || resolved.WindowSeconds <= 0) {
    throw new RangeError("Inference budget WindowSeconds must be positive.");
  }
  for (const [field, value] of Object.entries(resolved)) {
    if (
      field !== "Enabled" &&
      field !== "ForegroundReserveFraction" &&
      field !== "LaneWeights" &&
      (!Number.isSafeInteger(value) || (value as number) < 1)
    ) {
      throw new RangeError(`Inference budget ${field} must be a positive safe integer.`);
    }
  }
  if (resolved.ForegroundReserveFraction < 0 || resolved.ForegroundReserveFraction > 1) {
    throw new RangeError("Inference budget ForegroundReserveFraction must be between 0 and 1.");
  }
  return resolved;
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
    InitialYieldMs: secondsToMilliseconds(resources.InitialYieldSeconds),
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
