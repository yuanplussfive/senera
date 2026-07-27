import { AgentDefaults, resolveModelProviderEndpointConfigs } from "../AgentDefaults.js";
import { applyAgentJsonMergePatch } from "../Core/AgentJsonMergePatch.js";
import type { AgentProviderEndpointPatch } from "./AgentConfigCommandSchemas.js";
import type { AgentModelProviderConfig, AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  applyOptionalGroupAssignment,
  cloneModelGroup,
  cloneModelProviderConfig,
  remapModelIdReferences,
  removeExactModelGroupAssignments,
  withOptionalDefaultModelId,
} from "./AgentProviderModelConfigTransforms.js";

export type AgentProviderModelConfigOperationKind =
  | "provider.endpoint.upsert"
  | "provider.endpoint.delete"
  | "provider.endpoint.rename"
  | "provider.model.upsert"
  | "provider.model.delete"
  | "provider.model.bulkImport"
  | "provider.defaultModel.set";

export interface AgentConfigRevisionGuardInput {
  baseRevision?: number;
  baseVersion?: number;
}

export interface AgentConfigCommandInput {
  commandId: string;
}

export interface AgentProviderModelGroupAssignmentInput {
  groupId: string;
  label?: string;
  icon?: string;
}

export interface AgentProviderEndpointUpsertInput extends AgentConfigCommandInput {
  endpoint: AgentProviderEndpointPatch;
}

export interface AgentProviderEndpointRenameInput extends AgentConfigCommandInput {
  providerId: string;
  nextProviderId: string;
}

export interface AgentProviderEndpointDeleteInput extends AgentConfigCommandInput {
  providerId: string;
  cascadeModels?: boolean;
  replacementDefaultModelId?: string;
}

export interface AgentProviderModelUpsertInput extends AgentConfigCommandInput {
  /** Complete replacement for an existing model with the same Id. */
  model: AgentModelProviderConfig;
  group?: AgentProviderModelGroupAssignmentInput;
}

export interface AgentProviderModelBulkImportGroupAssignmentInput extends AgentProviderModelGroupAssignmentInput {
  modelId: string;
}

export interface AgentProviderModelBulkImportInput extends AgentConfigCommandInput {
  /** Complete model definitions. Existing Ids are skipped unless overwriteExisting is true. */
  models: AgentModelProviderConfig[];
  /** Completely replace models with matching Ids instead of skipping them. */
  overwriteExisting?: boolean;
  groupAssignments?: AgentProviderModelBulkImportGroupAssignmentInput[];
}

export interface AgentProviderModelDeleteInput extends AgentConfigCommandInput {
  modelId: string;
  replacementDefaultModelId?: string;
}

export interface AgentDefaultModelSetInput extends AgentConfigCommandInput {
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
      baseRevision?: number;
      currentRevision?: number;
      baseVersion?: number;
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
    if (input.baseRevision === current.revision) {
      return;
    }
    throw new AgentConfigStaleWriteError({
      baseRevision: input.baseRevision,
      currentRevision: current.revision,
      baseVersion: input.baseVersion,
      currentVersion: current.version,
    });
  }

  if (input.baseVersion === current.version) {
    return;
  }

  throw new AgentConfigStaleWriteError({
    baseRevision: input.baseRevision,
    currentRevision: current.revision,
    baseVersion: input.baseVersion,
    currentVersion: current.version,
  });
}

