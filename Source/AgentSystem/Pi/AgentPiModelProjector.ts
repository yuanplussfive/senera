import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { resolveAgentNativeToolRoute } from "../ModelEndpoints/AgentModelEndpointContract.js";
import { resolveAgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelToolPlanning.js";
import type { AgentPiModelApi, AgentPiProviderProjection } from "./AgentPiTypes.js";

const FreeCostModel = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

const SeneraPiPlanningApi: AgentPiModelApi = "senera-planning";
const SeneraPiPlanningProviderId = "senera";

export function projectSeneraModelProviderToPi(provider: ResolvedAgentModelProviderConfig): AgentPiProviderProjection {
  const capabilities = provider.Capabilities ?? {};
  const toolPlanningMode = resolveAgentModelToolPlanningMode(provider);
  if (toolPlanningMode === "native" && capabilities.ToolCalling === false) {
    throw new AgentLocalizedError("config.nativeToolCallingCapabilityRequired", { modelId: provider.Id });
  }
  if (toolPlanningMode === "native" && provider.Stream === false) {
    throw new AgentLocalizedError("config.nativeToolCallingStreamingRequired", { modelId: provider.Id });
  }
  if (toolPlanningMode === "native") {
    return projectNativeModelProvider(provider, capabilities, toolPlanningMode);
  }

  const model = {
    id: provider.Model,
    name: provider.Id,
    api: SeneraPiPlanningApi,
    provider: SeneraPiPlanningProviderId,
    baseUrl: "senera://planning",
    reasoning: capabilities.Reasoning === true,
    // BAML keeps its structured instruction text separate from the provider
    // message attachments. A vision-capable planner still receives images via
    // the endpoint's native multimodal input representation.
    input: capabilities.Vision === true ? ["text", "image"] : ["text"],
    cost: { ...FreeCostModel },
    contextWindow: provider.ContextWindowTokens,
    maxTokens: resolveAgentPiModelMaxTokens(provider),
  } satisfies AgentPiProviderProjection["model"];

  return {
    providerId: model.provider,
    model,
    toolPlanningMode,
  };
}

function projectNativeModelProvider(
  provider: ResolvedAgentModelProviderConfig,
  capabilities: NonNullable<ResolvedAgentModelProviderConfig["Capabilities"]>,
  toolPlanningMode: "native",
): AgentPiProviderProjection {
  const route = resolveAgentNativeToolRoute(provider.Endpoint, provider.BaseUrl);
  const api = route.api;
  const model = {
    id: provider.Model,
    name: provider.Id,
    api,
    provider: provider.ProviderId,
    baseUrl: route.baseUrl,
    reasoning: capabilities.Reasoning === true,
    input: capabilities.Vision === true ? ["text", "image"] : ["text"],
    cost: { ...FreeCostModel },
    contextWindow: provider.ContextWindowTokens,
    maxTokens: resolveAgentPiModelMaxTokens(provider),
    headers: { ...provider.Headers },
    compat: projectNativeCompatibility(api, capabilities),
  } satisfies AgentPiProviderProjection["model"];

  return { providerId: model.provider, model, toolPlanningMode };
}

function projectNativeCompatibility(
  api: string,
  capabilities: NonNullable<ResolvedAgentModelProviderConfig["Capabilities"]>,
): Record<string, boolean> | undefined {
  if (api === "openai-completions") {
    return {
      supportsDeveloperRole: capabilities.DeveloperRole === true,
      supportsUsageInStreaming: capabilities.StreamingUsage !== false,
    };
  }
  if (api === "openai-responses") {
    return { supportsDeveloperRole: capabilities.DeveloperRole === true };
  }
  return undefined;
}

export function resolveAgentPiModelMaxTokens(
  provider: Pick<ResolvedAgentModelProviderConfig, "MaxModelOutputTokens" | "MaxOutputTokens">,
): number {
  return (
    [provider.MaxModelOutputTokens, provider.MaxOutputTokens].find(isPositiveTokenCount) ??
    DEFAULT_COMPACTION_SETTINGS.reserveTokens
  );
}

function isPositiveTokenCount(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}
