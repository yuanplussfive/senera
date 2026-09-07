import type { JsonConfigObject } from "../../shared/config/JsonConfigForm";
import { ConfigSecretContract } from "../../api/generatedEventCatalog";
import type { ModelsDevModelMetadata } from "../../api/eventTypes";
import { getFrontendLocale } from "../../i18n/frontendLocaleStore";
import { isUnknownRecord as isRecord, readTrimmedString as readString } from "../../lib/unknownValue";
import {
  readDefaultModelGroup,
  readDefaultModelGroupRules,
  type ModelProviderRuleMatchKind,
} from "./ModelProviderIcon";
import { inferModelCatalogCapabilities, inferModelCatalogGroup, type ModelCatalogGroup } from "./modelCatalogRules";
import { readModelsDevCapabilities } from "./modelsDevCapabilities";
import type {
  ConfigFormFieldData,
  ConfigFormSectionData,
  ModelCapabilitiesDraft,
  ModelGroupDraft,
  ModelGroupStrategyDraft,
  ModelProviderDraft,
  ModelToolPlanningMode,
  ProviderEndpointDraft,
  ProviderModelEndpointInput,
  ProviderModelGroup,
  ProviderModelInfo,
} from "./modelConfigTypes";

export function findTopField(section: ConfigFormSectionData | undefined, key: string): ConfigFormFieldData | undefined {
  return section?.fields.find((field) => field.path.length === 1 && field.path[0] === key);
}

export function findItemField(field: ConfigFormFieldData | undefined, key: string): ConfigFormFieldData | undefined {
  return field?.itemFields?.find((itemField) => itemField.path[itemField.path.length - 1] === key);
}

export function readFieldOptions(field: ConfigFormFieldData | undefined): Array<{ value: string; label: string }> {
  return (field?.options ?? []).map((option) => {
    const value = String(option);
    return {
      value,
      label: field?.optionLabels?.[value] ?? value,
    };
  });
}

export function readDraftOrEffectiveValue(
  value: JsonConfigObject,
  section: ConfigFormSectionData | undefined,
  key: string,
): unknown {
  const draftValue = value[key];
  if (draftValue !== undefined) {
    return draftValue;
  }
  return findTopField(section, key)?.effectiveValue;
}

export function createModelDraft({
  provider,
  modelInfo,
  modelField,
  endpointOptions,
  modelsDev,
}: {
  provider: ProviderEndpointDraft;
  modelInfo: ProviderModelInfo;
  modelField: ConfigFormFieldData | undefined;
  endpointOptions: Array<{ value: string; label: string }>;
  modelsDev?: ModelsDevModelMetadata;
}): ModelProviderDraft {
  const template = cloneRecord(modelField?.defaultItem ?? {});
  const modelId = modelInfo.id.trim();
  const templateCapabilities = isRecord(template.Capabilities) ? template.Capabilities : {};
  const catalogCapabilities = readModelsDevCapabilities(modelsDev);
  return normalizeModelProviderDraft({
    ...copyModelRuntimeTemplate(template),
    Capabilities: { ...templateCapabilities, ...catalogCapabilities },
    ...(modelsDev?.contextLimit ? { ContextWindowTokens: modelsDev.contextLimit } : {}),
    ...(modelsDev?.outputLimit ? { MaxModelOutputTokens: modelsDev.outputLimit } : {}),
    Id: modelConfigId(provider.Id, modelId),
    ProviderId: provider.Id,
    Endpoint: readString(template.Endpoint) ?? endpointOptions[0]?.value ?? "",
    Model: modelId,
  });
}

export function copyModelRuntimeTemplate(template: Record<string, unknown>): Partial<ModelProviderDraft> {
  return {
    ...optionalCapabilities("Capabilities", template.Capabilities),
    ...optionalToolPlanningMode(template.ToolPlanningMode),
    ...optionalNumber("ContextWindowTokens", template.ContextWindowTokens),
    ...optionalNumber("MaxModelOutputTokens", template.MaxModelOutputTokens),
    ...optionalNumber("Temperature", template.Temperature),
    ...optionalNumber("MaxOutputTokens", template.MaxOutputTokens),
    ...(typeof template.Stream === "boolean" ? { Stream: template.Stream } : {}),
    ...optionalNumber("TimeoutSeconds", template.TimeoutSeconds),
    ...optionalNumber("FirstTokenTimeoutSeconds", template.FirstTokenTimeoutSeconds),
    ...optionalNumber("MaxRequestSeconds", template.MaxRequestSeconds),
    ...optionalNumber("MaxNetworkRetries", template.MaxNetworkRetries),
    ...optionalNumber("RetryBaseDelaySeconds", template.RetryBaseDelaySeconds),
    ...optionalNumber("RetryMaxDelaySeconds", template.RetryMaxDelaySeconds),
    ...optionalNumber("RetryAfterMaxDelaySeconds", template.RetryAfterMaxDelaySeconds),
    ...optionalNumber("MaxResponseBytes", template.MaxResponseBytes),
    ...optionalNumber("MaxSseEventBytes", template.MaxSseEventBytes),
    ...optionalNumber("MaxSseEvents", template.MaxSseEvents),
  };
}

