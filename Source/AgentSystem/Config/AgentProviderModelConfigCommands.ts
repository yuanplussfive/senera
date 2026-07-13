import { AgentDefaults } from "../AgentDefaults.js";
import type {
  AgentModelGroupConfig,
  AgentModelGroupStrategyConfig,
  AgentModelProviderConfig,
  AgentModelProviderEndpointConfig,
  AgentSystemConfig,
} from "../Types/AgentConfigTypes.js";

export type AgentProviderModelConfigOperationKind =
  | "provider.endpoint.upsert"
  | "provider.endpoint.delete"
  | "provider.endpoint.rename"
  | "provider.model.upsert"
  | "provider.model.delete"
  | "provider.model.bulkImport"
  | "provider.defaultModel.set";

export interface AgentConfigRevisionGuardInput {
  expectedRevision?: number;
  expectedVersion?: number;
  mirrorJson?: boolean;
}

export interface AgentProviderModelGroupAssignmentInput {
  groupId: string;
  label?: string;
  icon?: string;
}

export interface AgentProviderEndpointUpsertInput extends AgentConfigRevisionGuardInput {
  endpoint: AgentModelProviderEndpointConfig;
}

export interface AgentProviderEndpointRenameInput extends AgentConfigRevisionGuardInput {
  providerId: string;
  nextProviderId: string;
}

export interface AgentProviderEndpointDeleteInput extends AgentConfigRevisionGuardInput {
  providerId: string;
  cascadeModels?: boolean;
  replacementDefaultModelId?: string;
}

export interface AgentProviderModelUpsertInput extends AgentConfigRevisionGuardInput {
  model: AgentModelProviderConfig;
  group?: AgentProviderModelGroupAssignmentInput;
}

export interface AgentProviderModelBulkImportGroupAssignmentInput extends AgentProviderModelGroupAssignmentInput {
  modelId: string;
}

export interface AgentProviderModelBulkImportInput extends AgentConfigRevisionGuardInput {
  models: AgentModelProviderConfig[];
  overwriteExisting?: boolean;
  groupAssignments?: AgentProviderModelBulkImportGroupAssignmentInput[];
}

export interface AgentProviderModelDeleteInput extends AgentConfigRevisionGuardInput {
  modelId: string;
  replacementDefaultModelId?: string;
}

export interface AgentDefaultModelSetInput extends AgentConfigRevisionGuardInput {
  modelId: string;
}

const ProtectedProviderIds = new Set(AgentDefaults.ModelProviderEndpoints.map((endpoint) => endpoint.Id));

export class AgentProviderModelConfigCommandError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentProviderModelConfigCommandError";
  }
}

export class AgentConfigStaleWriteError extends Error {
  readonly code = "config_stale_write";

  constructor(
    readonly details: {
      expectedRevision?: number;
      currentRevision?: number;
      expectedVersion?: number;
      currentVersion: number;
    },
  ) {
    super(buildStaleWriteMessage(details));
    this.name = "AgentConfigStaleWriteError";
  }
}

export function assertConfigRevisionGuard(
  input: AgentConfigRevisionGuardInput,
  current: {
    revision?: number;
    version: number;
  },
): void {
  if (current.revision !== undefined) {
    if (input.expectedRevision === current.revision) {
      return;
    }
    throw new AgentConfigStaleWriteError({
      expectedRevision: input.expectedRevision,
      currentRevision: current.revision,
      expectedVersion: input.expectedVersion,
      currentVersion: current.version,
    });
  }

  if (input.expectedVersion === current.version) {
    return;
  }

  throw new AgentConfigStaleWriteError({
    expectedRevision: input.expectedRevision,
    currentRevision: current.revision,
    expectedVersion: input.expectedVersion,
    currentVersion: current.version,
  });
}

export function upsertProviderEndpoint(
  config: AgentSystemConfig,
  input: AgentProviderEndpointUpsertInput,
): AgentSystemConfig {
  assertConfiguredEndpointIdsUnique(config);
  const endpoints = config.ModelProviderEndpoints ?? [];
  const existingIndex = endpoints.findIndex((endpoint) => endpoint.Id === input.endpoint.Id);
  const nextEndpoints =
    existingIndex >= 0
      ? endpoints.map((endpoint, index) => (index === existingIndex ? { ...input.endpoint } : { ...endpoint }))
      : [...endpoints.map((endpoint) => ({ ...endpoint })), { ...input.endpoint }];

  return validateProviderModelInvariants({
    ...config,
    ModelProviderEndpoints: nextEndpoints,
  });
}

