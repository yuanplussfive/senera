import { resolveModelProviderCatalog } from "../AgentDefaults.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

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
    if (!configured.Capabilities?.Vision) {
      throw new AgentLocalizedError("vision.modelNotCapable", { modelProviderId: configuredModelProviderId });
    }
    return configured;
  }

  const requested = providers.resolve(selection.conversationModelProviderId);
  const provider =
    providers.list().find((item) => item.id === requested.Id && item.capabilities.Vision) ??
    providers.list().find((item) => item.capabilities.Vision);
  if (!provider) throw new AgentLocalizedError("vision.modelMissing");
  return providers.resolve(provider.id);
}
