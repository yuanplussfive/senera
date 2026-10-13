import type { AgentContinuityPromptBudgetConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";

export const AgentContinuityPromptBudgetDefaults = {
  MaxTokens: 16_384,
} satisfies AgentContinuityPromptBudgetConfig;
