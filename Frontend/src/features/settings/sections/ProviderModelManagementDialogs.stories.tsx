import type { Story } from "@ladle/react";
import type { ModelProviderDraft, ProviderModelGroup, ProviderModelInfo } from "../../chat/modelConfigTypes";
import { ProviderModelCatalogDialog } from "./ProviderModelManagementDialogs";

const noop = (): void => {};

const claudeRows: ProviderModelInfo[] = [
  { id: "claude-fable-5", ownedBy: "anthropic" },
  { id: "claude-opus-5", ownedBy: "anthropic" },
  { id: "claude-sonnet-5", ownedBy: "anthropic" },
  { id: "claude-haiku-4-5-20251001", ownedBy: "anthropic" },
];
const gptRows: ProviderModelInfo[] = [
  { id: "gpt-4o", ownedBy: "openai" },
  { id: "gpt-4o-mini", ownedBy: "openai" },
  { id: "o3-mini", ownedBy: "openai" },
];
const geminiRows: ProviderModelInfo[] = [
  { id: "gemini-2.5-pro", ownedBy: "google" },
  { id: "gemini-2.5-flash", ownedBy: "google" },
];
const otherRows: ProviderModelInfo[] = [
  { id: "deepseek-chat", ownedBy: "deepseek" },
  { id: "qwen3-235b-a22b-instruct-2507", ownedBy: "alibaba" },
];

const groups: ProviderModelGroup[] = [
  { id: "claude", label: "Claude", icon: "claude", rows: claudeRows },
  { id: "gpt", label: "GPT", icon: "openai", rows: gptRows },
  { id: "gemini", label: "Gemini", icon: "gemini", rows: geminiRows },
  { id: "other", label: "其他模型", icon: "openrouter", rows: otherRows },
];
const rows = groups.flatMap((group) => group.rows);

const configuredModels: ModelProviderDraft[] = [
  { Id: "openrouter/claude-fable-5", ProviderId: "openrouter", Endpoint: "openrouter", Model: "claude-fable-5" },
];

const pendingModelIds = new Map([["openrouter/gpt-4o", "provider.model.upsert"]]);

const baseProps = {
  configuredModels,
  disabled: false,
  error: null,
  groups,
  loading: false,
  onAddModel: noop,
  onOpenChange: noop,
  onRetryFetch: noop,
  onSearch: noop,
  open: true,
  pendingModelIds,
  providerId: "openrouter",
  rows,
  search: "",
} as const;

export const ModelCatalog: Story = () => <ProviderModelCatalogDialog {...baseProps} />;

export const LoadingState: Story = () => <ProviderModelCatalogDialog {...baseProps} groups={[]} rows={[]} loading />;

export const ErrorState: Story = () => (
  <ProviderModelCatalogDialog {...baseProps} groups={[]} rows={[]} error="401 Unauthorized：API Key 无效或已过期" />
);

export const EmptyState: Story = () => (
  <ProviderModelCatalogDialog {...baseProps} groups={[]} rows={[]} search="claude-9" />
);
