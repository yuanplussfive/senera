import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  applyOptionalGroupAssignment,
  cloneModelGroup,
  cloneModelProviderConfig,
  removeExactModelGroupAssignments,
  withOptionalDefaultModelId,
} from "./AgentProviderModelConfigTransforms.js";
import type {
  AgentDefaultModelSetInput,
  AgentProviderModelBulkImportInput,
  AgentProviderModelDeleteInput,
  AgentProviderModelUpsertInput,
} from "./AgentProviderModelConfigCommandTypes.js";
import { AgentProviderModelConfigCommandError } from "./AgentProviderModelConfigCommandTypes.js";
import {
  assertConfiguredModelIdsUnique,
  assertModelIdExists,
  assertProviderEndpointExists,
  readCurrentDefaultModelId,
  readValidReplacementDefault,
  removeModelProviderIdAliases,
  validateProviderModelInvariants,
} from "./AgentProviderModelConfigInvariants.js";

export function upsertProviderModel(
  config: AgentSystemConfig,
  input: AgentProviderModelUpsertInput,
): AgentSystemConfig {
  assertProviderEndpointExists(config, input.model.ProviderId);
  assertConfiguredModelIdsUnique(config);
  const existingIndex = config.ModelProviders.findIndex((model) => model.Id === input.model.Id);
  const nextModel = cloneModelProviderConfig(input.model);
  const nextModels =
    existingIndex >= 0
      ? config.ModelProviders.map((model, index) =>
          index === existingIndex ? nextModel : cloneModelProviderConfig(model),
        )
      : [...config.ModelProviders.map(cloneModelProviderConfig), nextModel];
  const nextConfig = applyOptionalGroupAssignment({ ...config, ModelProviders: nextModels }, nextModel.Id, input.group);
  return validateProviderModelInvariants(nextConfig);
}

export function bulkImportProviderModels(
  config: AgentSystemConfig,
  input: AgentProviderModelBulkImportInput,
): AgentSystemConfig {
  for (const model of input.models) assertProviderEndpointExists(config, model.ProviderId);
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
  let nextConfig: AgentSystemConfig = { ...config, ModelProviders: nextModels };
  for (const assignment of input.groupAssignments ?? []) {
    if (importedModelIds.has(assignment.modelId)) {
      nextConfig = applyOptionalGroupAssignment(nextConfig, assignment.modelId, assignment);
    }
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
    throw new AgentProviderModelConfigCommandError("config.providerModelMissing", "provider_model_missing", {
      modelId: input.modelId,
    });
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
