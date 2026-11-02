import type { ModelProviderListItem, ModelProviderMetadata } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { resolveModelIcon } from "../../shared/models/ModelSelect";
import {
  agentModelMeetsRequirements,
  AgentModelPlanningRequirements,
} from "../../api/generatedModelCapabilityContract";

export function readSelectedModelProvider(
  models: ModelProviderListItem[],
  selectedId: string | null,
): ModelProviderListItem | undefined {
  return models.find((model) => model.id === selectedId) ?? models.find((model) => model.isDefault);
}

export function readChatModelProviders(models: readonly ModelProviderListItem[]): ModelProviderListItem[] {
  return models.filter((model) =>
    agentModelMeetsRequirements(
      { ...model.capabilities, Stream: model.stream },
      AgentModelPlanningRequirements[model.toolPlanningMode],
    ),
  );
}

/**
 * Retains an explicit configured choice even when its capabilities changed.
 * The backend rejects incompatible invocations; only deleted model identities
 * are omitted so a configuration error cannot silently select another model.
 */
export function readConfiguredChatModelProviderId(
  models: readonly ModelProviderListItem[],
  selectedId: string | null | undefined,
): string | undefined {
  if (!selectedId) return undefined;
  return models.some((model) => model.id === selectedId) ? selectedId : undefined;
}

export function formatModelProviderName(provider?: ModelProviderMetadata | ModelProviderListItem): string {
  if (!provider) return frontendMessage("config.model.assistantFallback");
  const model = provider.model?.trim();
  return model || frontendMessage("config.model.assistantFallback");
}

export function readModelProviderIcon(provider?: ModelProviderMetadata | ModelProviderListItem): string | undefined {
  if (!provider) return undefined;
  return resolveModelIcon(provider);
}