export function renameProviderEndpoint(
  config: AgentSystemConfig,
  input: AgentProviderEndpointRenameInput,
): AgentSystemConfig {
  const providerId = input.providerId.trim();
  const nextProviderId = input.nextProviderId.trim();
  assertProviderIdChanged(providerId, nextProviderId);
  assertCustomConfiguredEndpoint(config, providerId, "rename");
  assertProviderIdAvailable(config, nextProviderId);

  const nextConfig = {
    ...config,
    ModelProviderEndpoints: (config.ModelProviderEndpoints ?? []).map((endpoint) =>
      endpoint.Id === providerId ? { ...endpoint, Id: nextProviderId } : { ...endpoint },
    ),
    ModelProviders: config.ModelProviders.map((model) =>
      model.ProviderId === providerId ? { ...model, ProviderId: nextProviderId } : { ...model },
    ),
  };

  return validateProviderModelInvariants(nextConfig);
}

export function deleteProviderEndpoint(
  config: AgentSystemConfig,
  input: AgentProviderEndpointDeleteInput,
): AgentSystemConfig {
  const providerId = input.providerId.trim();
  assertCustomConfiguredEndpoint(config, providerId, "delete");

  const associatedModels = config.ModelProviders.filter((model) => model.ProviderId === providerId);
  if (associatedModels.length > 0 && !input.cascadeModels) {
    throw new AgentProviderModelConfigCommandError(
      `供应商端点仍有关联模型，删除需要 cascadeModels=true：ProviderId=${providerId}`,
      "provider_endpoint_has_models",
      {
        providerId,
        modelIds: associatedModels.map((model) => model.Id),
      },
    );
  }

  const associatedModelIds = new Set(associatedModels.map((model) => model.Id));
  const currentDefaultId = readCurrentDefaultModelId(config);
  const removesDefault = currentDefaultId !== undefined && associatedModelIds.has(currentDefaultId);
  const nextModels =
    associatedModels.length > 0
      ? config.ModelProviders.filter((model) => model.ProviderId !== providerId).map((model) => ({ ...model }))
      : config.ModelProviders.map((model) => ({ ...model }));

  let nextDefaultModelId = config.DefaultModelProviderId;
  if (removesDefault) {
    nextDefaultModelId = readValidReplacementDefault(input.replacementDefaultModelId, nextModels, {
      reason: "delete_provider_endpoint",
      removedId: currentDefaultId,
    });
  }

  const nextConfig = withOptionalDefaultModelId(
    {
      ...config,
      ModelProviderEndpoints: (config.ModelProviderEndpoints ?? [])
        .filter((endpoint) => endpoint.Id !== providerId)
        .map((endpoint) => ({ ...endpoint })),
      ModelProviders: nextModels,
      ModelGroups: removeExactModelGroupAssignments(config.ModelGroups ?? [], associatedModelIds),
    },
    nextDefaultModelId,
  );

  return validateProviderModelInvariants(nextConfig);
}

export function upsertProviderModel(
  config: AgentSystemConfig,
  input: AgentProviderModelUpsertInput,
): AgentSystemConfig {
  assertProviderEndpointExists(config, input.model.ProviderId);
  assertConfiguredModelIdsUnique(config);
  const existingIndex = config.ModelProviders.findIndex((model) => model.Id === input.model.Id);
  const nextModel =
    existingIndex >= 0 ? { ...config.ModelProviders[existingIndex], ...input.model } : { ...input.model };
  const nextModels =
    existingIndex >= 0
      ? config.ModelProviders.map((model, index) => (index === existingIndex ? nextModel : { ...model }))
      : [...config.ModelProviders.map((model) => ({ ...model })), nextModel];
  const nextConfig = applyOptionalGroupAssignment(
    {
      ...config,
      ModelProviders: nextModels,
    },
    nextModel.Id,
    input.group,
  );

  return validateProviderModelInvariants(nextConfig);
}

