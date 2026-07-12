import type {
  AgentSystemConfig,
  ResolvedAgentSandboxRuntimeConfig,
  ResolvedAgentToolExecutionConfig,
} from "../Types/AgentConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { optionalSecondsToMilliseconds } from "./AgentTimeDefaults.js";

export function resolveAgentLoopConfig(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  const { PiSessionCreateTimeoutSeconds, PiSessions, ...configuredAgentLoop } = config.AgentLoop ?? {};
  return {
    ...defaults.AgentLoop,
    ...configuredAgentLoop,
    PiSessions: {
      ...defaults.AgentLoop.PiSessions,
      ...PiSessions,
    },
    PiSessionCreateTimeoutMs:
      optionalSecondsToMilliseconds(PiSessionCreateTimeoutSeconds) ?? defaults.AgentLoop.PiSessionCreateTimeoutMs,
  };
}

export function resolveToolExecutionConfig(config: AgentSystemConfig): ResolvedAgentToolExecutionConfig {
  const defaults = resolveAgentDefaults(config);
  const { TimeoutSeconds, ...configuredToolExecution } = config.ToolExecution ?? {};
  return {
    ...defaults.ToolExecution,
    ...configuredToolExecution,
    TimeoutMs: optionalSecondsToMilliseconds(TimeoutSeconds) ?? defaults.ToolExecution.TimeoutMs,
  };
}

export function resolveSandboxRuntimeConfig(config: AgentSystemConfig): ResolvedAgentSandboxRuntimeConfig {
  const defaults = resolveAgentDefaults(config);
  const configured = config.SandboxRuntime ?? {};
  return {
    ...defaults.SandboxRuntime,
    ...configured,
    Images: [...new Set([...defaults.SandboxRuntime.Images, ...(configured.Images ?? [])])],
  };
}
