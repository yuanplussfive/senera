import type {
  AgentSystemConfig,
  ResolvedAgentPromptConfig,
  ResolvedAgentSandboxRuntimeConfig,
  ResolvedAgentTodosConfig,
  ResolvedAgentToolExecutionConfig,
} from "../Types/AgentConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { optionalSecondsToMilliseconds } from "./AgentTimeDefaults.js";
import { validateAgentWorldDayPhases } from "../World/AgentWorldTime.js";
import type {
  ResolvedAgentWorldActionBudgetConfig,
  ResolvedAgentWorldConfig,
  ResolvedAgentWorldGoalMicroLoopConfig,
  ResolvedAgentWorldResidentIdleConfig,
} from "../Types/AgentRuntimeConfigTypes.js";

export function resolveAgentLoopConfig(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  const { PiTurnLeaseTimeoutSeconds, RunSettlementTimeoutSeconds, PiSessions, ...configuredAgentLoop } =
    config.AgentLoop ?? {};
  const resolvedCompaction = {
    ...defaults.AgentLoop.PiSessions.Compaction,
    ...PiSessions?.Compaction,
  };
  return {
    ...defaults.AgentLoop,
    ...configuredAgentLoop,
    PiSessions: {
      ...defaults.AgentLoop.PiSessions,
      ...PiSessions,
      Compaction: {
        ...resolvedCompaction,
      },
    },
    PiTurnLeaseTimeoutMs:
      optionalSecondsToMilliseconds(PiTurnLeaseTimeoutSeconds) ?? defaults.AgentLoop.PiTurnLeaseTimeoutMs,
    RunSettlementTimeoutMs:
      optionalSecondsToMilliseconds(RunSettlementTimeoutSeconds) ?? defaults.AgentLoop.RunSettlementTimeoutMs,
  };
}

export function resolveAgentTodosConfig(config: AgentSystemConfig): ResolvedAgentTodosConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Todos,
    ...config.Todos,
  };
}

export function resolveAgentPromptConfig(config: AgentSystemConfig): ResolvedAgentPromptConfig {
  const defaults = resolveAgentDefaults(config);
  const configured = config.Prompt;
  const timeZone = configured?.TimeZone?.trim() ?? defaults.Prompt.TimeZone;
  return {
    UserMessageEnvelope: configured?.UserMessageEnvelope ?? defaults.Prompt.UserMessageEnvelope,
    TimeZone: timeZone || "Asia/Shanghai",
    PrefaceRewrite: configured?.PrefaceRewrite ?? defaults.Prompt.PrefaceRewrite,
    RoleCheck: configured?.RoleCheck ?? defaults.Prompt.RoleCheck,
    BamlToolAttribution: configured?.BamlToolAttribution ?? defaults.Prompt.BamlToolAttribution,
  };
}