export function bulkImportProviderModels(
  config: AgentSystemConfig,
  input: AgentProviderModelBulkImportInput,
): AgentSystemConfig {
  for (const model of input.models) {
    assertProviderEndpointExists(config, model.ProviderId);
  }
  assertConfiguredModelIdsUnique(config);

  const importedModelIds = new Set<string>();
  const nextModels = config.ModelProviders.map((model) => ({ ...model }));
  for (const model of input.models) {
    const existingIndex = nextModels.findIndex((candidate) => candidate.Id === model.Id);
    if (existingIndex >= 0) {
      if (input.overwriteExisting) {
        nextModels[existingIndex] = { ...nextModels[existingIndex], ...model };
        importedModelIds.add(model.Id);
      }
      continue;
    }

    nextModels.push({ ...model });
    importedModelIds.add(model.Id);
  }

  let nextConfig: AgentSystemConfig = {
    ...config,
    ModelProviders: nextModels,
  };
  const assignments = input.groupAssignments ?? [];
  for (const assignment of assignments) {
    if (!importedModelIds.has(assignment.modelId)) {
      continue;
    }
    nextConfig = applyOptionalGroupAssignment(nextConfig, assignment.modelId, assignment);
  }

  return validateProviderModelInvariants(nextConfig);
}

export function deleteProviderModel(
  config: AgentSystemConfig,
  input: AgentProviderModelDeleteInput,
): AgentSystemConfig {
  assertConfiguredModelIdsUnique(config);
  const model = config.ModelProviders.find((candidate) => candidate.Id === input.modelId);
  if (!model) {
    throw new AgentProviderModelConfigCommandError(
      `模型配置不存在：ModelProviders[].Id=${input.modelId}`,
      "provider_model_missing",
      { modelId: input.modelId },
    );
  }

  const currentDefaultId = readCurrentDefaultModelId(config);
  const removesDefault = currentDefaultId === input.modelId;
  const nextModels = config.ModelProviders.filter((candidate) => candidate.Id !== input.modelId).map((candidate) => ({
    ...candidate,
  }));

  let nextDefaultModelId = config.DefaultModelProviderId;
  if (removesDefault) {
    nextDefaultModelId = readValidReplacementDefault(input.replacementDefaultModelId, nextModels, {
      reason: "delete_provider_model",
      removedId: input.modelId,
    });
  }

  const nextConfig = withOptionalDefaultModelId(
    {
      ...config,
      ModelProviders: nextModels,
      ModelGroups: removeExactModelGroupAssignments(config.ModelGroups ?? [], new Set([input.modelId])),
    },
    nextDefaultModelId,
  );

  return validateProviderModelInvariants(nextConfig);
}

export function setDefaultProviderModel(
  config: AgentSystemConfig,
  input: AgentDefaultModelSetInput,
): AgentSystemConfig {
  assertConfiguredModelIdsUnique(config);
  assertModelIdExists(config.ModelProviders, input.modelId, "default_model_missing");
  return validateProviderModelInvariants({
    ...config,
    DefaultModelProviderId: input.modelId,
    ModelProviders: config.ModelProviders.map((model) => ({ ...model })),
    ModelProviderEndpoints: config.ModelProviderEndpoints?.map((endpoint) => ({ ...endpoint })),
    ModelGroups: config.ModelGroups?.map(cloneModelGroup),
  });
}

export function validateProviderModelInvariants(config: AgentSystemConfig): AgentSystemConfig {
  assertConfiguredEndpointIdsUnique(config);
  assertConfiguredModelIdsUnique(config);
  assertModelProvidersReferenceExistingEndpoints(config);
  assertDefaultModelProviderIdValid(config);
  return config;
}

function buildStaleWriteMessage(details: AgentConfigStaleWriteError["details"]): string {
  if (details.currentRevision !== undefined) {
    return [
      "配置已被其他写入更新，请刷新后重试。",
      `expectedRevision=${details.expectedRevision ?? "missing"}`,
      `currentRevision=${details.currentRevision}`,
    ].join(" ");
  }
  return [
    "配置已被其他写入更新，请刷新后重试。",
    `expectedVersion=${details.expectedVersion ?? "missing"}`,
    `currentVersion=${details.currentVersion}`,
  ].join(" ");
}

function assertProviderIdChanged(providerId: string, nextProviderId: string): void {
  if (!providerId || !nextProviderId || providerId === nextProviderId) {
    throw new AgentProviderModelConfigCommandError(
      "供应商端点重命名需要不同的非空 Id。",
      "provider_endpoint_rename_invalid",
      { providerId, nextProviderId },
    );
  }
}

