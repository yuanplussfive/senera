import type {
  AgentSystemConfig,
  ResolvedAgentToolExecutionConfig,
} from "../Types/AgentConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { optionalSecondsToMilliseconds } from "./AgentTimeDefaults.js";

export function resolveAgentLoopConfig(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.AgentLoop,
    ...config.AgentLoop,
  };
}

export function resolveToolExecutionConfig(
  config: AgentSystemConfig,
): ResolvedAgentToolExecutionConfig {
  const defaults = resolveAgentDefaults(config);
  const {
    TimeoutSeconds,
    ...configuredToolExecution
  } = config.ToolExecution ?? {};
  return {
    ...defaults.ToolExecution,
    ...configuredToolExecution,
    TimeoutMs: optionalSecondsToMilliseconds(TimeoutSeconds)
      ?? defaults.ToolExecution.TimeoutMs,
  };
}
