import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";

export function resolvePlannerProvider(
  model: ResolvedAgentModelProviderConfig,
  overrides: ResolvedAgentActionPlannerClientConfig,
): ResolvedAgentModelProviderConfig {
  return {
    ...model,
    Endpoint: resolvePlannerEndpoint(overrides.Provider),
    BaseUrl: overrides.BaseUrl,
    ApiKey: overrides.ApiKey,
    Model: overrides.Model,
    Temperature: overrides.Temperature ?? 0.1,
    MaxOutputTokens: overrides.MaxTokens ?? -1,
    Stream: false,
  };
}

function resolvePlannerEndpoint(
  provider: ResolvedAgentActionPlannerClientConfig["Provider"],
): ResolvedAgentModelProviderConfig["Endpoint"] {
  return ProviderEndpointMap[provider];
}

const ProviderEndpointMap = {
  "openai-generic": "ChatCompletions",
  "openai-responses": "Responses",
  anthropic: "ClaudeMessages",
  "google-ai": "GoogleGenerateContent",
} as const satisfies Record<
  ResolvedAgentActionPlannerClientConfig["Provider"],
  ResolvedAgentModelProviderConfig["Endpoint"]
>;

