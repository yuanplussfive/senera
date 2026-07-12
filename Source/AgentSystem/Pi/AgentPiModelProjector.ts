import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentPiProxyProtocol, resolveAgentPiProxyBaseUrl } from "../PiProxy/AgentPiProxyContract.js";
import { resolveAgentModelCompatibility } from "../ModelEndpoints/ModelCompatibility.js";

const FreeCostModel = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

const UnlimitedTokenBudget = Number.MAX_SAFE_INTEGER;

export function projectSeneraModelProviderToPi(
  provider: ResolvedAgentModelProviderConfig,
  config: AgentSystemConfig,
): AgentPiProviderProjection {
  const capabilities = provider.Capabilities ?? {};
  const compatibility = resolveAgentModelCompatibility(provider);
  const proxyBaseUrl = resolveAgentPiProxyBaseUrl(config);
  const model = {
    id: provider.Model,
    name: provider.Id,
    api: AgentPiProxyProtocol.modelApi,
    provider: AgentPiProxyProtocol.providerId,
    baseUrl: proxyBaseUrl,
    reasoning: capabilities.Reasoning === true,
    input: capabilities.Vision === true ? ["text", "image"] : ["text"],
    cost: { ...FreeCostModel },
    contextWindow: positiveOrUnlimited(provider.ContextWindowTokens),
    maxTokens: positiveOrUnlimited(provider.MaxModelOutputTokens),
    compat: {
      supportsDeveloperRole: compatibility.supportsDeveloperRole,
    },
  } satisfies AgentPiProviderProjection["model"];

  return {
    providerId: model.provider,
    apiKey: AgentPiProxyProtocol.apiKey,
    headers: {},
    model,
  };
}

function positiveOrUnlimited(value: number | undefined): number {
  return value === undefined || value <= 0 ? UnlimitedTokenBudget : value;
}
