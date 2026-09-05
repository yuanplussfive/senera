import type {
  AgentInferenceBudgetConfig,
  AgentSystemConfig,
  ResolvedAgentInferenceBudgetConfig,
} from "../Types/AgentConfigTypes.js";
import { AgentDefaults } from "./AgentDefaultValues.js";
import type { ResolvedAgentDefaultsConfig } from "./AgentDefaultValues.js";
import { disabledOrSecondsToMilliseconds, secondsToMilliseconds } from "./AgentTimeDefaults.js";
import { mergeAgentContinuityRecallRanking } from "../Continuity/AgentContinuityRecallPolicy.js";

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
      Ranking: {
        ...AgentDefaults.ToolSearch.Ranking,
        ...defaults?.ToolSearch?.Ranking,
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
      LearningGate: {
        ...AgentDefaults.ContinuityLearning.LearningGate,
        ...defaults?.ContinuityLearning?.LearningGate,
      },
      LearningContext: {
        ...AgentDefaults.ContinuityLearning.LearningContext,
        ...defaults?.ContinuityLearning?.LearningContext,
      },
      TemporalMemory: {
        ...AgentDefaults.ContinuityLearning.TemporalMemory,
        ...defaults?.ContinuityLearning?.TemporalMemory,
      },
      Recall: {
        ...AgentDefaults.ContinuityLearning.Recall,
        TurnValueClassifier: {
          ...AgentDefaults.ContinuityLearning.Recall.TurnValueClassifier,
          ...defaults?.ContinuityLearning?.Recall?.TurnValueClassifier,
        },
        Prefetch: {
          ...AgentDefaults.ContinuityLearning.Recall.Prefetch,
          ...defaults?.ContinuityLearning?.Recall?.Prefetch,
        },
        PromptBudget: {
          ...AgentDefaults.ContinuityLearning.Recall.PromptBudget,
          ...defaults?.ContinuityLearning?.Recall?.PromptBudget,
        },
        Ranking: mergeAgentContinuityRecallRanking(
          AgentDefaults.ContinuityLearning.Recall.Ranking,
          defaults?.ContinuityLearning?.Recall?.Ranking,
        ),
        Semantic: {
          ...AgentDefaults.ContinuityLearning.Recall.Semantic,
          ...defaults?.ContinuityLearning?.Recall?.Semantic,
        },
      },
    },
    Presets: {
      ...AgentDefaults.Presets,
      ...defaults?.Presets,
      PromptBudget: {
        ...AgentDefaults.Presets.PromptBudget,
        ...defaults?.Presets?.PromptBudget,
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
    },
    ConfigStore: {
      ...AgentDefaults.ConfigStore,
      ...defaults?.ConfigStore,
    },
    Prompt: {
      ...AgentDefaults.Prompt,
      ...defaults?.Prompt,
    },
    World: {
      ...AgentDefaults.World,
      ...defaults?.World,
      DayPhases: [...(defaults?.World?.DayPhases ?? AgentDefaults.World.DayPhases)],
      GoalMicroLoop: {
        ...AgentDefaults.World.GoalMicroLoop,
        ...defaults?.World?.GoalMicroLoop,
        Enabled: defaults?.World?.GoalMicroLoop?.Enabled ?? AgentDefaults.World.GoalMicroLoop.Enabled,
        MaxCandidates: defaults?.World?.GoalMicroLoop?.MaxCandidates ?? AgentDefaults.World.GoalMicroLoop.MaxCandidates,
        ReviewDelaySeconds:
          defaults?.World?.GoalMicroLoop?.ReviewDelaySeconds ?? AgentDefaults.World.GoalMicroLoop.ReviewDelaySeconds,
        AllowedToolNames: [
          ...(defaults?.World?.GoalMicroLoop?.AllowedToolNames ?? AgentDefaults.World.GoalMicroLoop.AllowedToolNames),
        ],
      },
      ResidentIdle: {
        ...AgentDefaults.World.ResidentIdle,
        ...defaults?.World?.ResidentIdle,
        Enabled: defaults?.World?.ResidentIdle?.Enabled ?? AgentDefaults.World.ResidentIdle.Enabled,
        MinIntervalSeconds:
          defaults?.World?.ResidentIdle?.MinIntervalSeconds ?? AgentDefaults.World.ResidentIdle.MinIntervalSeconds,
        MaxIntervalSeconds:
          defaults?.World?.ResidentIdle?.MaxIntervalSeconds ?? AgentDefaults.World.ResidentIdle.MaxIntervalSeconds,
        BackoffMultiplier:
          defaults?.World?.ResidentIdle?.BackoffMultiplier ?? AgentDefaults.World.ResidentIdle.BackoffMultiplier,
        MaxPending: defaults?.World?.ResidentIdle?.MaxPending ?? AgentDefaults.World.ResidentIdle.MaxPending,
      },
      ActionBudget: {
        ...AgentDefaults.World.ActionBudget,
        ...defaults?.World?.ActionBudget,
        MaxActionsPerWake:
          defaults?.World?.ActionBudget?.MaxActionsPerWake ?? AgentDefaults.World.ActionBudget.MaxActionsPerWake,
        MaxDecisionCandidatesPerWake:
          defaults?.World?.ActionBudget?.MaxDecisionCandidatesPerWake ??
          AgentDefaults.World.ActionBudget.MaxDecisionCandidatesPerWake,
        RetryDelaySeconds:
          defaults?.World?.ActionBudget?.RetryDelaySeconds ?? AgentDefaults.World.ActionBudget.RetryDelaySeconds,
        LeaseDurationSeconds:
          defaults?.World?.ActionBudget?.LeaseDurationSeconds ?? AgentDefaults.World.ActionBudget.LeaseDurationSeconds,
        FairShare: defaults?.World?.ActionBudget?.FairShare ?? AgentDefaults.World.ActionBudget.FairShare,
        SourceOrder: [...(defaults?.World?.ActionBudget?.SourceOrder ?? AgentDefaults.World.ActionBudget.SourceOrder)],
        SourceCaps: {
          ...AgentDefaults.World.ActionBudget.SourceCaps,
          ...(defaults?.World?.ActionBudget?.SourceCaps ?? {}),
        },
      },
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
