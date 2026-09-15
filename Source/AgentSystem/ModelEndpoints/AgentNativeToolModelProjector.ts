import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { resolveAgentNativeToolRoute, type AgentNativeToolApi } from "./AgentModelEndpointContract.js";
import { resolveAgentModelThinking } from "./AgentModelThinking.js";

const FreeCostModel = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

/** Projects a configured provider into Pi's vendor-neutral API model shape. */
export function projectAgentNativeToolModel(provider: ResolvedAgentModelProviderConfig): Model<AgentNativeToolApi> {
  const capabilities = provider.Capabilities ?? {};
  const route = resolveAgentNativeToolRoute(provider.Endpoint, provider.BaseUrl);
  const api = route.api;
  const thinking = resolveAgentModelThinking({
    api,
    provider: provider.ProviderId,
    model: provider.Model,
    capabilities,
    declaredCapabilities: provider.DeclaredCapabilities,
    thinkingLevelMap: provider.ThinkingLevelMap,
    thinkingProfiles: provider.ThinkingProfiles,
    defaultThinkingLevel: provider.DefaultThinkingLevel,
  });
  return {
    id: provider.Model,
    name: provider.Id,
    api,
    provider: provider.ProviderId,
    baseUrl: route.baseUrl,
    reasoning: thinking.reasoning,
    ...(thinking.thinkingLevelMap ? { thinkingLevelMap: thinking.thinkingLevelMap } : {}),
    input: capabilities.Vision === true ? ["text", "image"] : ["text"],
    cost: { ...FreeCostModel },
    contextWindow: provider.ContextWindowTokens,
    maxTokens: resolveAgentModelMaxTokens(provider),
    headers: { ...provider.Headers },
    compat: projectNativeCompatibility(api, capabilities),
  } satisfies Model<AgentNativeToolApi>;
}

export function resolveAgentModelMaxTokens(
  provider: Pick<ResolvedAgentModelProviderConfig, "MaxModelOutputTokens" | "MaxOutputTokens">,
): number {
  return (
    [provider.MaxModelOutputTokens, provider.MaxOutputTokens].find(isPositiveTokenCount) ??
    DEFAULT_COMPACTION_SETTINGS.reserveTokens
  );
}

function projectNativeCompatibility(
  api: AgentNativeToolApi,
  capabilities: NonNullable<ResolvedAgentModelProviderConfig["Capabilities"]>,
): Record<string, boolean> | undefined {
  if (api === "openai-completions") {
    return {
      supportsDeveloperRole: capabilities.DeveloperRole === true,
      supportsUsageInStreaming: capabilities.StreamingUsage !== false,
    };
  }
  if (api === "openai-responses") return { supportsDeveloperRole: capabilities.DeveloperRole === true };
  return undefined;
}

function isPositiveTokenCount(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}