export function readProviderEndpoints(value: unknown): ProviderEndpointDraft[] {
  return Array.isArray(value) ? value.filter(isRecord).map((entry) => normalizeProviderEndpointDraft(entry)) : [];
}

export function readModelProviders(value: unknown): ModelProviderDraft[] {
  return Array.isArray(value) ? value.filter(isRecord).map((entry) => normalizeModelProviderDraft(entry)) : [];
}

export function readModelGroups(value: unknown): ModelGroupDraft[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord).map((entry) => normalizeModelGroupDraft(entry));
  }
  return readDefaultModelGroupRules().map((rule) =>
    normalizeModelGroupDraft({
      Id: rule.id,
      Label: rule.label,
      Icon: rule.icon,
      Strategies: [
        {
          Match: rule.match,
          Values: rule.values,
        },
      ],
    }),
  );
}

export function normalizeProviderEndpointDraft(value: unknown): ProviderEndpointDraft {
  const record = isRecord(value) ? value : {};
  const headers = isRecord(record.Headers)
    ? Object.fromEntries(Object.entries(record.Headers).map(([key, item]) => [key, String(item ?? "")]))
    : undefined;
  return {
    Id: readString(record.Id) ?? "",
    ...optionalString("Icon", record.Icon),
    ...(typeof record.Enabled === "boolean" ? { Enabled: record.Enabled } : {}),
    ...optionalString("Kind", record.Kind),
    ...optionalString("BaseUrl", record.BaseUrl),
    ...optionalString("ApiKey", record.ApiKey),
    ...optionalString("ApiVersion", record.ApiVersion),
    ...(headers ? { Headers: headers } : {}),
  };
}

export function normalizeModelGroupDraft(value: unknown): ModelGroupDraft {
  const record = isRecord(value) ? value : {};
  const strategies = Array.isArray(record.Strategies)
    ? record.Strategies.filter(isRecord).map(normalizeModelGroupStrategy)
    : [
        normalizeModelGroupStrategy({
          Match: record.Match,
          Values: record.Values,
        }),
      ];
  return {
    Id: readString(record.Id) ?? "",
    Label: readString(record.Label) ?? "",
    ...optionalString("Icon", record.Icon),
    Strategies: strategies.length > 0 ? strategies : [{ Match: "prefix", Values: [] }],
  };
}

export function normalizeModelGroupStrategy(value: unknown): ModelGroupStrategyDraft {
  const record = isRecord(value) ? value : {};
  return {
    Match: readModelGroupMatch(record.Match),
    Values: readStringArray(record.Values),
  };
}

export function toProviderEndpointInput(provider: ProviderEndpointDraft): ProviderModelEndpointInput {
  const headers = provider.Headers
    ? Object.fromEntries(Object.entries(provider.Headers).filter(([key]) => key.trim()))
    : undefined;
  return {
    Id: provider.Id,
    ...optionalString("Icon", provider.Icon),
    ...(typeof provider.Enabled === "boolean" ? { Enabled: provider.Enabled } : {}),
    ...(provider.Kind === "OpenAICompatible" ? { Kind: "OpenAICompatible" as const } : {}),
    ...optionalString("BaseUrl", provider.BaseUrl),
    ...optionalString("ApiKey", provider.ApiKey),
    ...optionalString("ApiVersion", provider.ApiVersion),
    ...(headers && Object.keys(headers).length > 0 ? { Headers: headers } : {}),
  };
}

export function providerEnabled(provider: ProviderEndpointDraft | null | undefined): boolean {
  return provider?.Enabled !== false;
}

export function providerIdLabel(provider: ProviderEndpointDraft): string {
  return provider.Id;
}

