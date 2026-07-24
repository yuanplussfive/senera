import type {
  ConfigMutationState,
  ConfigSnapshotData,
  ProviderModelEndpointInput,
  ProviderModelEndpointPatchInput,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../api/eventTypes";
import type { ConfigMutationController } from "../../app/useConfigMutationController";
import type { ProviderEndpointDeleteOptions } from "../../app/providerEndpointMutations";
import type { ProviderModelDeleteInput, ProviderModelUpsertInput } from "../../app/providerModelMutations";

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
  upsertProviderEndpoint: (endpoint: ProviderModelEndpointPatchInput) => string | null;
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
 * Composed handle passed as `SettingsWorkbenchProps.systemConfig`. The controller
 * receives the current config snapshot as an input, while provider catalogs and
 * errors are read from the store by the app root; this type layers those fields on
 * top of the controller's mutation commands for the settings sections.
 */
export interface SettingsSystemConfigHandle extends ConfigMutationController {
  configSnapshot: ConfigSnapshotData | null;
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
}
