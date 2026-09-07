import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

export function shouldSendMaxOutputTokens(config: ResolvedAgentModelProviderConfig): boolean {
  return config.MaxOutputTokens !== -1;
}