export function sortProviderRows(
  providers: ProviderEndpointDraft[],
): Array<{ provider: ProviderEndpointDraft; index: number }> {
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((left, right) => {
      const enabledDiff = Number(providerEnabled(right.provider)) - Number(providerEnabled(left.provider));
      if (enabledDiff !== 0) return enabledDiff;
      return providerIdLabel(left.provider).localeCompare(providerIdLabel(right.provider), getFrontendLocale());
    });
}

export function normalizeModelProviderDraft(value: unknown): ModelProviderDraft {
  const record = isRecord(value) ? value : {};
  const providerId = readString(record.ProviderId) ?? "";
  const model = readString(record.Model) ?? "";
  const id = readString(record.Id) ?? (providerId && model ? modelConfigId(providerId, model) : "");
  return {
    Id: id,
    ProviderId: providerId,
    ...optionalString("Icon", record.Icon),
    ...optionalCapabilities("Capabilities", record.Capabilities),
    ...optionalToolPlanningMode(record.ToolPlanningMode),
    ...optionalNumber("ContextWindowTokens", record.ContextWindowTokens),
    ...optionalNumber("MaxModelOutputTokens", record.MaxModelOutputTokens),
    Endpoint: readString(record.Endpoint) ?? "",
    Model: model,
    ...optionalNumber("Temperature", record.Temperature),
    ...optionalNumber("MaxOutputTokens", record.MaxOutputTokens),
    ...(typeof record.Stream === "boolean" ? { Stream: record.Stream } : {}),
    ...optionalNumber("TimeoutSeconds", record.TimeoutSeconds),
    ...optionalNumber("FirstTokenTimeoutSeconds", record.FirstTokenTimeoutSeconds),
    ...optionalNumber("MaxRequestSeconds", record.MaxRequestSeconds),
    ...optionalNumber("MaxNetworkRetries", record.MaxNetworkRetries),
    ...optionalNumber("RetryBaseDelaySeconds", record.RetryBaseDelaySeconds),
    ...optionalNumber("RetryMaxDelaySeconds", record.RetryMaxDelaySeconds),
    ...optionalNumber("RetryAfterMaxDelaySeconds", record.RetryAfterMaxDelaySeconds),
    ...optionalNumber("MaxResponseBytes", record.MaxResponseBytes),
    ...optionalNumber("MaxSseEventBytes", record.MaxSseEventBytes),
    ...optionalNumber("MaxSseEvents", record.MaxSseEvents),
  };
}

export function readModelCapabilities(
  model: ModelProviderDraft,
  template: Record<string, unknown>,
  modelsDev?: ModelsDevModelMetadata,
): Required<ModelCapabilitiesDraft> {
  return {
    ...defaultModelCapabilities(template, model.Model, model.ProviderId, modelsDev),
    ...(model.Capabilities ?? {}),
  };
}

export function readModelToolPlanningMode(
  model: Pick<ModelProviderDraft, "ToolPlanningMode">,
  template: Record<string, unknown>,
): ModelToolPlanningMode {
  const configured = model.ToolPlanningMode ?? template.ToolPlanningMode;
  return configured === "baml" ? "baml" : "native";
}

export function defaultModelCapabilities(
  template: Record<string, unknown>,
  modelName?: string,
  providerHint?: string,
  modelsDev?: ModelsDevModelMetadata,
): Required<ModelCapabilitiesDraft> {
  const capabilities = isRecord(template.Capabilities) ? template.Capabilities : {};
  const inferred = inferModelCatalogCapabilities(modelName, providerHint);
  const catalog = readModelsDevCapabilities(modelsDev);
  const defaultCapability = <T extends keyof ModelCapabilitiesDraft>(key: T, fallback: boolean): boolean =>
    catalog[key] ?? readBoolean(capabilities[key]) ?? inferred[key] ?? fallback;
  return {
    Chat: defaultCapability("Chat", true),
    Embedding: defaultCapability("Embedding", false),
    Rerank: defaultCapability("Rerank", false),
    Vision: defaultCapability("Vision", false),
    ImageOutput: defaultCapability("ImageOutput", false),
    Reasoning: defaultCapability("Reasoning", false),
    DeveloperRole: defaultCapability("DeveloperRole", false),
    StreamingUsage: defaultCapability("StreamingUsage", true),
    ToolCalling: defaultCapability("ToolCalling", true),
  };
}

export function filterProviderModels(models: ProviderModelInfo[], search: string): ProviderModelInfo[] {
  const query = search.trim().toLowerCase();
  if (!query) {
    return models;
  }
  return models.filter(
    (model) => model.id.toLowerCase().includes(query) || readProviderModelOwnedBy(model).toLowerCase().includes(query),
  );
}

