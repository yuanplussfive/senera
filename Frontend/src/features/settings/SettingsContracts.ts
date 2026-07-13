import type {
  ConfigMutationState,
  ConfigSnapshotData,
  ProviderModelEndpointInput,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../api/eventTypes";
import type { ConfigMutationController } from "../../app/useConfigMutationController";
import type { ProviderEndpointDeleteOptions } from "../../app/providerEndpointMutations";
import type {
  ProviderModelDeleteInput,
  ProviderModelUpsertInput,
} from "../../app/providerModelMutations";

export interface SettingsConfigCommands {
  configSnapshot: ConfigSnapshotData | null;
  configOperation: ConfigMutationState | null;
  providerEndpointOperations: Record<string, ConfigMutationState>;
  providerModelOperations: Record<string, ConfigMutationState>;
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  providerModelLoadingIds: Record<string, boolean>;
  refreshConfig: () => void;
  saveConfig: (config: Record<string, unknown>) => string | null;
  fetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
  upsertProviderEndpoint: (endpoint: ProviderModelEndpointInput) => string | null;
  renameProviderEndpoint: (providerId: string, nextProviderId: string) => string | null;
  deleteProviderEndpoint: (providerId: string, options?: ProviderEndpointDeleteOptions) => string | null;
  upsertProviderModel: (input: ProviderModelUpsertInput) => string | null;
  deleteProviderModel: (input: ProviderModelDeleteInput) => string | null;
  setDefaultProviderModel: (modelId: string) => string | null;
}

export interface SettingsPluginCommands {
  pluginConfigs: readonly { diagnostics?: readonly { severity: "error" | "warning" }[] }[];
  pluginConfigOperations: Record<string, { status: string }>;
}

/**
 * Composed handle passed as `SettingsWorkbenchProps.systemConfig` once the app root
 * is wired to `useConfigMutationController`. The controller itself does not source
 * `configSnapshot`/catalogs/errors (it takes `configSnapshot` as an input and expects
 * catalogs/errors to be read from the store by the caller), so this type layers those
 * three store-sourced fields on top of the controller's own return shape. Structurally
 * satisfies `SettingsConfigCommands` (the type the resurrected Child 2/3 components are
 * written against) with some additional fields (`ingestConfigMutationEvent`,
 * `pluginConfigOperations`, `presetOperations`, etc.) that are harmless excess properties.
 */
export interface SettingsSystemConfigHandle extends ConfigMutationController {
  configSnapshot: ConfigSnapshotData | null;
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
}
