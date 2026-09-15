import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import {
  projectAgentNativeToolModel,
  resolveAgentModelMaxTokens,
} from "../ModelEndpoints/AgentNativeToolModelProjector.js";
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
    return projectNativeModelProvider(provider, toolPlanningMode);
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
    maxTokens: resolveAgentModelMaxTokens(provider),
  } satisfies AgentPiProviderProjection["model"];

  return {
    providerId: model.provider,
    model,
    toolPlanningMode,
  };
}

function projectNativeModelProvider(
  provider: ResolvedAgentModelProviderConfig,
  toolPlanningMode: "native",
): AgentPiProviderProjection {
  const model = projectAgentNativeToolModel(provider);
  return { providerId: model.provider, model, toolPlanningMode };
}