/**
 * Resolves the owning-provider hint for a catalog row. The models.dev
 * provider id is authoritative when present; the discovery endpoint's
 * owned_by field (rarely populated) and local configuration follow.
 */
export function readProviderModelOwnedBy(model: Pick<ProviderModelInfo, "ownedBy" | "modelsDev">): string {
  return model.modelsDev?.providerId?.trim() || model.ownedBy?.trim() || "";
}

export function readProviderModelRows({
  catalogModels,
  models,
  providerId,
  search,
  configuredOnly,
}: {
  catalogModels: ProviderModelInfo[];
  models: ModelProviderDraft[];
  providerId: string;
  search: string;
  configuredOnly: boolean;
}): ProviderModelInfo[] {
  const configuredRows = projectConfiguredProviderModelRows(models, providerId);
  const mergedRows = mergeProviderModelRows(catalogModels, configuredRows);
  const rows = configuredOnly
    ? filterConfiguredProviderModels({
        rows: mergedRows,
        models,
        providerId,
        configuredOnly,
      })
    : mergedRows;
  return filterProviderModels(rows, search);
}

export function projectConfiguredProviderModelRows(
  models: readonly ModelProviderDraft[],
  providerId: string,
): ProviderModelInfo[] {
  return models
    .filter((model) => model.ProviderId === providerId && model.Model.trim())
    .map((model) => ({
      id: model.Model,
      ownedBy: model.ProviderId || undefined,
    }));
}

export function mergeProviderModelRows(
  catalogRows: readonly ProviderModelInfo[],
  configuredRows: readonly ProviderModelInfo[],
): ProviderModelInfo[] {
  const rows = new Map<string, ProviderModelInfo>();
  for (const row of catalogRows) {
    rows.set(row.id, row);
  }
  for (const row of configuredRows) {
    if (!rows.has(row.id)) {
      rows.set(row.id, row);
    }
  }
  return [...rows.values()];
}

export function filterConfiguredProviderModels({
  rows,
  models,
  providerId,
  configuredOnly,
}: {
  rows: ProviderModelInfo[];
  models: ModelProviderDraft[];
  providerId: string;
  configuredOnly: boolean;
}): ProviderModelInfo[] {
  if (!configuredOnly) {
    return rows;
  }
  const configuredModelNames = new Set(
    models.filter((model) => model.ProviderId === providerId).map((model) => model.Model),
  );
  return rows.filter((row) => configuredModelNames.has(row.id));
}

