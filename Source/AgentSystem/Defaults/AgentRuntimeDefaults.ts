import type {
  AgentSystemConfig,
  ResolvedAgentPromptConfig,
  ResolvedAgentSandboxRuntimeConfig,
  ResolvedAgentTodosConfig,
  ResolvedAgentToolExecutionConfig,
  ResolvedAgentMcpConnectionsConfig,
} from "../Types/AgentConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { optionalSecondsToMilliseconds } from "./AgentTimeDefaults.js";

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
    CorePersona: configured?.CorePersona?.trim() ?? defaults.Prompt.CorePersona,
    LanguageStyle: configured?.LanguageStyle?.trim() ?? defaults.Prompt.LanguageStyle,
    PrefaceRewrite: configured?.PrefaceRewrite ?? defaults.Prompt.PrefaceRewrite,
    FinalResponseRewrite: configured?.FinalResponseRewrite ?? defaults.Prompt.FinalResponseRewrite,
    BamlToolAttribution: configured?.BamlToolAttribution ?? defaults.Prompt.BamlToolAttribution,
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

export function resolveAgentMcpConnectionsConfig(config: AgentSystemConfig): ResolvedAgentMcpConnectionsConfig {
  const executionResources = resolveToolExecutionConfig(config).Resources;
  const configuredDefaults = config.Defaults?.McpConnections;
  const configured = config.McpConnections;
  const idleTtlMs =
    optionalNonNegativeSecondsToMilliseconds(configured?.IdleTtlSeconds) ??
    optionalNonNegativeSecondsToMilliseconds(configuredDefaults?.IdleTtlSeconds) ??
    executionResources.IdleTtlMs;
  const sweepIntervalMs =
    optionalSecondsToMilliseconds(configured?.SweepIntervalSeconds) ??
    optionalSecondsToMilliseconds(configuredDefaults?.SweepIntervalSeconds) ??
    executionResources.SweepIntervalMs;
  return { IdleTtlMs: idleTtlMs, SweepIntervalMs: sweepIntervalMs };
}

function optionalNonNegativeSecondsToMilliseconds(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) throw new RangeError("MCP connection idle TTL must be non-negative.");
  return Math.round(value * 1_000);
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
