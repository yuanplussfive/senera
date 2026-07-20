import { useMemo, type MutableRefObject } from "react";
import type { WsRequest } from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import type { SettingsSystemConfigHandle } from "../features/settings/SettingsContracts";
import { useStore } from "../store/sessionStore";
import { useConfigMutationController, type ConfigMutationController } from "./useConfigMutationController";
import type { PluginSettingsCommandsHandle } from "./usePluginSettingsCommands";

export interface SettingsRuntimeHandle {
  controller: ConfigMutationController;
  pluginSettings: PluginSettingsCommandsHandle;
  systemConfig: SettingsSystemConfigHandle;
}

export function useSettingsRuntime({
  sendRef,
  statusRef,
}: {
  sendRef: MutableRefObject<((request: WsRequest) => boolean) | null>;
  statusRef: MutableRefObject<SocketStatus>;
}): SettingsRuntimeHandle {
  const configSnapshot = useStore((state) => state.configSnapshot);
  const providerModelCatalogs = useStore((state) => state.providerModelCatalogs);
  const providerModelErrors = useStore((state) => state.providerModelErrors);
  const pluginConfigs = useStore((state) => state.pluginConfigs);
  const controller = useConfigMutationController({ configSnapshot, sendRef, statusRef });

  const systemConfig = useMemo<SettingsSystemConfigHandle>(
    () => ({
      ...controller,
      configSnapshot,
      providerModelCatalogs,
      providerModelErrors,
    }),
    [configSnapshot, controller, providerModelCatalogs, providerModelErrors],
  );

  const pluginSettings = useMemo<PluginSettingsCommandsHandle>(
    () => ({
      pluginConfigs,
      pluginConfigOperations: controller.pluginConfigOperations,
      socketStatus: controller.socketStatus,
      refreshPluginConfigs: controller.refreshPluginConfigs,
      savePluginConfig: controller.savePluginConfig,
      setPluginEnabled: controller.setPluginEnabled,
      handlePluginSettingsEvent: controller.ingestConfigMutationEvent,
    }),
    [controller, pluginConfigs],
  );

  return { controller, pluginSettings, systemConfig };
}
