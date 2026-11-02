import { resolveModelProviderCatalog } from "../AgentDefaults.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { agentModelMeetsRequirements, AgentModelRequestRequirements } from "../Core/AgentModelCapabilityContract.js";
import { readAgentModelInvocationCapabilities } from "../ModelEndpoints/AgentModelRequirements.js";

export interface AgentVisionProviderSelection {
  readonly conversationModelProviderId?: string;
  readonly configuredModelProviderId?: string;
}

export function resolveAgentVisionProvider(config: AgentSystemConfig, selection: AgentVisionProviderSelection = {}) {
  const providers = resolveModelProviderCatalog(config);
  const configuredModelProviderId = selection.configuredModelProviderId?.trim();
  if (configuredModelProviderId) {
    let configured;
    try {
      configured = providers.resolve(configuredModelProviderId);
    } catch (cause) {
      throw new AgentLocalizedError("vision.modelNotFound", { modelProviderId: configuredModelProviderId }, { cause });
    }
    if (
      !agentModelMeetsRequirements(
        readAgentModelInvocationCapabilities(configured),
        AgentModelRequestRequirements.Vision,
      )
    ) {
      throw new AgentLocalizedError("vision.modelNotCapable", { modelProviderId: configuredModelProviderId });
    }
    return configured;
  }

  const requested = providers.resolve(selection.conversationModelProviderId);
  const candidates = providers
    .list()
    .filter((item) => agentModelMeetsRequirements(item.capabilities, AgentModelRequestRequirements.Vision));
  const provider = candidates.find((item) => item.id === requested.Id) ?? candidates[0];
  if (!provider) throw new AgentLocalizedError("vision.modelMissing");
  return providers.resolve(provider.id);
}
