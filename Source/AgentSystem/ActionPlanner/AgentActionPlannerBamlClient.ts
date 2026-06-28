import { ClientRegistry } from "@boundaryml/baml";
import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";

export const AgentActionPlannerBamlClientName = "SeneraRuntimeActionPlanner";

export interface AgentActionPlannerBamlClient {
  registry: ClientRegistry;
  provider: string;
  options: Record<string, unknown>;
}

export function createActionPlannerBamlClient(
  model: ResolvedAgentModelProviderConfig,
  overrides: ResolvedAgentActionPlannerClientConfig,
): AgentActionPlannerBamlClient {
  const provider = resolveBamlProvider(model, overrides.Provider);
  const options = buildProviderOptions(provider, model, overrides);
  const registry = new ClientRegistry();
  registry.addLlmClient(AgentActionPlannerBamlClientName, provider, options);
  registry.setPrimary(AgentActionPlannerBamlClientName);

  return {
    registry,
    provider,
    options,
  };
}

type BamlProvider =
  | "openai-generic"
  | "openai-responses"
  | "anthropic"
  | "google-ai";

function resolveBamlProvider(
  model: ResolvedAgentModelProviderConfig,
  _provider: ResolvedAgentActionPlannerClientConfig["Provider"],
): BamlProvider {
  return BamlProviderByEndpoint[model.Endpoint];
}

const BamlProviderByEndpoint = {
  ChatCompletions: "openai-generic",
  Responses: "openai-responses",
  ClaudeMessages: "anthropic",
  GoogleGenerateContent: "google-ai",
} as const satisfies Record<ResolvedAgentModelProviderConfig["Endpoint"], BamlProvider>;

function buildProviderOptions(
  provider: BamlProvider,
  model: ResolvedAgentModelProviderConfig,
  overrides: ResolvedAgentActionPlannerClientConfig,
): Record<string, unknown> {
  const base = {
    base_url: normalizeBaseUrl(provider, overrides.BaseUrl),
    api_key: overrides.ApiKey,
    model: overrides.Model,
  };

  return ProviderOptions[provider](base, {
    temperature: overrides.Temperature ?? 0.1,
    maxTokens: overrides.MaxTokens ?? -1,
  });
}

const ProviderOptions = {
  "openai-generic": (
    base: Record<string, unknown>,
    options: { temperature: number; maxTokens: number },
  ) => ({
    ...base,
    temperature: options.temperature,
    ...tokenLimit("max_tokens", options.maxTokens),
  }),
  "openai-responses": (
    base: Record<string, unknown>,
    options: { temperature: number; maxTokens: number },
  ) => ({
    ...base,
    temperature: options.temperature,
    ...tokenLimit("max_output_tokens", options.maxTokens),
  }),
  anthropic: (
    base: Record<string, unknown>,
    options: { temperature: number; maxTokens: number },
  ) => ({
    ...base,
    temperature: options.temperature,
    ...tokenLimit("max_tokens", options.maxTokens),
  }),
  "google-ai": (
    base: Record<string, unknown>,
    options: { temperature: number; maxTokens: number },
  ) => ({
    ...base,
    generationConfig: {
      temperature: options.temperature,
      ...tokenLimit("maxOutputTokens", options.maxTokens),
    },
  }),
} as const satisfies Record<
  BamlProvider,
  (
    base: Record<string, unknown>,
    options: { temperature: number; maxTokens: number },
  ) => Record<string, unknown>
>;

function normalizeBaseUrl(provider: BamlProvider, value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return provider === "anthropic"
    ? trimmed.replace(/\/v1$/i, "")
    : trimmed;
}

function tokenLimit(key: string, value: number): Record<string, number> {
  return value === -1 ? {} : { [key]: value };
}
