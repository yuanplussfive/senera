import {
  AgentSlidingWindowInferenceBudget,
  type AgentInferenceBudgetPort,
} from "../Source/AgentSystem/ModelEndpoints/AgentInferenceBudget.js";
import { createOpaqueId } from "../Source/AgentSystem/Core/AgentIds.js";
import { resolveAgentInferenceBudgetConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { secondsToMilliseconds } from "../Source/AgentSystem/Defaults/AgentTimeDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

export function createSeneraServerInferenceBudget(configSnapshot: () => AgentSystemConfig): AgentInferenceBudgetPort {
  const applicationScope = createOpaqueId("application-inference");
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
    reserve: (input) => budget.reserve({ ...input, scope: applicationScope }),
    settle: (input) => budget.settle(input),
    acquire: (input) => budget.acquire({ ...input, scope: applicationScope }),
  };
}
