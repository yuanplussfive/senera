import type {
  ConfigFormSectionData,
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
}

export interface ReadModelServiceStateInput {
  catalogs: Record<string, ProviderModelsSnapshotData>;
  draft: JsonConfigObject;
  errors: Record<string, ProviderModelsFailedData & { updatedAt?: string }>;
  loadingIds: Record<string, boolean>;
  section: ConfigFormSectionData;
  selectedProviderId?: string | null;
}

export interface ReadProviderModelListStateInput {
  catalogs: Record<string, ProviderModelsSnapshotData>;
  defaultModelId: string;
  errors: Record<string, ProviderModelsFailedData & { updatedAt?: string }>;
  loadingIds: Record<string, boolean>;
  modelGroups: ReturnType<typeof readModelGroups>;
  models: ModelProviderDraft[];
  provider: ProviderEndpointDraft;
  search?: string;
  configuredOnly?: boolean;
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
  draft,
  errors,
  loadingIds,
  section,
  selectedProviderId,
}: ReadModelServiceStateInput): ModelServiceState {
  const providers = readProviderEndpoints(readDraftOrEffectiveValue(draft, section, "ModelProviderEndpoints"));
  const models = readModelProviders(readDraftOrEffectiveValue(draft, section, "ModelProviders"));
  const modelGroups = readModelGroups(readDraftOrEffectiveValue(draft, section, "ModelGroups"));
  const defaultModelId = readString(readDraftOrEffectiveValue(draft, section, "DefaultModelProviderId")) ?? "";
  const selectedProvider = readSelectedProvider(providers, selectedProviderId);
  const selectedProviderModelList = selectedProvider
    ? readProviderModelListState({
        catalogs,
        defaultModelId,
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
  const diagnostics = readModelServiceDiagnostics({
    defaultSlots,
    errors,
    loadingIds,
    providers,
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
  };
}

export function readProviderModelListState({
  catalogs,
  defaultModelId,
  errors,
  loadingIds,
  modelGroups,
  models,
  provider,
  search = "",
  configuredOnly = false,
}: ReadProviderModelListStateInput): ProviderModelListState {
  const catalog = provider.Id ? catalogs[provider.Id] : undefined;
  const rows = sortProviderModelRows({
    rows: readProviderModelRows({
      catalogModels: catalog?.models ?? [],
      models,
      providerId: provider.Id,
      search,
      configuredOnly,
    }),
    models,
    providerId: provider.Id,
    defaultModelId,
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
  defaultModelId: string;
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
}: {
  defaultSlots: readonly DefaultModelSlotState[];
  errors: Record<string, ProviderModelsFailedData & { updatedAt?: string }>;
  loadingIds: Record<string, boolean>;
  providers: readonly ProviderEndpointDraft[];
}): ModelServiceDiagnosticItem[] {
  return [
    ...providers.flatMap((provider) => readProviderDiagnosticItems(provider, errors, loadingIds)),
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
  if (selectedProviderId) {
    return providers.find((provider) => provider.Id === selectedProviderId) ?? providers[0] ?? null;
  }
  return providers[0] ?? null;
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

  const error = errors[provider.Id];
  if (error) {
    items.push({
      id: `provider-model-fetch:${provider.Id}`,
      group: "model_list",
      severity: "error",
      title: frontendMessage("settings.diagnostics.modelFetchFailed"),
      detail: `${providerIdLabel(provider)}：${error.message}`,
      affectedProviderId: provider.Id,
      action: loadingIds[provider.Id] ? "none" : "fetch_models",
    });
  }

  return items;
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