export function upsertProviderEndpoint(
  config: AgentSystemConfig,
  input: AgentProviderEndpointUpsertInput,
): AgentSystemConfig {
  assertConfiguredEndpointIdsUnique(config);
  const endpoints = config.ModelProviderEndpoints ?? [];
  // Trim the id like rename/delete do — otherwise a whitespace-padded id can be
  // created here but never renamed or deleted again.
  const endpointId = input.endpoint.Id.trim();
  if (!endpointId) {
    throw new AgentProviderModelConfigCommandError(
      "供应商端点 ID 不能为空：ModelProviderEndpoints[].Id",
      "provider_endpoint_id_required",
      {},
    );
  }
  const existingIndex = endpoints.findIndex((endpoint) => endpoint.Id === endpointId);
  const { Id, ...patch } = input.endpoint;
  void Id;
  const nextEndpoint = applyAgentJsonMergePatch(
    existingIndex >= 0 ? endpoints[existingIndex] : { Id: endpointId },
    patch,
  );
  const nextEndpoints =
    existingIndex >= 0
      ? endpoints.map((endpoint, index) => (index === existingIndex ? nextEndpoint : { ...endpoint }))
      : [...endpoints.map((endpoint) => ({ ...endpoint })), nextEndpoint];

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

  const modelIdRenames = buildProviderModelIdRenames(config.ModelProviders, providerId, nextProviderId);
  assertRenamedModelIdsAvailable(config.ModelProviders, modelIdRenames);

  const nextConfig = remapModelIdReferences(
    {
      ...config,
      ModelProviderEndpoints: (config.ModelProviderEndpoints ?? []).map((endpoint) =>
        endpoint.Id === providerId ? { ...endpoint, Id: nextProviderId } : { ...endpoint },
      ),
      ModelProviders: config.ModelProviders.map((model) =>
        model.ProviderId === providerId
          ? {
              ...cloneModelProviderConfig(model),
              Id: modelIdRenames.get(model.Id) ?? model.Id,
              ProviderId: nextProviderId,
            }
          : cloneModelProviderConfig(model),
      ),
      ModelProviderIdAliases: mergeModelProviderIdAliases(config.ModelProviderIdAliases, modelIdRenames),
    },
    modelIdRenames,
  );

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
      ? config.ModelProviders.filter((model) => model.ProviderId !== providerId).map(cloneModelProviderConfig)
      : config.ModelProviders.map(cloneModelProviderConfig);

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
      ModelProviderIdAliases: removeModelProviderIdAliases(config.ModelProviderIdAliases, associatedModelIds),
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
  // Full-replacement semantics: the client always submits the complete model,
  // so omitted optional fields mean "cleared" (fall back to runtime defaults).
  // Merging here would make overrides impossible to remove — the merge spread
  // silently kept the stored value for every omitted key.
  const nextModel = cloneModelProviderConfig(input.model);
  const nextModels =
    existingIndex >= 0
      ? config.ModelProviders.map((model, index) =>
          index === existingIndex ? nextModel : cloneModelProviderConfig(model),
        )
      : [...config.ModelProviders.map(cloneModelProviderConfig), nextModel];
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
  const nextModels = config.ModelProviders.map(cloneModelProviderConfig);
  for (const model of input.models) {
    const existingIndex = nextModels.findIndex((candidate) => candidate.Id === model.Id);
    if (existingIndex >= 0) {
      if (input.overwriteExisting) {
        nextModels[existingIndex] = cloneModelProviderConfig(model);
        importedModelIds.add(model.Id);
      }
      continue;
    }

    nextModels.push(cloneModelProviderConfig(model));
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
  const nextModels = config.ModelProviders.filter((candidate) => candidate.Id !== input.modelId).map(
    cloneModelProviderConfig,
  );

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
      ModelProviderIdAliases: removeModelProviderIdAliases(config.ModelProviderIdAliases, new Set([input.modelId])),
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
    ModelProviders: config.ModelProviders.map(cloneModelProviderConfig),
    ModelProviderEndpoints: config.ModelProviderEndpoints?.map((endpoint) => ({ ...endpoint })),
    ModelGroups: config.ModelGroups?.map(cloneModelGroup),
  });
}

export function validateProviderModelInvariants(config: AgentSystemConfig): AgentSystemConfig {
  assertConfiguredEndpointIdsUnique(config);
  assertConfiguredModelIdsUnique(config);
  assertModelProvidersReferenceExistingEndpoints(config);
  assertDefaultModelProviderIdValid(config);
  assertModelProviderIdAliasesValid(config);
  return config;
}

