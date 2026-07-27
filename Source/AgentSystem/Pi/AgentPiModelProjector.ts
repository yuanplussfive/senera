import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiModelApi, AgentPiProviderProjection } from "./AgentPiTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { resolveAgentPiProxyBaseUrl, AgentPiProxyProtocol } from "../PiProxy/AgentPiProxyContract.js";
import {
  AgentPiProxyModelProviderHeader,
  encodePiProxyModelProviderHeaderValue,
} from "../PiProxy/AgentPiProxyRuntimeContext.js";
import { resolveAgentModelCompatibility } from "../ModelEndpoints/ModelCompatibility.js";
import { resolveAgentLoopConfig } from "../AgentDefaults.js";

const FreeCostModel = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

const SeneraPiProxyApi: AgentPiModelApi = AgentPiProxyProtocol.modelApi;

export function projectSeneraModelProviderToPi(
  provider: ResolvedAgentModelProviderConfig,
  config: AgentSystemConfig,
): AgentPiProviderProjection {
  const capabilities = provider.Capabilities ?? {};
  const compatibility = resolveAgentModelCompatibility(provider);
  const compaction = resolveAgentLoopConfig(config).PiSessions.Compaction;
  const proxyBaseUrl = resolveAgentPiProxyBaseUrl(config);
  const model = {
    id: provider.Model,
    name: provider.Id,
    api: SeneraPiProxyApi,
    provider: AgentPiProxyProtocol.providerId,
    baseUrl: proxyBaseUrl,
    reasoning: capabilities.Reasoning === true,
    input: capabilities.Vision === true ? ["text", "image"] : ["text"],
    cost: { ...FreeCostModel },
    contextWindow: positiveOrFallback(provider.ContextWindowTokens, compaction.UnknownContextWindowTokens),
    maxTokens: positiveOrFallback(
      provider.MaxModelOutputTokens,
      positiveOrFallback(provider.MaxOutputTokens, compaction.UnknownModelOutputTokens),
    ),
    compat: {
      supportsDeveloperRole: compatibility.supportsDeveloperRole,
    },
  } satisfies AgentPiProviderProjection["model"];

  return {
    providerId: model.provider,
    apiKey: AgentPiProxyProtocol.apiKey,
    headers: {
      [AgentPiProxyModelProviderHeader]: encodePiProxyModelProviderHeaderValue(provider.Id),
    },
    upstream: {
      providerId: provider.Id,
      endpoint: provider.Endpoint,
      baseUrl: provider.BaseUrl,
      model: provider.Model,
    },
    model,
  };
}

function positiveOrFallback(value: number | undefined, fallback: number): number {
  return value === undefined || value <= 0 ? fallback : value;
}
