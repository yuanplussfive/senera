import type { ModelProviderListItem, ModelProviderMetadata } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export function readSelectedModelProvider(
  models: ModelProviderListItem[],
  selectedId: string | null,
): ModelProviderListItem | undefined {
  return models.find((model) => model.id === selectedId) ?? models.find((model) => model.isDefault);
}

export function readChatModelProviders(models: readonly ModelProviderListItem[]): ModelProviderListItem[] {
  return models.filter((model) => model.capabilities.Chat === true);
}

export function formatModelProviderName(provider?: ModelProviderMetadata | ModelProviderListItem): string {
  if (!provider) return frontendMessage("config.model.assistantFallback");
  const model = provider.model?.trim();
  return model || frontendMessage("config.model.assistantFallback");
}