function assertProviderIdAvailable(config: AgentSystemConfig, providerId: string): void {
  if (
    ProtectedProviderIds.has(providerId) ||
    (config.ModelProviderEndpoints ?? []).some((endpoint) => endpoint.Id === providerId)
  ) {
    throw new AgentProviderModelConfigCommandError(
      `供应商端点配置已存在：ModelProviderEndpoints[].Id=${providerId}`,
      "provider_endpoint_duplicate",
      { providerId },
    );
  }
}

function assertCustomConfiguredEndpoint(
  config: AgentSystemConfig,
  providerId: string,
  operation: "rename" | "delete",
): void {
  if (ProtectedProviderIds.has(providerId)) {
    throw new AgentProviderModelConfigCommandError(
      `内置供应商端点不能${operation === "rename" ? "重命名" : "删除"}：ProviderId=${providerId}`,
      "provider_endpoint_protected",
      { providerId, operation },
    );
  }

  if (!(config.ModelProviderEndpoints ?? []).some((endpoint) => endpoint.Id === providerId)) {
    throw new AgentProviderModelConfigCommandError(
      `供应商端点配置不存在：ProviderId=${providerId}`,
      "provider_endpoint_missing",
      { providerId },
    );
  }
}

function assertProviderEndpointExists(config: AgentSystemConfig, providerId: string): void {
  if (readProviderEndpointIds(config).has(providerId)) {
    return;
  }
  throw new AgentProviderModelConfigCommandError(
    `供应商端点配置不存在：ProviderId=${providerId}`,
    "provider_endpoint_missing",
    { providerId },
  );
}

function readProviderEndpointIds(config: AgentSystemConfig): Set<string> {
  return new Set([
    ...AgentDefaults.ModelProviderEndpoints.map((endpoint) => endpoint.Id),
    ...(config.ModelProviderEndpoints ?? []).map((endpoint) => endpoint.Id),
  ]);
}

function assertConfiguredEndpointIdsUnique(config: AgentSystemConfig): void {
  const ids = new Set<string>();
  for (const endpoint of config.ModelProviderEndpoints ?? []) {
    if (ids.has(endpoint.Id)) {
      throw new AgentProviderModelConfigCommandError(
        `供应商端点配置重复：ModelProviderEndpoints[].Id=${endpoint.Id}`,
        "provider_endpoint_duplicate",
        { providerId: endpoint.Id },
      );
    }
    ids.add(endpoint.Id);
  }
}

function assertConfiguredModelIdsUnique(config: AgentSystemConfig): void {
  const ids = new Set<string>();
  for (const model of config.ModelProviders) {
    if (ids.has(model.Id)) {
      throw new AgentProviderModelConfigCommandError(
        `模型配置重复：ModelProviders[].Id=${model.Id}`,
        "provider_model_duplicate",
        { modelId: model.Id },
      );
    }
    ids.add(model.Id);
  }
}

function assertModelProvidersReferenceExistingEndpoints(config: AgentSystemConfig): void {
  const endpointIds = readProviderEndpointIds(config);
  for (const model of config.ModelProviders) {
    if (!endpointIds.has(model.ProviderId)) {
      throw new AgentProviderModelConfigCommandError(
        `供应商端点配置不存在：ProviderId=${model.ProviderId}`,
        "provider_endpoint_missing",
        { providerId: model.ProviderId, modelId: model.Id },
      );
    }
  }
}

function assertDefaultModelProviderIdValid(config: AgentSystemConfig): void {
  if (config.ModelProviders.length === 0) {
    throw new AgentProviderModelConfigCommandError("至少需要保留一个模型配置。", "provider_model_empty");
  }

  if (config.DefaultModelProviderId !== undefined) {
    assertModelIdExists(config.ModelProviders, config.DefaultModelProviderId, "default_model_missing");
  }
}

function assertModelIdExists(models: readonly AgentModelProviderConfig[], modelId: string, code: string): void {
  if (models.some((model) => model.Id === modelId)) {
    return;
  }
  throw new AgentProviderModelConfigCommandError(`默认模型配置不存在：DefaultModelProviderId=${modelId}`, code, {
    modelId,
  });
}

function readCurrentDefaultModelId(config: AgentSystemConfig): string | undefined {
  return config.DefaultModelProviderId ?? config.ModelProviders[0]?.Id;
}

