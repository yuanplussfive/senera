import { applyAgentJsonMergePatch } from "../Core/AgentJsonMergePatch.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  cloneModelProviderConfig,
  remapModelIdReferences,
  removeExactModelGroupAssignments,
  withOptionalDefaultModelId,
} from "./AgentProviderModelConfigTransforms.js";
import type {
  AgentProviderEndpointDeleteInput,
  AgentProviderEndpointRenameInput,
  AgentProviderEndpointUpsertInput,
} from "./AgentProviderModelConfigCommandTypes.js";
import { AgentProviderModelConfigCommandError } from "./AgentProviderModelConfigCommandTypes.js";
import {
  assertConfiguredEndpointIdsUnique,
  assertCustomConfiguredEndpoint,
  assertProviderIdAvailable,
  assertProviderIdChanged,
  assertRenamedModelIdsAvailable,
  buildProviderModelIdRenames,
  mergeModelProviderIdAliases,
  readCurrentDefaultModelId,
  readValidReplacementDefault,
  removeModelProviderIdAliases,
  validateProviderModelInvariants,
} from "./AgentProviderModelConfigInvariants.js";

export function upsertProviderEndpoint(
  config: AgentSystemConfig,
  input: AgentProviderEndpointUpsertInput,
): AgentSystemConfig {
  assertConfiguredEndpointIdsUnique(config);
  const endpoints = config.ModelProviderEndpoints ?? [];
  const endpointId = input.endpoint.Id.trim();
  if (!endpointId) {
    throw new AgentProviderModelConfigCommandError(
      "config.providerEndpointIdRequired",
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
  return validateProviderModelInvariants({ ...config, ModelProviderEndpoints: nextEndpoints });
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
    throw new AgentProviderModelConfigCommandError("config.providerEndpointHasModels", "provider_endpoint_has_models", {
      providerId,
      modelIds: associatedModels.map((model) => model.Id),
    });
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
