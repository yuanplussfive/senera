import type { ModelProviderListItem, ModelProviderMetadata } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { inferModelProviderEndpointIcon, inferModelProviderIcon } from "./ModelProviderIcon";

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

export function readModelProviderIcon(provider?: ModelProviderMetadata | ModelProviderListItem): string | undefined {
  if (!provider) return undefined;
  // A model's identity is more useful than the endpoint it happens to use.
  // Endpoint icons are only a fallback for custom/unknown model names.
  const modelIcon = inferModelProviderIcon(provider.model, false);
  if (modelIcon) return modelIcon;
  if ("icon" in provider && provider.icon?.trim()) return provider.icon;
  for (const candidate of [provider.id, provider.baseUrl, provider.kind]) {
    const icon = inferModelProviderEndpointIcon(candidate, false);
    if (icon) return icon;
  }
  return inferModelProviderIcon(provider.model);
}