export function sortProviderModelRows({
  rows,
  models,
  providerId,
  defaultModelId,
}: {
  rows: ProviderModelInfo[];
  models: ModelProviderDraft[];
  providerId: string;
  defaultModelId: string;
}): ProviderModelInfo[] {
  const configuredByName = new Map(
    models.filter((model) => model.ProviderId === providerId).map((model) => [model.Model, model]),
  );
  return rows
    .map((row, index) => ({
      row,
      index,
      configured: configuredByName.get(row.id),
    }))
    .sort((left, right) => {
      const leftDefault = left.configured?.Id === defaultModelId;
      const rightDefault = right.configured?.Id === defaultModelId;
      if (leftDefault !== rightDefault) {
        return leftDefault ? -1 : 1;
      }
      if (Boolean(left.configured) !== Boolean(right.configured)) {
        return left.configured ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function groupProviderModelRows(
  rows: ProviderModelInfo[],
  modelGroups: readonly ModelGroupDraft[],
): ProviderModelGroup[] {
  const defaultGroup = readDefaultModelGroup();
  const groups = new Map<string, ProviderModelGroup>();

  for (const row of rows) {
    const catalogGroup = readModelsDevCatalogGroup(row);
    const rule = catalogGroup ? undefined : findModelGroupRule(row.id, modelGroups, readProviderModelOwnedBy(row));
    const inferred = rule ? undefined : (catalogGroup ?? inferModelGroupForRow(row));
    const groupId = rule?.Id ?? inferred?.id ?? defaultGroup.id;
    const groupLabel = rule?.Label || inferred?.label || defaultGroup.label;
    const groupIcon = rule?.Icon || inferred?.icon || defaultGroup.icon;
    const group = groups.get(groupId) ?? {
      id: groupId,
      label: groupLabel,
      icon: groupIcon,
      rows: [],
    };
    group.rows.push(row);
    groups.set(groupId, group);
  }

  return [...groups.values()];
}

/**
 * Prefers the authoritative models.dev provider id when it resolves to a
 * known provider (for example openai-labs -> Labs); only when the catalog
 * cannot resolve the provider do the local model-name heuristics run.
 */
function readModelsDevCatalogGroup(row: ProviderModelInfo): ModelCatalogGroup | undefined {
  const catalogProviderId = row.modelsDev?.providerId?.trim();
  return catalogProviderId ? inferModelCatalogGroup(undefined, catalogProviderId) : undefined;
}

function inferModelGroupForRow(row: ProviderModelInfo): ModelCatalogGroup | undefined {
  return inferModelCatalogGroup(row.id, row.ownedBy);
}

export function findModelGroupRule(
  modelId: string,
  modelGroups: readonly ModelGroupDraft[],
  providerHint?: string,
): ModelGroupDraft | undefined {
  const sources = [modelId, providerHint]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  return modelGroups.find((rule) =>
    sources.some((source) =>
      rule.Strategies.some((strategy) => modelGroupRuleMatches(strategy.Match, source, strategy.Values)),
    ),
  );
}

export function modelGroupRuleMatches(
  match: ModelProviderRuleMatchKind,
  source: string,
  values: readonly string[],
): boolean {
  return values.some((value) => {
    const normalized = value.toLowerCase();
    switch (match) {
      case "exact":
        return source === normalized;
      case "prefix":
        return source.startsWith(normalized);
      case "suffix":
        return source.endsWith(normalized);
      case "includes":
        return source.includes(normalized);
    }
  });
}

export function modelConfigId(providerId: string, modelName: string): string {
  return `${providerId}/${modelName}`;
}

export function readNumberWithTemplate(
  value: unknown,
  template: Record<string, unknown>,
  key: string,
): number | undefined {
  return readNumber(value) ?? readNumber(template[key]);
}

export function readBooleanWithTemplate(template: Record<string, unknown>, key: string): boolean | undefined {
  return readBoolean(template[key]);
}

export function nextHeaderKey(headers: Record<string, string>): string {
  const base = "Header";
  if (!(base in headers)) {
    return base;
  }
  let index = 2;
  while (`${base}-${index}` in headers) {
    index += 1;
  }
  return `${base}-${index}`;
}

/** 服务端下发的密钥占位符；原样回传表示“保持已保存的值不变”。 */
export function isRedactedConfigSecret(value: string | null | undefined): boolean {
  return value === ConfigSecretContract.RedactedPlaceholder;
}

export function cloneRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? (JSON.parse(JSON.stringify(value)) as Record<string, unknown>) : {};
}

export function optionalString<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, string>> {
  const text = readString(value);
  return text === undefined ? {} : ({ [key]: text } as Partial<Record<TKey, string>>);
}

export function optionalNumber<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, number>> {
  const number = readNumber(value);
  return number === undefined ? {} : ({ [key]: number } as Partial<Record<TKey, number>>);
}

export function optionalCapabilities<TKey extends string>(
  key: TKey,
  value: unknown,
): Partial<Record<TKey, ModelCapabilitiesDraft>> {
  if (!isRecord(value)) {
    return {};
  }
  const capabilities: ModelCapabilitiesDraft = {};
  for (const capability of ModelCapabilityKeys) {
    const enabled = readBoolean(value[capability]);
    if (enabled !== undefined) {
      capabilities[capability] = enabled;
    }
  }
  return { [key]: capabilities } as Partial<Record<TKey, ModelCapabilitiesDraft>>;
}

function optionalToolPlanningMode(value: unknown): Partial<ModelProviderDraft> {
  return value === "native" || value === "baml" ? { ToolPlanningMode: value } : {};
}

export function readModelGroupMatch(value: unknown): ModelProviderRuleMatchKind {
  return ModelGroupMatchKinds.includes(value as ModelProviderRuleMatchKind)
    ? (value as ModelProviderRuleMatchKind)
    : "prefix";
}

export { isRecord, readString };

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => readString(item)).filter((item): item is string => Boolean(item))
    : [];
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export const ModelCapabilityKeys = [
  "Chat",
  "Embedding",
  "Rerank",
  "Vision",
  "ImageOutput",
  "Reasoning",
  "ToolCalling",
  "DeveloperRole",
  "StreamingUsage",
] as const satisfies readonly (keyof ModelCapabilitiesDraft)[];

const ModelGroupMatchKinds = ["prefix", "includes", "exact", "suffix"] as const;
