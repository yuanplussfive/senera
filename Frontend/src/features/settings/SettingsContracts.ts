import type {
  ChannelStatusItem,
  ConfigMutationState,
  ConfigSnapshotData,
  AgentRuntimeDependencySnapshot,
  McpInputValue,
  McpInputMutationState,
  McpServerSettingsItem,
  ProviderModelEndpointInput,
  ProviderModelEndpointPatchInput,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
  SystemToolSettingsItem,
  SystemExtensionSettingsItem,
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
  readProviderApiKey: (providerId: string) => Promise<string>;
  readExtensionSecret: (extensionId: string, path: readonly string[]) => Promise<string>;
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

/**
 * Composed handle passed as `SettingsWorkbenchProps.systemConfig`. The controller
 * receives the current config snapshot as an input, while provider catalogs and
 * errors are read from the store by the app root; this type layers those fields on
 * top of the controller's mutation commands for the settings sections.
 */
export interface SettingsSystemConfigHandle extends ConfigMutationController {
  configSnapshot: ConfigSnapshotData | null;
  workspaceId: string | null;
  readProviderApiKey: (providerId: string) => Promise<string>;
  readExtensionSecret: (extensionId: string, path: readonly string[]) => Promise<string>;
  systemTools: readonly SystemToolSettingsItem[];
  systemExtensions: readonly SystemExtensionSettingsItem[];
  mcpServers: readonly McpServerSettingsItem[];
  runtimeDependencies: readonly AgentRuntimeDependencySnapshot[];
  mcpInputOperation: McpInputMutationState | null;
  toolSettingsSynced: { readonly systemTools: boolean; readonly mcpServers: boolean };
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  refreshToolSettings: () => boolean;
  refreshRuntimeDependencies: () => boolean;
  checkRuntimeDependency: (dependencyId: string) => boolean;
  installRuntimeDependency: (dependencyId: string) => boolean;
  updateMcpInputs: (serverId: string, values: Record<string, McpInputValue>, deletes?: string[]) => string | null;
  restartMcpServer: (serverId: string) => boolean;
  channelStatuses: readonly ChannelStatusItem[];
  connectChannel: (kind: ChannelStatusItem["kind"]) => boolean;
}
