import { resolveToolExecutionConfig } from "../AgentDefaults.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentExecutionResourceLimits } from "./AgentExecutionResourceTypes.js";

export function resolveAgentExecutionResourceLimits(config: AgentSystemConfig): AgentExecutionResourceLimits {
  const resources = resolveToolExecutionConfig(config).Resources;
  return {
    maxActive: resources.MaxActive,
    maxBufferedBytes: resources.MaxBufferedBytes,
    maxInputBytes: resources.MaxInputBytes,
    maxWaitMs: resources.MaxWaitMs,
    idleTtlMs: resources.IdleTtlMs,
    terminalTtlMs: resources.TerminalTtlMs,
    sweepIntervalMs: resources.SweepIntervalMs,
    terminationGraceMs: resources.TerminationGraceMs,
  };
}

export function resolveAgentExecutionResourceWaitTimeoutMs(
  config: AgentSystemConfig,
  requestedTimeoutMs: number | undefined,
): number {
  const maximum = resolveAgentExecutionResourceLimits(config).maxWaitMs;
  return Math.min(requestedTimeoutMs ?? maximum, maximum);
}
