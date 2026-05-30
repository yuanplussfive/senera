import { ClientRegistry } from "@boundaryml/baml";
import type {
  AgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "./Types.js";

export const AgentActionPlannerBamlClientName = "SeneraRuntimeActionPlanner";

export interface AgentActionPlannerBamlClient {
  registry: ClientRegistry;
  provider: string;
  options: Record<string, unknown>;
}

export function createActionPlannerBamlClient(
  model: ResolvedAgentModelProviderConfig,
  overrides: AgentActionPlannerClientConfig,
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
  provider: AgentActionPlannerClientConfig["Provider"],
): BamlProvider {
  return provider && provider !== "auto"
    ? provider
    : EndpointProviderMap[model.Endpoint];
}

const EndpointProviderMap = {
  Responses: "openai-responses",
  ChatCompletions: "openai-generic",
  ClaudeMessages: "anthropic",
  GoogleGenerateContent: "google-ai",
} as const satisfies Record<ResolvedAgentModelProviderConfig["Endpoint"], BamlProvider>;

function buildProviderOptions(
  provider: BamlProvider,
  model: ResolvedAgentModelProviderConfig,
  overrides: AgentActionPlannerClientConfig,
): Record<string, unknown> {
  const base = {
    base_url: normalizeBaseUrl(provider, overrides.BaseUrl ?? model.BaseUrl),
    api_key: overrides.ApiKey ?? model.ApiKey,
    model: overrides.Model ?? model.Model,
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
