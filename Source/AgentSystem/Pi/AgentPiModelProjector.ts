import type {
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type {
  AgentPiModelApi,
  AgentPiProviderProjection,
} from "./AgentPiTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { buildPiProxyBaseUrl } from "../PiProxy/AgentPiProxyHttpApi.js";

const FreeCostModel = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

const UnlimitedTokenBudget = Number.MAX_SAFE_INTEGER;
const SeneraPiProxyProviderId = "senera-pi-proxy";
const SeneraPiProxyApi: AgentPiModelApi = "openai-completions";
const SeneraPiProxyApiKey = "senera-local";

export function projectSeneraModelProviderToPi(
  provider: ResolvedAgentModelProviderConfig,
  config: AgentSystemConfig,
): AgentPiProviderProjection {
  const capabilities = provider.Capabilities ?? {};
  const proxyBaseUrl = buildPiProxyBaseUrl(config);
  const model = {
    id: provider.Model,
    name: provider.Id,
    api: SeneraPiProxyApi,
    provider: SeneraPiProxyProviderId,
    baseUrl: proxyBaseUrl,
    reasoning: capabilities.Reasoning === true,
    input: capabilities.Vision === true ? ["text", "image"] : ["text"],
    cost: { ...FreeCostModel },
    contextWindow: positiveOrUnlimited(provider.ContextWindowTokens),
    maxTokens: positiveOrUnlimited(provider.MaxModelOutputTokens),
  } satisfies AgentPiProviderProjection["model"];

  return {
    providerId: model.provider,
    apiKey: SeneraPiProxyApiKey,
    headers: {},
    upstream: {
      providerId: provider.Id,
      endpoint: provider.Endpoint,
      baseUrl: provider.BaseUrl,
      model: provider.Model,
    },
    model,
  };
}

function positiveOrUnlimited(value: number | undefined): number {
  return value === undefined || value <= 0 ? UnlimitedTokenBudget : value;
}
