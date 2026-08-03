import { AgentDefaults, resolveModelProviderEndpointConfigs } from "../AgentDefaults.js";
import type { AgentModelProviderConfig, AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentProviderModelConfigCommandError } from "./AgentProviderModelConfigCommandTypes.js";

const ProtectedProviderIds = new Set(AgentDefaults.ModelProviderEndpoints.map((endpoint) => endpoint.Id));

export function validateProviderModelInvariants(config: AgentSystemConfig): AgentSystemConfig {
  assertConfiguredEndpointIdsUnique(config);
  assertConfiguredModelIdsUnique(config);
  assertModelProvidersReferenceExistingEndpoints(config);
  assertDefaultModelProviderIdValid(config);
  assertModelProviderIdAliasesValid(config);
  return config;
}

export function assertProviderIdChanged(providerId: string, nextProviderId: string): void {
  if (!providerId || !nextProviderId || providerId === nextProviderId) {
    throw new AgentProviderModelConfigCommandError(
      "config.providerEndpointRenameInvalid",
      "provider_endpoint_rename_invalid",
      { providerId, nextProviderId },
    );
  }
}

export function assertProviderIdAvailable(config: AgentSystemConfig, providerId: string): void {
  if (
    ProtectedProviderIds.has(providerId) ||
    (config.ModelProviderEndpoints ?? []).some((endpoint) => endpoint.Id === providerId)
  ) {
    throw new AgentProviderModelConfigCommandError("config.providerEndpointDuplicate", "provider_endpoint_duplicate", {
      providerId,
    });
  }
}

export function assertCustomConfiguredEndpoint(
  config: AgentSystemConfig,
  providerId: string,
  operation: "rename" | "delete",
): void {
  if (ProtectedProviderIds.has(providerId)) {
    throw new AgentProviderModelConfigCommandError(
      operation === "rename" ? "config.providerEndpointProtectedRename" : "config.providerEndpointProtectedDelete",
      "provider_endpoint_protected",
      { providerId, operation },
    );
  }
  if (!(config.ModelProviderEndpoints ?? []).some((endpoint) => endpoint.Id === providerId)) {
    throw new AgentProviderModelConfigCommandError("config.providerEndpointMissing", "provider_endpoint_missing", {
      providerId,
    });
  }
}

export function assertProviderEndpointExists(config: AgentSystemConfig, providerId: string): void {
  if (readProviderEndpointIds(config).has(providerId)) return;
  throw new AgentProviderModelConfigCommandError("config.providerEndpointMissing", "provider_endpoint_missing", {
    providerId,
  });
}

export function assertConfiguredEndpointIdsUnique(config: AgentSystemConfig): void {
  const ids = new Set<string>();
  for (const endpoint of config.ModelProviderEndpoints ?? []) {
    if (ids.has(endpoint.Id)) {
      throw new AgentProviderModelConfigCommandError(
        "config.providerEndpointDuplicate",
        "provider_endpoint_duplicate",
        { providerId: endpoint.Id },
      );
    }
    ids.add(endpoint.Id);
  }
}

export function assertConfiguredModelIdsUnique(config: AgentSystemConfig): void {
  const ids = new Set<string>();
  for (const model of config.ModelProviders) {
    if (ids.has(model.Id)) {
      throw new AgentProviderModelConfigCommandError("config.providerModelDuplicate", "provider_model_duplicate", {
        modelId: model.Id,
      });
    }
    ids.add(model.Id);
  }
}

export function buildProviderModelIdRenames(
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

export function assertRenamedModelIdsAvailable(
  models: readonly AgentModelProviderConfig[],
  modelIdRenames: ReadonlyMap<string, string>,
): void {
  const nextIds = new Map<string, string>();
  for (const model of models) {
    const nextId = modelIdRenames.get(model.Id) ?? model.Id;
    const conflictingModelId = nextIds.get(nextId);
    if (conflictingModelId !== undefined) {
      throw new AgentProviderModelConfigCommandError(
        "config.providerModelRenameConflict",
        "provider_model_rename_conflict",
        { modelId: model.Id, conflictingModelId, nextModelId: nextId },
      );
    }
    nextIds.set(nextId, model.Id);
  }
}

export function mergeModelProviderIdAliases(
  aliases: Readonly<Record<string, string>> | undefined,
  modelIdRenames: ReadonlyMap<string, string>,
): Record<string, string> | undefined {
  const nextAliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(aliases ?? {})) {
    const nextTarget = modelIdRenames.get(target) ?? target;
    if (alias !== nextTarget) nextAliases[alias] = nextTarget;
  }
  for (const [previousId, nextId] of modelIdRenames) nextAliases[previousId] = nextId;
  return Object.keys(nextAliases).length > 0 ? nextAliases : undefined;
}

