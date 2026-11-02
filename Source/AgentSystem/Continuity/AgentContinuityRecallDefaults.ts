import type {
  AgentContinuityPromptBudgetConfig,
  AgentContinuityLearningRecallConfig,
} from "../Types/AgentToolAndMemoryConfigTypes.js";

export const AgentContinuityPromptBudgetDefaults = {
  MaxTokens: 16_384,
} satisfies AgentContinuityPromptBudgetConfig;

export const AgentContinuityRecallBudgetDefaults = { FrozenBudgetRatio: 0.25, TaskBudgetRatio: 0.5 } as const;

export function resolveAgentContinuityRecallBudgetRatios(
  policy: Pick<AgentContinuityLearningRecallConfig, "FrozenBudgetRatio" | "TaskBudgetRatio">,
) {
  const ratios = {
    FrozenBudgetRatio: policy.FrozenBudgetRatio ?? AgentContinuityRecallBudgetDefaults.FrozenBudgetRatio,
    TaskBudgetRatio: policy.TaskBudgetRatio ?? AgentContinuityRecallBudgetDefaults.TaskBudgetRatio,
  };
  if (
    Object.values(ratios).some((value) => !Number.isFinite(value) || value <= 0 || value > 1) ||
    ratios.FrozenBudgetRatio + ratios.TaskBudgetRatio > 1
  )
    throw new Error("Memory budget ratios must be positive and sum to at most one.");
  return ratios;
}