function buildStaleWriteMessage(details: AgentConfigStaleWriteError["details"]): string {
  if (details.currentRevision !== undefined) {
    return [
      "配置已被其他写入更新，请刷新后重试。",
      `baseRevision=${details.baseRevision ?? "missing"}`,
      `currentRevision=${details.currentRevision}`,
    ].join(" ");
  }
  return [
    "配置已被其他写入更新，请刷新后重试。",
    `baseVersion=${details.baseVersion ?? "missing"}`,
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

function buildProviderModelIdRenames(
  models: readonly AgentModelProviderConfig[],
  providerId: string,
  nextProviderId: string,
): Map<string, string> {
  const prefix = `${providerId}/`;
  return new Map(
    models
      .filter((model) => model.ProviderId === providerId && model.Id.startsWith(prefix))
      .map((model) => [model.Id, `${nextProviderId}/${model.Id.slice(prefix.length)}`]),
  );
}

function assertRenamedModelIdsAvailable(
  models: readonly AgentModelProviderConfig[],
  modelIdRenames: ReadonlyMap<string, string>,
): void {
  const nextIds = new Map<string, string>();
  for (const model of models) {
    const nextId = modelIdRenames.get(model.Id) ?? model.Id;
    const conflictingModelId = nextIds.get(nextId);
    if (conflictingModelId !== undefined) {
      throw new AgentProviderModelConfigCommandError(
        `供应商重命名后的模型 ID 冲突：ModelProviders[].Id=${nextId}`,
        "provider_model_rename_conflict",
        {
          modelId: model.Id,
          conflictingModelId,
          nextModelId: nextId,
        },
      );
    }
    nextIds.set(nextId, model.Id);
  }
}

function assertModelProviderIdAliasesValid(config: AgentSystemConfig): void {
  const modelIds = new Set(config.ModelProviders.map((model) => model.Id));
  for (const alias of Object.keys(config.ModelProviderIdAliases ?? {})) {
    resolveModelProviderIdAlias(alias, config.ModelProviderIdAliases ?? {}, modelIds);
  }
}

function resolveModelProviderIdAlias(
  modelId: string,
  aliases: Readonly<Record<string, string>>,
  modelIds: ReadonlySet<string>,
): string {
  if (modelIds.has(modelId)) {
    return modelId;
  }

  const visited = new Set<string>();
  let current = modelId;
  while (!modelIds.has(current)) {
    if (visited.has(current)) {
      throw new AgentProviderModelConfigCommandError(
        `模型 ID 兼容别名存在循环：ModelProviderIdAliases.${modelId}`,
        "provider_model_alias_cycle",
        { modelId, aliasChain: [...visited, current] },
      );
    }
    visited.add(current);
    const next = aliases[current];
    if (!next) {
      throw new AgentProviderModelConfigCommandError(
        `模型 ID 兼容别名目标不存在：ModelProviderIdAliases.${modelId}=${current}`,
        "provider_model_alias_target_missing",
        { modelId, missingModelId: current, aliasChain: [...visited] },
      );
    }
    current = next;
  }
  return current;
}

function mergeModelProviderIdAliases(
  aliases: Readonly<Record<string, string>> | undefined,
  modelIdRenames: ReadonlyMap<string, string>,
): Record<string, string> | undefined {
  const nextAliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(aliases ?? {})) {
    const nextTarget = modelIdRenames.get(target) ?? target;
    if (alias !== nextTarget) {
      nextAliases[alias] = nextTarget;
    }
  }
  for (const [previousId, nextId] of modelIdRenames) {
    nextAliases[previousId] = nextId;
  }
  return Object.keys(nextAliases).length > 0 ? nextAliases : undefined;
}

function removeModelProviderIdAliases(
  aliases: Readonly<Record<string, string>> | undefined,
  removedModelIds: ReadonlySet<string>,
): Record<string, string> | undefined {
  if (!aliases) {
    return undefined;
  }

  const nextAliases = Object.fromEntries(
    Object.entries(aliases).filter(([alias]) => !aliasResolvesToAny(alias, aliases, removedModelIds)),
  );
  return Object.keys(nextAliases).length > 0 ? nextAliases : undefined;
}

function aliasResolvesToAny(
  alias: string,
  aliases: Readonly<Record<string, string>>,
  modelIds: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>();
  let current = alias;
  while (!visited.has(current)) {
    if (modelIds.has(current)) {
      return true;
    }
    visited.add(current);
    const next = aliases[current];
    if (!next) {
      return false;
    }
    current = next;
  }
  return false;
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

  if (config.DefaultModelProviderId === undefined) {
    return;
  }

  const model = assertModelIdExists(config.ModelProviders, config.DefaultModelProviderId, "default_model_missing");
  if (!model.Model.trim()) {
    throw new AgentProviderModelConfigCommandError(
      `默认模型名称不能为空：DefaultModelProviderId=${model.Id}`,
      "default_model_name_empty",
      { modelId: model.Id, providerId: model.ProviderId },
    );
  }

  const endpoint = resolveModelProviderEndpointConfigs(config).find((candidate) => candidate.Id === model.ProviderId);
  if (!endpoint) {
    throw new AgentProviderModelConfigCommandError(
      `供应商端点配置不存在：ProviderId=${model.ProviderId}`,
      "provider_endpoint_missing",
      { modelId: model.Id, providerId: model.ProviderId },
    );
  }
  if (!endpoint.Enabled) {
    throw new AgentProviderModelConfigCommandError(
      `默认模型对应的供应商端点已禁用：ProviderId=${endpoint.Id}`,
      "default_model_provider_disabled",
      { modelId: model.Id, providerId: endpoint.Id },
    );
  }
  if (!endpoint.BaseUrl.trim()) {
    throw new AgentProviderModelConfigCommandError(
      `默认模型对应的供应商端点地址不能为空：ProviderId=${endpoint.Id}`,
      "default_model_provider_base_url_empty",
      { modelId: model.Id, providerId: endpoint.Id },
    );
  }
}

function assertModelIdExists(
  models: readonly AgentModelProviderConfig[],
  modelId: string,
  code: string,
): AgentModelProviderConfig {
  const model = models.find((candidate) => candidate.Id === modelId);
  if (model) {
    return model;
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