function readValidReplacementDefault(
  replacementDefaultModelId: string | undefined,
  nextModels: readonly AgentModelProviderConfig[],
  details: {
    reason: string;
    removedId: string;
  },
): string {
  if (!replacementDefaultModelId) {
    throw new AgentProviderModelConfigCommandError(
      `删除当前默认模型需要 replacementDefaultModelId：DefaultModelProviderId=${details.removedId}`,
      "replacement_default_required",
      details,
    );
  }
  assertModelIdExists(nextModels, replacementDefaultModelId, "replacement_default_missing");
  return replacementDefaultModelId;
}

function withOptionalDefaultModelId(config: AgentSystemConfig, defaultModelId: string | undefined): AgentSystemConfig {
  const nextConfig = {
    ...config,
    ModelProviderEndpoints: config.ModelProviderEndpoints?.map((endpoint) => ({ ...endpoint })),
    ModelProviders: config.ModelProviders.map((model) => ({ ...model })),
    ModelGroups: config.ModelGroups?.map(cloneModelGroup),
  };
  if (defaultModelId === undefined) {
    delete nextConfig.DefaultModelProviderId;
  } else {
    nextConfig.DefaultModelProviderId = defaultModelId;
  }
  return nextConfig;
}

function applyOptionalGroupAssignment(
  config: AgentSystemConfig,
  modelId: string,
  assignment: AgentProviderModelGroupAssignmentInput | undefined,
): AgentSystemConfig {
  if (!assignment) {
    return config;
  }

  const groups = removeExactModelGroupAssignments(config.ModelGroups ?? [], modelId);
  const targetIndex = groups.findIndex((group) => group.Id === assignment.groupId);
  const target =
    targetIndex >= 0
      ? addExactModelGroupAssignment(groups[targetIndex], modelId, assignment)
      : {
          Id: assignment.groupId,
          Label: assignment.label ?? assignment.groupId,
          Icon: assignment.icon,
          Strategies: [
            {
              Match: "exact" as const,
              Values: [modelId],
            },
          ],
        };

  const nextGroups =
    targetIndex >= 0 ? groups.map((group, index) => (index === targetIndex ? target : group)) : [...groups, target];

  return {
    ...config,
    ModelGroups: nextGroups,
  };
}

function removeExactModelGroupAssignments(
  groups: readonly AgentModelGroupConfig[],
  modelIds: string | ReadonlySet<string>,
): AgentModelGroupConfig[] {
  const ids = typeof modelIds === "string" ? new Set([modelIds]) : modelIds;
  return groups.map((group) => {
    const nextGroup = cloneModelGroup(group);
    if (nextGroup.Match === "exact" && nextGroup.Values) {
      nextGroup.Values = nextGroup.Values.filter((value) => !ids.has(value));
    }
    if (nextGroup.Strategies) {
      nextGroup.Strategies = nextGroup.Strategies.map((strategy) =>
        strategy.Match === "exact"
          ? {
              ...strategy,
              Values: strategy.Values.filter((value) => !ids.has(value)),
            }
          : strategy,
      ).filter((strategy) => strategy.Match !== "exact" || strategy.Values.length > 0);
    }
    return nextGroup;
  });
}

function addExactModelGroupAssignment(
  group: AgentModelGroupConfig,
  modelId: string,
  assignment: AgentProviderModelGroupAssignmentInput,
): AgentModelGroupConfig {
  const nextGroup = {
    ...cloneModelGroup(group),
    Label: assignment.label ?? group.Label,
    Icon: assignment.icon ?? group.Icon,
  };

  const strategies = nextGroup.Strategies ? [...nextGroup.Strategies] : [];
  const exactIndex = strategies.findIndex((strategy) => strategy.Match === "exact");
  if (exactIndex >= 0) {
    strategies[exactIndex] = addModelIdToStrategy(strategies[exactIndex], modelId);
  } else {
    strategies.push({
      Match: "exact",
      Values: [modelId],
    });
  }
  nextGroup.Strategies = strategies;
  return nextGroup;
}

function addModelIdToStrategy(strategy: AgentModelGroupStrategyConfig, modelId: string): AgentModelGroupStrategyConfig {
  return strategy.Values.includes(modelId)
    ? { ...strategy, Values: [...strategy.Values] }
    : { ...strategy, Values: [...strategy.Values, modelId] };
}

function cloneModelGroup(group: AgentModelGroupConfig): AgentModelGroupConfig {
  return {
    ...group,
    Values: group.Values ? [...group.Values] : undefined,
    Strategies: group.Strategies?.map((strategy) => ({
      ...strategy,
      Values: [...strategy.Values],
    })),
  };
}