export function removeModelProviderIdAliases(
  aliases: Readonly<Record<string, string>> | undefined,
  removedModelIds: ReadonlySet<string>,
): Record<string, string> | undefined {
  if (!aliases) return undefined;
  const nextAliases = Object.fromEntries(
    Object.entries(aliases).filter(([alias]) => !aliasResolvesToAny(alias, aliases, removedModelIds)),
  );
  return Object.keys(nextAliases).length > 0 ? nextAliases : undefined;
}

export function assertModelIdExists(
  models: readonly AgentModelProviderConfig[],
  modelId: string,
  code: string,
): AgentModelProviderConfig {
  const model = models.find((candidate) => candidate.Id === modelId);
  if (model) return model;
  throw new AgentProviderModelConfigCommandError("config.defaultModelMissing", code, {
    modelId,
  });
}

export function readCurrentDefaultModelId(config: AgentSystemConfig): string | undefined {
  return config.DefaultModelProviderId ?? config.ModelProviders[0]?.Id;
}

export function readValidReplacementDefault(
  replacementDefaultModelId: string | undefined,
  nextModels: readonly AgentModelProviderConfig[],
  details: { reason: string; removedId: string },
): string {
  if (!replacementDefaultModelId) {
    throw new AgentProviderModelConfigCommandError(
      "config.replacementDefaultRequired",
      "replacement_default_required",
      details,
    );
  }
  assertModelIdExists(nextModels, replacementDefaultModelId, "replacement_default_missing");
  return replacementDefaultModelId;
}

function readProviderEndpointIds(config: AgentSystemConfig): Set<string> {
  return new Set([
    ...AgentDefaults.ModelProviderEndpoints.map((endpoint) => endpoint.Id),
    ...(config.ModelProviderEndpoints ?? []).map((endpoint) => endpoint.Id),
  ]);
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
  if (modelIds.has(modelId)) return modelId;
  const visited = new Set<string>();
  let current = modelId;
  while (!modelIds.has(current)) {
    if (visited.has(current)) {
      throw new AgentProviderModelConfigCommandError("config.providerModelAliasCycle", "provider_model_alias_cycle", {
        modelId,
        aliasChain: [...visited, current],
      });
    }
    visited.add(current);
    const next = aliases[current];
    if (!next) {
      throw new AgentProviderModelConfigCommandError(
        "config.providerModelAliasTargetMissing",
        "provider_model_alias_target_missing",
        { modelId, missingModelId: current, aliasChain: [...visited] },
      );
    }
    current = next;
  }
  return current;
}

function aliasResolvesToAny(
  alias: string,
  aliases: Readonly<Record<string, string>>,
  modelIds: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>();
  let current = alias;
  while (!visited.has(current)) {
    if (modelIds.has(current)) return true;
    visited.add(current);
    const next = aliases[current];
    if (!next) return false;
    current = next;
  }
  return false;
}

function assertModelProvidersReferenceExistingEndpoints(config: AgentSystemConfig): void {
  const endpointIds = readProviderEndpointIds(config);
  for (const model of config.ModelProviders) {
    if (!endpointIds.has(model.ProviderId)) {
      throw new AgentProviderModelConfigCommandError("config.providerEndpointMissing", "provider_endpoint_missing", {
        providerId: model.ProviderId,
        modelId: model.Id,
      });
    }
  }
}

function assertDefaultModelProviderIdValid(config: AgentSystemConfig): void {
  if (config.ModelProviders.length === 0) {
    throw new AgentProviderModelConfigCommandError("config.providerModelEmpty", "provider_model_empty");
  }
  if (config.DefaultModelProviderId === undefined) return;
  const model = assertModelIdExists(config.ModelProviders, config.DefaultModelProviderId, "default_model_missing");
  if (!model.Model.trim()) {
    throw new AgentProviderModelConfigCommandError("config.defaultModelNameEmpty", "default_model_name_empty", {
      modelId: model.Id,
      providerId: model.ProviderId,
    });
  }
  const endpoint = resolveModelProviderEndpointConfigs(config).find((candidate) => candidate.Id === model.ProviderId);
  if (!endpoint) {
    throw new AgentProviderModelConfigCommandError("config.providerEndpointMissing", "provider_endpoint_missing", {
      modelId: model.Id,
      providerId: model.ProviderId,
    });
  }
  if (!endpoint.Enabled) {
    throw new AgentProviderModelConfigCommandError(
      "config.defaultModelProviderDisabled",
      "default_model_provider_disabled",
      { modelId: model.Id, providerId: endpoint.Id },
    );
  }
  if (!endpoint.BaseUrl.trim()) {
    throw new AgentProviderModelConfigCommandError(
      "config.defaultModelProviderBaseUrlEmpty",
      "default_model_provider_base_url_empty",
      { modelId: model.Id, providerId: endpoint.Id },
    );
  }
}
