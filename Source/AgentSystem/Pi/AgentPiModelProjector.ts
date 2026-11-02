import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentModelPlanningRequirements } from "../Core/AgentModelCapabilityContract.js";
import { assertAgentModelRequirements } from "../ModelEndpoints/AgentModelRequirements.js";
import {
  projectAgentNativeToolModel,
  resolveAgentModelMaxTokens,
} from "../ModelEndpoints/AgentNativeToolModelProjector.js";
import { resolveAgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelToolPlanning.js";
import type { AgentPiModelApi, AgentPiProviderProjection } from "./AgentPiTypes.js";

import { projectAgentPiModelPrices } from "../ModelEndpoints/AgentModelPricing.js";

const SeneraPiPlanningApi: AgentPiModelApi = "senera-planning";
const SeneraPiPlanningProviderId = "senera";

export function projectSeneraModelProviderToPi(provider: ResolvedAgentModelProviderConfig): AgentPiProviderProjection {
  const capabilities = provider.Capabilities ?? {};
  const toolPlanningMode = resolveAgentModelToolPlanningMode(provider);
  assertAgentModelRequirements(provider, AgentModelPlanningRequirements[toolPlanningMode]);
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
    cost: projectAgentPiModelPrices(provider.Pricing),
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
