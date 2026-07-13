import { useCallback, useMemo, type MutableRefObject } from "react";
import type {
  ConfigMutationState,
  ConfigSnapshotData,
  EventEnvelope,
  PresetFormat,
  PresetMutationState,
  PluginConfigMutationState,
  ProviderModelEndpointInput,
  WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import type { ProviderEndpointDeleteOptions } from "./providerEndpointMutations";
import type { ProviderModelDeleteInput, ProviderModelUpsertInput } from "./providerModelMutations";
import { useConfigCommands } from "./useConfigCommands";
import { usePluginSettingsCommands } from "./usePluginSettingsCommands";
import { usePresetCommands } from "./usePresetCommands";
import { useProviderEndpointMutations } from "./useProviderEndpointMutations";
import { useProviderModelMutations } from "./useProviderModelMutations";

type SendRequest = (request: WsRequest) => boolean;

export interface SocketTransportRefs {
  configSnapshot?: ConfigSnapshotData | null;
  sendRef: MutableRefObject<SendRequest | null>;
  statusRef: MutableRefObject<SocketStatus>;
}

export interface ConfigMutationController {
  configOperation: ConfigMutationState | null;
  deleteProviderEndpoint: (providerId: string, options?: ProviderEndpointDeleteOptions) => string | null;
  fetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
  ingestConfigMutationEvent: (env: EventEnvelope) => boolean;
  pluginConfigOperations: Record<string, PluginConfigMutationState>;
  presetOperations: Record<string, PresetMutationState>;
  providerEndpointOperations: Record<string, ConfigMutationState>;
  providerModelOperations: Record<string, ConfigMutationState>;
  providerModelLoadingIds: Record<string, boolean>;
  refreshConfig: () => void;
  refreshPluginConfigs: () => void;
  refreshPresets: () => void;
  saveConfig: (config: Record<string, unknown>) => string | null;
  savePluginConfig: (pluginName: string, toml: string) => string | null;
  savePreset: (input: { name: string; format: PresetFormat; content: string; activate?: boolean }) => string | null;
  renameProviderEndpoint: (providerId: string, nextProviderId: string) => string | null;
  setActivePreset: (name: string | null) => string | null;
  setPluginEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
  deletePreset: (name: string) => string | null;
  upsertProviderEndpoint: (endpoint: ProviderModelEndpointInput) => string | null;
  upsertProviderModel: (input: ProviderModelUpsertInput) => string | null;
  deleteProviderModel: (input: ProviderModelDeleteInput) => string | null;
  setDefaultProviderModel: (modelId: string) => string | null;
}

export function useConfigMutationController({
  configSnapshot = null,
  sendRef,
  statusRef,
}: SocketTransportRefs): ConfigMutationController {
  const configCommands = useConfigCommands({ sendRef, statusRef });
  const endpointMutations = useProviderEndpointMutations({ configSnapshot, sendRef, statusRef });
  const providerModelMutations = useProviderModelMutations({ configSnapshot, sendRef, statusRef });
  const send = sendRef.current ?? (() => false);
  const pluginMutations = usePluginSettingsCommands({ send, status: statusRef.current });
  const presetMutations = usePresetCommands({ send, status: statusRef.current });

  const ingestConfigMutationEvent = useCallback(
    (env: EventEnvelope): boolean => {
      return (
        providerModelMutations.ingestConfigMutationEvent(env) ||
        endpointMutations.ingestProviderEndpointMutationEvent(env) ||
        pluginMutations.handlePluginSettingsEvent(env) ||
        presetMutations.handlePresetEvent(env) ||
        configCommands.ingestConfigCommandEvent(env)
      );
    },
    [configCommands, endpointMutations, pluginMutations, presetMutations, providerModelMutations],
  );

  return useMemo(
    () => ({
      configOperation: configCommands.configOperation,
      deleteProviderEndpoint: endpointMutations.deleteProviderEndpoint,
      fetchProviderModels: configCommands.fetchProviderModels,
      ingestConfigMutationEvent,
      pluginConfigOperations: pluginMutations.pluginConfigOperations,
      presetOperations: presetMutations.presetOperations,
      providerEndpointOperations: endpointMutations.providerEndpointOperations,
      providerModelOperations: providerModelMutations.providerModelOperations,
      providerModelLoadingIds: configCommands.providerModelLoadingIds,
      refreshConfig: configCommands.refreshConfig,
      refreshPluginConfigs: configCommands.refreshPluginConfigs,
      refreshPresets: configCommands.refreshPresets,
      saveConfig: configCommands.saveConfig,
      savePluginConfig: pluginMutations.savePluginConfig,
      savePreset: presetMutations.savePreset,
      renameProviderEndpoint: endpointMutations.renameProviderEndpoint,
      setActivePreset: presetMutations.setActivePreset,
      setPluginEnabled: pluginMutations.setPluginEnabled,
      deletePreset: presetMutations.deletePreset,
      upsertProviderEndpoint: endpointMutations.upsertProviderEndpoint,
      upsertProviderModel: providerModelMutations.upsertProviderModel,
      deleteProviderModel: providerModelMutations.deleteProviderModel,
      setDefaultProviderModel: providerModelMutations.setDefaultProviderModel,
    }),
    [
      configCommands,
      endpointMutations,
      ingestConfigMutationEvent,
      pluginMutations,
      presetMutations,
      providerModelMutations,
    ],
  );
}
