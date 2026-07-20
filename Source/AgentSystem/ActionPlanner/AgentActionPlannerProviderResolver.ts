import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";

export function resolvePlannerProvider(
  model: ResolvedAgentModelProviderConfig,
  overrides: ResolvedAgentActionPlannerClientConfig,
): ResolvedAgentModelProviderConfig {
  const selectedProvider = overrides.ModelProvider;
  return {
    ...selectedProvider,
    BaseUrl: overrides.BaseUrl,
    ApiKey: overrides.ApiKey,
    Model: overrides.Model,
    Temperature: overrides.Temperature ?? 0.1,
    MaxOutputTokens: overrides.MaxTokens ?? -1,
    Stream: false,
  };
}
