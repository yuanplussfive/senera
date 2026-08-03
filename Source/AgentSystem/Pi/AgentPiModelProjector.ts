import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import type { AgentPiModelApi, AgentPiProviderProjection } from "./AgentPiTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentPiProxyProtocol,
  AgentPiProxyModelProviderHeader,
  encodePiProxyModelProviderHeaderValue,
  resolveAgentPiProxyBaseUrl,
} from "../PiShared/AgentPiProxyProtocol.js";
import { resolveAgentModelCompatibility } from "../ModelEndpoints/ModelCompatibility.js";

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
    contextWindow: provider.ContextWindowTokens,
    maxTokens: resolveAgentPiModelMaxTokens(provider),
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

export function resolveAgentPiModelMaxTokens(provider: ResolvedAgentModelProviderConfig): number {
  return (
    [provider.MaxModelOutputTokens, provider.MaxOutputTokens].find(isPositiveTokenCount) ??
    DEFAULT_COMPACTION_SETTINGS.reserveTokens
  );
}

function isPositiveTokenCount(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}
