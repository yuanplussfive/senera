import type { ModelProviderListItem, ModelProviderMetadata } from "../../api/eventTypes";

export function readSelectedModelProvider(
  models: ModelProviderListItem[],
  selectedId: string | null,
): ModelProviderListItem | undefined {
  return models.find((model) => model.id === selectedId) ?? models.find((model) => model.isDefault);
}

export function formatModelProviderName(provider?: ModelProviderMetadata | ModelProviderListItem): string {
  if (!provider) return "AI 助手";
  const title = provider.title?.trim();
  const model = provider.model?.trim();
  if (title && model && normalizeModelDisplayName(title) !== normalizeModelDisplayName(model)) return `${title} · ${model}`;
  return title || model || "AI 助手";
}

function normalizeModelDisplayName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
