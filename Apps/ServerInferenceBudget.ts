import { AgentSlidingWindowInferenceBudget } from "../Source/AgentSystem/ModelEndpoints/AgentInferenceBudget.js";
import { resolveAgentInferenceBudgetConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { secondsToMilliseconds } from "../Source/AgentSystem/Defaults/AgentTimeDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

export interface SeneraServerInferenceBudget {
  readonly budget: AgentSlidingWindowInferenceBudget;
  readonly scope: () => string;
  bindScope(scope: () => string): void;
}

export function createSeneraServerInferenceBudget(
  configSnapshot: () => AgentSystemConfig,
): SeneraServerInferenceBudget {
  let scope: (() => string) | undefined;
  const budget = new AgentSlidingWindowInferenceBudget(() => {
    const policy = resolveAgentInferenceBudgetConfig(configSnapshot());
    return {
      enabled: policy.Enabled,
      windowMs: secondsToMilliseconds(policy.WindowSeconds),
      maxRequests: policy.MaxRequests,
      maxEstimatedInputTokens: policy.MaxEstimatedInputTokens,
      maxEstimatedOutputTokens: policy.MaxEstimatedOutputTokens,
      maxConcurrent: policy.MaxConcurrent,
      foregroundReserveFraction: policy.ForegroundReserveFraction,
      laneWeights: policy.LaneWeights,
    };
  });
  return {
    budget,
    scope: () => {
      if (!scope) throw new Error("Vector inference budget scope is not initialized.");
      return scope();
    },
    bindScope(nextScope) {
      scope = nextScope;
    },
  };
}
