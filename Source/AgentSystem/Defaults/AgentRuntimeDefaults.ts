import type {
  AgentSystemConfig,
  ResolvedAgentSandboxRuntimeConfig,
  ResolvedAgentToolExecutionConfig,
} from "../Types/AgentConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { optionalSecondsToMilliseconds } from "./AgentTimeDefaults.js";
import { normalizeSandboxImages } from "../Sandbox/AgentSandboxRuntimeImages.js";

export function resolveAgentLoopConfig(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  const { PiTurnLeaseTimeoutSeconds, RunSettlementTimeoutSeconds, PiSessions, ...configuredAgentLoop } =
    config.AgentLoop ?? {};
  const compaction = PiSessions?.Compaction;
  const resolvedCompaction = {
    ...defaults.AgentLoop.PiSessions.Compaction,
    ...compaction,
    TimeoutMs:
      optionalSecondsToMilliseconds(compaction?.TimeoutSeconds) ?? defaults.AgentLoop.PiSessions.Compaction.TimeoutMs,
  };
  if (
    resolvedCompaction.TargetRatio >= resolvedCompaction.TriggerRatio ||
    resolvedCompaction.TriggerRatio >= resolvedCompaction.HardLimitRatio
  ) {
    throw new Error("Pi 会话压缩比例必须满足 TargetRatio < TriggerRatio < HardLimitRatio。");
  }
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

export function resolveToolExecutionConfig(config: AgentSystemConfig): ResolvedAgentToolExecutionConfig {
  const defaults = resolveAgentDefaults(config);
  const { TimeoutSeconds, Environment, Resources, ...configuredToolExecution } = config.ToolExecution ?? {};
  const resolvedResources = {
    ...defaults.ToolExecution.Resources,
    ...Resources,
  };
  return {
    ...defaults.ToolExecution,
    ...configuredToolExecution,
    TimeoutMs: optionalSecondsToMilliseconds(TimeoutSeconds) ?? defaults.ToolExecution.TimeoutMs,
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
    Images: normalizeSandboxImages(defaults.SandboxRuntime.Images, configured.Images ?? []),
  };
}