export function resolveAgentWorldConfig(config: AgentSystemConfig): ResolvedAgentWorldConfig & {
  readonly GoalMicroLoop: ResolvedAgentWorldGoalMicroLoopConfig;
  readonly ResidentIdle: ResolvedAgentWorldResidentIdleConfig;
  readonly ActionBudget: ResolvedAgentWorldActionBudgetConfig;
} {
  const defaults = resolveAgentDefaults(config);
  const goalMicroLoopDefaults = defaults.World.GoalMicroLoop!;
  const residentIdleDefaults = defaults.World.ResidentIdle!;
  const actionBudgetDefaults = defaults.World.ActionBudget!;
  const configured = config.World;
  const dayPhases = (configured?.DayPhases ?? defaults.World.DayPhases).map((phase) => ({ ...phase }));
  validateAgentWorldDayPhases(
    dayPhases.map((phase) => ({
      id: phase.Id,
      label: phase.Label,
      startsAt: phase.StartsAt,
      endsAt: phase.EndsAt,
    })),
  );
  const name = configured?.Name?.trim() ?? defaults.World.Name;
  if (!name) throw new Error("World name must not be empty.");
  const timeZone = configured?.TimeZone?.trim() ?? defaults.World.TimeZone;
  if (!timeZone) throw new Error("World time zone must not be empty.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch (error) {
    throw new Error(`Unsupported world time zone: ${timeZone}`, { cause: error });
  }
  return {
    Name: name,
    TimeZone: timeZone,
    DayPhases: dayPhases,
    RecordLimit: configured?.RecordLimit ?? defaults.World.RecordLimit,
    TimelineLimit: configured?.TimelineLimit ?? defaults.World.TimelineLimit,
    HabitCatchUpLimit: configured?.HabitCatchUpLimit ?? defaults.World.HabitCatchUpLimit,
    GoalMicroLoop: {
      Enabled: configured?.GoalMicroLoop?.Enabled ?? goalMicroLoopDefaults.Enabled,
      MaxCandidates: configured?.GoalMicroLoop?.MaxCandidates ?? goalMicroLoopDefaults.MaxCandidates,
      ReviewDelaySeconds: configured?.GoalMicroLoop?.ReviewDelaySeconds ?? goalMicroLoopDefaults.ReviewDelaySeconds,
      AllowedToolNames: [...(configured?.GoalMicroLoop?.AllowedToolNames ?? goalMicroLoopDefaults.AllowedToolNames)],
    },
    ResidentIdle: {
      Enabled: configured?.ResidentIdle?.Enabled ?? residentIdleDefaults.Enabled,
      MinIntervalSeconds: configured?.ResidentIdle?.MinIntervalSeconds ?? residentIdleDefaults.MinIntervalSeconds,
      MaxIntervalSeconds: configured?.ResidentIdle?.MaxIntervalSeconds ?? residentIdleDefaults.MaxIntervalSeconds,
      BackoffMultiplier: configured?.ResidentIdle?.BackoffMultiplier ?? residentIdleDefaults.BackoffMultiplier,
      MaxPending: configured?.ResidentIdle?.MaxPending ?? residentIdleDefaults.MaxPending,
    },
    ActionBudget: {
      MaxActionsPerWake: configured?.ActionBudget?.MaxActionsPerWake ?? actionBudgetDefaults.MaxActionsPerWake,
      MaxDecisionCandidatesPerWake:
        configured?.ActionBudget?.MaxDecisionCandidatesPerWake ?? actionBudgetDefaults.MaxDecisionCandidatesPerWake,
      RetryDelaySeconds: configured?.ActionBudget?.RetryDelaySeconds ?? actionBudgetDefaults.RetryDelaySeconds,
      LeaseDurationSeconds: configured?.ActionBudget?.LeaseDurationSeconds ?? actionBudgetDefaults.LeaseDurationSeconds,
      FairShare: configured?.ActionBudget?.FairShare ?? actionBudgetDefaults.FairShare,
      SourceOrder: [...(configured?.ActionBudget?.SourceOrder ?? actionBudgetDefaults.SourceOrder)],
      SourceCaps: {
        ...actionBudgetDefaults.SourceCaps,
        ...(configured?.ActionBudget?.SourceCaps ?? {}),
      },
    },
  };
}

export function resolveToolExecutionConfig(config: AgentSystemConfig): ResolvedAgentToolExecutionConfig {
  const defaults = resolveAgentDefaults(config);
  const { TimeoutSeconds, SemanticAudit, Environment, Resources, ...configuredToolExecution } =
    config.ToolExecution ?? {};
  const resolvedResources = {
    ...defaults.ToolExecution.Resources,
    ...Resources,
  };
  return {
    ...defaults.ToolExecution,
    ...configuredToolExecution,
    TimeoutMs: optionalSecondsToMilliseconds(TimeoutSeconds) ?? defaults.ToolExecution.TimeoutMs,
    SemanticAudit: {
      ...defaults.ToolExecution.SemanticAudit,
      ...SemanticAudit,
    },
    Environment: {
      ...defaults.ToolExecution.Environment,
      ...Environment,
      IncludeOnly: [...(Environment?.IncludeOnly ?? defaults.ToolExecution.Environment.IncludeOnly)],
      Exclude: [...(Environment?.Exclude ?? defaults.ToolExecution.Environment.Exclude)],
      Set: {
        ...defaults.ToolExecution.Environment.Set,
        ...(Environment?.Set ?? {}),
      },
    },
    Resources: {
      ...resolvedResources,
      InitialYieldMs: optionalSecondsToMilliseconds(Resources?.InitialYieldSeconds) ?? resolvedResources.InitialYieldMs,
      MaxWaitMs: optionalSecondsToMilliseconds(Resources?.MaxWaitSeconds) ?? resolvedResources.MaxWaitMs,
      IdleTtlMs: optionalSecondsToMilliseconds(Resources?.IdleTtlSeconds) ?? resolvedResources.IdleTtlMs,
      TerminalTtlMs: optionalSecondsToMilliseconds(Resources?.TerminalTtlSeconds) ?? resolvedResources.TerminalTtlMs,
      SweepIntervalMs:
        optionalSecondsToMilliseconds(Resources?.SweepIntervalSeconds) ?? resolvedResources.SweepIntervalMs,
      TerminationGraceMs:
        optionalSecondsToMilliseconds(Resources?.TerminationGraceSeconds) ?? resolvedResources.TerminationGraceMs,
    },
  };
}

export function resolveSandboxRuntimeConfig(config: AgentSystemConfig): ResolvedAgentSandboxRuntimeConfig {
  const defaults = resolveAgentDefaults(config);
  const configured = config.SandboxRuntime ?? {};
  return {
    ...defaults.SandboxRuntime,
    ...configured,
    Docker: {
      ...defaults.SandboxRuntime.Docker,
      ...configured.Docker,
    },
  };
}
