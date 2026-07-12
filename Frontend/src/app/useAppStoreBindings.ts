import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { buildUploadUrl } from "../api/uploadClient";
import { useStore, type StoreState } from "../store/sessionStore";
import type {
  ChatModelConfig,
  ChatPluginConfig,
  ChatPresetConfig,
  ChatSystemConfig,
} from "../features/chat/ChatPanelContracts";
import type { ConfigMutationController } from "./useConfigMutationController";

export interface AppStoreBindings {
  actions: Pick<StoreState, "appendUserMessage" | "ingest" | "markUserProfileSynced" | "registerCreatingSession">;
  activeSessionId: string | null;
  chatModelConfig: ChatModelConfig;
  chatPluginConfig: ChatPluginConfig;
  chatPresetConfig: ChatPresetConfig;
  chatSystemConfig: ChatSystemConfig;
  selectedModelProviderId: string | null;
  uploadUrl: string;
  userProfile: StoreState["userProfile"];
}

export function useAppStoreBindings({
  configMutations,
  wsUrl,
}: {
  configMutations: ConfigMutationController;
  wsUrl: string;
}): AppStoreBindings {
  const actions = useStore(useShallow(selectAppStoreActions));
  const state = useStore(useShallow(selectAppStoreState));
  const uploadUrl = useMemo(() => buildUploadUrl(wsUrl), [wsUrl]);

  const chatModelConfig = useMemo<ChatModelConfig>(
    () => ({
      modelProviders: state.modelProviders,
      selectedModelProviderId: state.selectedModelProviderId,
      onSelectModelProvider: state.selectModelProvider,
    }),
    [state.modelProviders, state.selectModelProvider, state.selectedModelProviderId],
  );

  const chatPluginConfig = useMemo<ChatPluginConfig>(
    () => ({
      pluginConfigs: state.pluginConfigs,
      pluginConfigOperations: configMutations.pluginConfigOperations,
      onRefreshPluginConfigs: configMutations.refreshPluginConfigs,
      onSavePluginConfig: configMutations.savePluginConfig,
      onSetPluginEnabled: configMutations.setPluginEnabled,
    }),
    [
      configMutations.pluginConfigOperations,
      configMutations.refreshPluginConfigs,
      configMutations.savePluginConfig,
      configMutations.setPluginEnabled,
      state.pluginConfigs,
    ],
  );

  const chatSystemConfig = useMemo<ChatSystemConfig>(
    () => ({
      configSnapshot: state.configSnapshot,
      configOperation: configMutations.configOperation,
      providerModelCatalogs: state.providerModelCatalogs,
      providerModelErrors: state.providerModelErrors,
      providerModelLoadingIds: configMutations.providerModelLoadingIds,
      onRefreshConfig: configMutations.refreshConfig,
      onSaveConfig: configMutations.saveConfig,
      onFetchProviderModels: configMutations.fetchProviderModels,
    }),
    [
      configMutations.configOperation,
      configMutations.fetchProviderModels,
      configMutations.providerModelLoadingIds,
      configMutations.refreshConfig,
      configMutations.saveConfig,
      state.configSnapshot,
      state.providerModelCatalogs,
      state.providerModelErrors,
    ],
  );

  const chatPresetConfig = useMemo<ChatPresetConfig>(
    () => ({
      presets: state.presets,
      activePresetName: state.activePresetName,
      presetsEnabled: state.presetsEnabled,
      presetRootDir: state.presetRootDir,
      presetOperations: configMutations.presetOperations,
      onRefreshPresets: configMutations.refreshPresets,
      onSavePreset: configMutations.savePreset,
      onDeletePreset: configMutations.deletePreset,
      onSetActivePreset: configMutations.setActivePreset,
    }),
    [
      configMutations.deletePreset,
      configMutations.presetOperations,
      configMutations.refreshPresets,
      configMutations.savePreset,
      configMutations.setActivePreset,
      state.activePresetName,
      state.presetRootDir,
      state.presets,
      state.presetsEnabled,
    ],
  );

  return {
    actions,
    activeSessionId: state.activeSessionId,
    chatModelConfig,
    chatPluginConfig,
    chatPresetConfig,
    chatSystemConfig,
    selectedModelProviderId: state.selectedModelProviderId,
    uploadUrl,
    userProfile: state.userProfile,
  };
}

const selectAppStoreActions = (state: StoreState) => ({
  appendUserMessage: state.appendUserMessage,
  ingest: state.ingest,
  markUserProfileSynced: state.markUserProfileSynced,
  registerCreatingSession: state.registerCreatingSession,
});

const selectAppStoreState = (state: StoreState) => ({
  activePresetName: state.activePresetName,
  activeSessionId: state.activeSessionId,
  configSnapshot: state.configSnapshot,
  modelProviders: state.modelProviders,
  pluginConfigs: state.pluginConfigs,
  presetRootDir: state.presetRootDir,
  presets: state.presets,
  presetsEnabled: state.presetsEnabled,
  providerModelCatalogs: state.providerModelCatalogs,
  providerModelErrors: state.providerModelErrors,
  selectModelProvider: state.selectModelProvider,
  selectedModelProviderId: state.selectedModelProviderId,
  userProfile: state.userProfile,
});
