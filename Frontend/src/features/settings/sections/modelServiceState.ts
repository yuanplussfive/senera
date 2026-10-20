import type {
  ConfigDiagnosticData,
  ConfigFormSectionData,
  ConfigUnresolvedSecretData,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { JsonConfigObject } from "../../../shared/config/JsonConfigForm";
import {
  groupProviderModelRows,
  providerEnabled,
  providerIdLabel,
  readDraftOrEffectiveValue,
  readModelGroups,
  readModelCapabilities,
  readModelProviders,
  readProviderModelRows,
  readProviderEndpoints,
  readString,
  sortProviderRows,
  sortProviderModelRows,
} from "../../chat/modelConfigData";
import type {
  ModelCapabilitiesDraft,
  ModelProviderDraft,
  ProviderEndpointDraft,
  ProviderModelGroup,
  ProviderModelInfo,
} from "../../chat/modelConfigTypes";

export type DefaultModelSlotId = "assistant";
export type DefaultModelSlotStatus =
  "ready" | "unset" | "missing" | "provider_missing" | "provider_disabled" | "capability_mismatch";
export type ModelServiceDiagnosticGroup = "connection" | "model_list" | "default_slots" | "runtime";
export type ModelServiceDiagnosticSeverity = "info" | "warning" | "error";
export type ModelServiceDiagnosticAction =
  "open_connection" | "test_connection" | "fetch_models" | "select_default" | "copy_report" | "none";

export interface DefaultModelSlotDefinition {
  id: DefaultModelSlotId;
  label: string;
  description: string;
  configKey: "DefaultModelProviderId";
  capabilityFilter?: Partial<ModelCapabilitiesDraft>;
}

export interface DefaultModelSlotState {
  definition: DefaultModelSlotDefinition;
  selectedModelId: string | null;
  selectedModel: ModelProviderDraft | null;
  provider: ProviderEndpointDraft | null;
  status: DefaultModelSlotStatus;
  statusLabel: string;
  repairAction: ModelServiceDiagnosticAction;
}

export interface ProviderModelListState {
  provider: ProviderEndpointDraft;
  catalog?: ProviderModelsSnapshotData;
  error?: ProviderModelsFailedData & { updatedAt?: string };
  loading: boolean;
  enabled: boolean;
  configuredModels: ModelProviderDraft[];
  rows: ProviderModelInfo[];
  groups: ProviderModelGroup[];
}

export interface ModelServiceDiagnosticItem {
  id: string;
  group: ModelServiceDiagnosticGroup;
  severity: ModelServiceDiagnosticSeverity;
  title: string;
  detail: string;
  affectedProviderId?: string;
  affectedModelId?: string;
  affectedSlotId?: DefaultModelSlotId;
  action: ModelServiceDiagnosticAction;
}

export interface ModelServiceDiagnosticGroupState {
  id: ModelServiceDiagnosticGroup;
  label: string;
  description: string;
  items: ModelServiceDiagnosticItem[];
}

export interface ModelServiceState {
  providers: ProviderEndpointDraft[];
  models: ModelProviderDraft[];
  selectedProvider: ProviderEndpointDraft | null;
  selectedProviderModelList: ProviderModelListState | null;
  defaultModel: { model: ModelProviderDraft; provider?: ProviderEndpointDraft } | null;
  defaultModelStatus: string;
  defaultSlots: DefaultModelSlotState[];
  diagnostics: ModelServiceDiagnosticItem[];
  catalogSignalCount: number;
  enabledModelCount: number;
  enabledProviders: number;
  providerCount: number;
  providerIssues: Array<{ severity: "error" | "warning"; message: string }>;
  /** Providers whose saved API key stays encrypted on this host, so the field reads as empty. */
  unresolvedApiKeyProviderIds: string[];
}

export interface ReadModelServiceStateInput {
  catalogs: Record<string, ProviderModelsSnapshotData>;
  configDiagnostics: readonly ConfigDiagnosticData[];
  draft: JsonConfigObject;
  errors: Record<string, ProviderModelsFailedData & { updatedAt?: string }>;
  loadingIds: Record<string, boolean>;
  section: ConfigFormSectionData;
  selectedProviderId?: string | null;
}

export interface ReadProviderModelListStateInput {
  catalogs: Record<string, ProviderModelsSnapshotData>;
  errors: Record<string, ProviderModelsFailedData & { updatedAt?: string }>;
  loadingIds: Record<string, boolean>;
  modelGroups: ReturnType<typeof readModelGroups>;
  models: ModelProviderDraft[];
  provider: ProviderEndpointDraft;
  search?: string;
}

export interface DefaultAssistantModelCandidate {
  model: ModelProviderDraft;
  provider: ProviderEndpointDraft;
  capabilities: Required<ModelCapabilitiesDraft>;
}

export const defaultModelSlotDefinitions = [
  {
    id: "assistant",
    label: frontendMessage("settings.model.defaultTitle"),
    description: frontendMessage("settings.diagnostics.defaultModelDescription"),
    configKey: "DefaultModelProviderId",
    capabilityFilter: { Chat: true },
  },
] as const satisfies readonly DefaultModelSlotDefinition[];

export const modelServiceDiagnosticGroupDefinitions = [
  {
    id: "connection",
    label: frontendMessage("settings.diagnostics.connectionGroup"),
    description: frontendMessage("settings.diagnostics.connectionGroupDescription"),
  },
  {
    id: "model_list",
    label: frontendMessage("settings.diagnostics.modelListGroup"),
    description: frontendMessage("settings.diagnostics.modelListGroupDescription"),
  },
  {
    id: "default_slots",
    label: frontendMessage("settings.diagnostics.defaultGroup"),
    description: frontendMessage("settings.diagnostics.defaultGroupDescription"),
  },
  {
    id: "runtime",
    label: frontendMessage("settings.diagnostics.runtimeGroup"),
    description: frontendMessage("settings.diagnostics.runtimeGroupDescription"),
  },
] as const satisfies readonly Omit<ModelServiceDiagnosticGroupState, "items">[];

export function readModelServiceState({
  catalogs,
  configDiagnostics,
  draft,
  errors,
  loadingIds,
  section,
  selectedProviderId,
}: ReadModelServiceStateInput): ModelServiceState {
  const providers = readProviderEndpoints(readDraftOrEffectiveValue(draft, section, "ModelProviderEndpoints"));
  const models = readModelProviders(readDraftOrEffectiveValue(draft, section, "ModelProviders"));
  const modelGroups = readModelGroups(readDraftOrEffectiveValue(draft, section, "ModelGroups"));
  const defaultModelId = readString(readDraftOrEffectiveValue(draft, section, "DefaultModelProviderId")) ?? null;
  const selectedProvider = readSelectedProvider(providers, selectedProviderId);
  const selectedProviderModelList = selectedProvider
    ? readProviderModelListState({
        catalogs,
        errors,
        loadingIds,
        modelGroups,
        models,
        provider: selectedProvider,
      })
    : null;
  const defaultSlots = readDefaultModelSlotStates({
    defaultModelId,
    models,
    providers,
  });
  const defaultAssistantSlot = defaultSlots.find((slot) => slot.definition.id === "assistant");
  const defaultModel = defaultAssistantSlot?.selectedModel
    ? {
        model: defaultAssistantSlot.selectedModel,
        provider: defaultAssistantSlot.provider ?? undefined,
      }
    : null;
  const unresolvedSecrets = readUnresolvedConfigSecrets(configDiagnostics);
  const diagnostics = readModelServiceDiagnostics({
    defaultSlots,
    errors,
    loadingIds,
    providers,
    unresolvedSecrets,
  });
  const providerIssues = diagnostics
    .filter((item) => item.group === "connection" || item.group === "model_list")
    .map((item) => ({
      severity: item.severity === "info" ? ("warning" as const) : item.severity,
      message: item.detail,
    }));

  return {
    providers,
    models,
    selectedProvider,
    selectedProviderModelList,
    defaultModel,
    defaultModelStatus: defaultAssistantSlot?.statusLabel ?? frontendMessage("settings.diagnostics.unset"),
    defaultSlots,
    diagnostics,
    catalogSignalCount: providers.filter((provider) => provider.Id && (errors[provider.Id] || loadingIds[provider.Id]))
      .length,
    enabledModelCount: models.length,
    enabledProviders: providers.filter((provider) => providerEnabled(provider)).length,
    providerCount: providers.length,
    providerIssues,
    unresolvedApiKeyProviderIds: unresolvedSecrets
      .filter((secret) => secret.kind === "provider_api_key")
      .map((secret) => secret.providerId),
  };
}

export function readProviderModelListState({
  catalogs,
  errors,
  loadingIds,
  modelGroups,
  models,
  provider,
  search = "",
}: ReadProviderModelListStateInput): ProviderModelListState {
  const catalog = provider.Id ? catalogs[provider.Id] : undefined;
  const rows = sortProviderModelRows({
    rows: readProviderModelRows({
      catalogModels: catalog?.models ?? [],
      models,
      providerId: provider.Id,
      search,
      configuredOnly: true,
    }),
    models,
    providerId: provider.Id,
  });

  return {
    provider,
    catalog,
    error: provider.Id ? errors[provider.Id] : undefined,
    loading: Boolean(provider.Id && loadingIds[provider.Id]),
    enabled: providerEnabled(provider),
    configuredModels: models.filter((model) => model.ProviderId === provider.Id),
    rows,
    groups: groupProviderModelRows(rows, modelGroups),
  };
}

export function readDefaultModelSlotStates({
  defaultModelId,
  models,
  providers,
}: {
  defaultModelId: string | null;
  models: readonly ModelProviderDraft[];
  providers: readonly ProviderEndpointDraft[];
}): DefaultModelSlotState[] {
  return defaultModelSlotDefinitions.map((definition) => {
    const selectedModelId = definition.configKey === "DefaultModelProviderId" ? defaultModelId : null;
    const selectedModel = selectedModelId ? (models.find((model) => model.Id === selectedModelId) ?? null) : null;
    const provider = selectedModel ? (providers.find((entry) => entry.Id === selectedModel.ProviderId) ?? null) : null;
    const capabilityMismatch = selectedModel
      ? !modelMatchesCapabilityFilter(selectedModel, definition.capabilityFilter)
      : false;
    const status = readDefaultSlotStatus({
      capabilityMismatch,
      provider,
      selectedModel,
      selectedModelId,
    });

    return {
      definition,
      selectedModelId,
      selectedModel,
      provider,
      status,
      statusLabel: defaultSlotStatusLabel(status),
      repairAction: defaultSlotRepairAction(status),
    };
  });
}

/**
 * Returns the only candidates exposed by the dedicated default-model surface.
 * Model enablement is intentionally not inferred here: the backend persists
 * provider enablement only, so a configured model is eligible when its provider
 * is enabled and its resolved capabilities include chat.
 */
export function readDefaultAssistantModelCandidates({
  models,
  providers,
  modelTemplate,
}: {
  models: readonly ModelProviderDraft[];
  providers: readonly ProviderEndpointDraft[];
  modelTemplate: Record<string, unknown>;
}): DefaultAssistantModelCandidate[] {
  const providerById = new Map(providers.map((provider) => [provider.Id, provider]));
  return models.flatMap((model) => {
    const provider = providerById.get(model.ProviderId);
    if (!provider || !providerEnabled(provider)) {
      return [];
    }
    const capabilities = readModelCapabilities(model, modelTemplate);
    return capabilities.Chat === false ? [] : [{ model, provider, capabilities }];
  });
}

export function readModelServiceDiagnostics({
  defaultSlots,
  errors,
  loadingIds,
  providers,
  unresolvedSecrets,
}: {
  defaultSlots: readonly DefaultModelSlotState[];
  errors: Record<string, ProviderModelsFailedData & { updatedAt?: string }>;
  loadingIds: Record<string, boolean>;
  providers: readonly ProviderEndpointDraft[];
  unresolvedSecrets: readonly ConfigUnresolvedSecretData[];
}): ModelServiceDiagnosticItem[] {
  return [
    ...providers.flatMap((provider) => readProviderDiagnosticItems(provider, errors, loadingIds, unresolvedSecrets)),
    ...defaultSlots.flatMap(readDefaultSlotDiagnosticItems),
    {
      id: "runtime-placeholder",
      group: "runtime",
      severity: "info",
      title: frontendMessage("settings.diagnostics.runtimeTitle"),
      detail: frontendMessage("settings.diagnostics.runtimeDetail"),
      action: "none",
    } satisfies ModelServiceDiagnosticItem,
  ];
}

export function readModelServiceDiagnosticGroups(
  items: readonly ModelServiceDiagnosticItem[],
): ModelServiceDiagnosticGroupState[] {
  return modelServiceDiagnosticGroupDefinitions.map((definition) => ({
    ...definition,
    items: items.filter((item) => item.group === definition.id),
  }));
}

export function formatModelServiceDiagnosticReport(items: readonly ModelServiceDiagnosticItem[]): string {
  const groups = readModelServiceDiagnosticGroups(items);
  const lines = [frontendMessage("settings.diagnostics.reportTitle")];
  for (const group of groups) {
    lines.push("", `[${group.label}]`);
    if (group.items.length === 0) {
      lines.push(`- ${frontendMessage("settings.diagnostics.noItems")}`);
      continue;
    }
    for (const item of group.items) {
      const affected = [
        item.affectedProviderId ? `provider=${item.affectedProviderId}` : "",
        item.affectedModelId ? `model=${item.affectedModelId}` : "",
        item.affectedSlotId ? `slot=${item.affectedSlotId}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(`- ${item.severity.toUpperCase()} ${item.title}`);
      lines.push(`  ${item.detail}`);
      if (affected) {
        lines.push(`  ${affected}`);
      }
      if (item.action !== "none") {
        lines.push(`  action=${item.action}`);
      }
    }
  }
  return lines.join("\n");
}

export function readModelServiceTaskCount(
  taskId: "connection" | "catalog" | "defaults" | "diagnostics",
  state: ModelServiceState,
): string {
  switch (taskId) {
    case "connection":
      return `${state.enabledProviders}/${state.providerCount}`;
    case "catalog":
      return state.catalogSignalCount > 0 ? String(state.catalogSignalCount) : String(state.enabledModelCount);
    case "defaults":
      return String(state.defaultSlots.filter((slot) => slot.status === "ready").length);
    case "diagnostics":
      return String(state.diagnostics.filter((item) => item.severity !== "info").length);
  }
}

function readSelectedProvider(
  providers: readonly ProviderEndpointDraft[],
  selectedProviderId?: string | null,
): ProviderEndpointDraft | null {
  const firstProvider = sortProviderRows([...providers])[0]?.provider ?? null;
  if (selectedProviderId) {
    return providers.find((provider) => provider.Id === selectedProviderId) ?? firstProvider;
  }
  return firstProvider;
}

function readDefaultSlotStatus({
  capabilityMismatch,
  provider,
  selectedModel,
  selectedModelId,
}: {
  capabilityMismatch: boolean;
  provider: ProviderEndpointDraft | null;
  selectedModel: ModelProviderDraft | null;
  selectedModelId: string | null;
}): DefaultModelSlotStatus {
  if (!selectedModelId) {
    return "unset";
  }
  if (!selectedModel) {
    return "missing";
  }
  if (!provider) {
    return "provider_missing";
  }
  if (!providerEnabled(provider)) {
    return "provider_disabled";
  }
  if (capabilityMismatch) {
    return "capability_mismatch";
  }
  return "ready";
}

function defaultSlotStatusLabel(status: DefaultModelSlotStatus): string {
  switch (status) {
    case "ready":
      return frontendMessage("settings.diagnostics.available");
    case "unset":
      return frontendMessage("settings.diagnostics.unset");
    case "missing":
      return frontendMessage("settings.diagnostics.modelMissing");
    case "provider_missing":
      return frontendMessage("settings.diagnostics.providerMissing");
    case "provider_disabled":
      return frontendMessage("settings.diagnostics.providerDisabled");
    case "capability_mismatch":
      return frontendMessage("settings.diagnostics.capabilityMismatch");
  }
}

function defaultSlotRepairAction(status: DefaultModelSlotStatus): ModelServiceDiagnosticAction {
  switch (status) {
    case "missing":
    case "provider_missing":
    case "provider_disabled":
    case "capability_mismatch":
    case "unset":
      return "select_default";
    case "ready":
      return "none";
  }
}

function readProviderDiagnosticItems(
  provider: ProviderEndpointDraft,
  errors: Record<string, ProviderModelsFailedData & { updatedAt?: string }>,
  loadingIds: Record<string, boolean>,
  unresolvedSecrets: readonly ConfigUnresolvedSecretData[],
): ModelServiceDiagnosticItem[] {
  if (!provider.Id) {
    return [
      {
        id: "provider-missing-id",
        group: "connection",
        severity: "error",
        title: frontendMessage("settings.diagnostics.providerMissingIdTitle"),
        detail: frontendMessage("settings.diagnostics.providerMissingIdDetail"),
        action: "open_connection",
      },
    ];
  }

  const items: ModelServiceDiagnosticItem[] = [];
  if (!providerEnabled(provider)) {
    items.push({
      id: `provider-disabled:${provider.Id}`,
      group: "connection",
      severity: "warning",
      title: frontendMessage("settings.diagnostics.providerDisabledTitle"),
      detail: frontendMessage("settings.diagnostics.providerDisabledDetail", { provider: providerIdLabel(provider) }),
      affectedProviderId: provider.Id,
      action: "open_connection",
    });
  }

  items.push(...readUnresolvedSecretDiagnosticItems(provider, unresolvedSecrets));

  const error = errors[provider.Id];
  if (error) {
    items.push({
      id: `provider-model-fetch:${provider.Id}`,
      group: "model_list",
      severity: "error",
      title: frontendMessage("settings.diagnostics.modelFetchFailed"),
      detail: frontendMessage("settings.diagnostics.providerDetail", {
        provider: providerIdLabel(provider),
        message: error.message,
      }),
      affectedProviderId: provider.Id,
      action: loadingIds[provider.Id] ? "none" : "fetch_models",
    });
  }

  return items;
}

/**
 * A saved secret this host cannot decrypt reads as an empty field, so the report names the slot and
 * sends the user to the editor where they can fill it again.
 */
function readUnresolvedSecretDiagnosticItems(
  provider: ProviderEndpointDraft,
  unresolvedSecrets: readonly ConfigUnresolvedSecretData[],
): ModelServiceDiagnosticItem[] {
  const affectedProvider = providerIdLabel(provider);
  return unresolvedSecrets
    .filter(isProviderSecretIdentity)
    .filter((secret) => secret.providerId === provider.Id)
    .map((secret): ModelServiceDiagnosticItem =>
      secret.kind === "provider_api_key"
        ? {
            id: `unresolved-api-key:${provider.Id}`,
            group: "connection",
            severity: "error",
            title: frontendMessage("settings.diagnostics.unresolvedApiKeyTitle"),
            detail: frontendMessage("settings.diagnostics.unresolvedApiKeyDetail", { provider: affectedProvider }),
            affectedProviderId: provider.Id,
            action: "open_connection",
          }
        : {
            id: `unresolved-header:${provider.Id}:${secret.headerName}`,
            group: "connection",
            severity: "error",
            title: frontendMessage("settings.diagnostics.unresolvedHeaderTitle"),
            detail: frontendMessage("settings.diagnostics.unresolvedHeaderDetail", {
              provider: affectedProvider,
              header: secret.headerName,
            }),
            affectedProviderId: provider.Id,
            action: "open_connection",
          },
    );
}

function isProviderSecretIdentity(
  secret: ConfigUnresolvedSecretData,
): secret is Extract<ConfigUnresolvedSecretData, { providerId: string }> {
  return secret.kind !== "extension_secret";
}

/** Unresolved secrets come from the snapshot diagnostics, addressed by code rather than by text. */
function readUnresolvedConfigSecrets(diagnostics: readonly ConfigDiagnosticData[]): ConfigUnresolvedSecretData[] {
  return diagnostics.flatMap((diagnostic) =>
    diagnostic.code === "config.secretUnresolved" && isConfigUnresolvedSecretData(diagnostic.details)
      ? [diagnostic.details]
      : [],
  );
}

function isConfigUnresolvedSecretData(value: unknown): value is ConfigUnresolvedSecretData {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case "provider_api_key":
      return typeof record.providerId === "string";
    case "provider_header":
      return typeof record.providerId === "string" && typeof record.headerName === "string";
    case "extension_secret":
      return typeof record.extensionId === "string";
    default:
      return false;
  }
}

function readDefaultSlotDiagnosticItems(slot: DefaultModelSlotState): ModelServiceDiagnosticItem[] {
  if (slot.status === "ready") {
    return [];
  }

  return [
    {
      id: `default-slot:${slot.definition.id}`,
      group: "default_slots",
      severity: slot.status === "unset" ? "warning" : "error",
      title: frontendMessage("settings.diagnostics.defaultUnavailable", {
        label: slot.definition.label,
        state: frontendMessage(
          slot.status === "unset" ? "settings.diagnostics.unset" : "settings.diagnostics.unavailable",
        ),
      }),
      detail: readDefaultSlotDiagnosticDetail(slot),
      affectedProviderId: slot.provider?.Id,
      affectedModelId: slot.selectedModelId ?? undefined,
      affectedSlotId: slot.definition.id,
      action: slot.repairAction,
    },
  ];
}

function readDefaultSlotDiagnosticDetail(slot: DefaultModelSlotState): string {
  switch (slot.status) {
    case "unset":
      return frontendMessage("settings.diagnostics.defaultUnset", { label: slot.definition.label });
    case "missing":
      return frontendMessage("settings.diagnostics.defaultMissing", {
        label: slot.definition.label,
        model: slot.selectedModelId ?? "",
      });
    case "provider_missing":
      return frontendMessage("settings.diagnostics.defaultProviderMissing", { label: slot.definition.label });
    case "provider_disabled":
      return frontendMessage("settings.diagnostics.defaultProviderDisabled", {
        label: slot.definition.label,
        provider: slot.provider?.Id ?? "",
      });
    case "capability_mismatch":
      return frontendMessage("settings.diagnostics.defaultCapabilityMismatch", { label: slot.definition.label });
    case "ready":
      return "";
  }
}

function modelMatchesCapabilityFilter(
  model: ModelProviderDraft,
  filter: Partial<ModelCapabilitiesDraft> | undefined,
): boolean {
  if (!filter) {
    return true;
  }
  return Object.entries(filter).every(([key, expected]) => {
    if (expected !== true) {
      return true;
    }
    const capability = model.Capabilities?.[key as keyof ModelCapabilitiesDraft];
    return capability !== false;
  });
}
