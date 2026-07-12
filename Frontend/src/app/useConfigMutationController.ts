import { useCallback, useMemo } from "react";
import type { EventEnvelope } from "../api/eventTypes";
import { type ConfigMutationController, type SocketTransportRefs } from "./configMutationContracts";
import { useConfigMutationTransport } from "./useConfigMutationTransport";
import { usePluginConfigMutations } from "./usePluginConfigMutations";
import { usePresetMutations } from "./usePresetMutations";
import { useSystemConfigMutations } from "./useSystemConfigMutations";

export type { ConfigMutationController, SocketTransportRefs } from "./configMutationContracts";

/**
 * Keeps the App-facing mutation contract stable while delegating each
 * configuration domain to the hook that owns its pending state and events.
 */
export function useConfigMutationController({ sendRef, statusRef }: SocketTransportRefs): ConfigMutationController {
  const transport = useConfigMutationTransport({ sendRef, statusRef });
  const plugins = usePluginConfigMutations(transport);
  const presets = usePresetMutations(transport);
  const system = useSystemConfigMutations(transport);

  const ingestConfigMutationEvent = useCallback(
    (env: EventEnvelope): boolean => system.ingestEvent(env) || plugins.ingestEvent(env) || presets.ingestEvent(env),
    [plugins, presets, system],
  );

  return useMemo(
    () => ({
      configOperation: system.configOperation,
      deletePreset: presets.deletePreset,
      fetchProviderModels: system.fetchProviderModels,
      ingestConfigMutationEvent,
      pluginConfigOperations: plugins.operations,
      presetOperations: presets.operations,
      providerModelLoadingIds: system.providerModelLoadingIds,
      refreshConfig: system.refresh,
      refreshPluginConfigs: plugins.refresh,
      refreshPresets: presets.refresh,
      saveConfig: system.save,
      savePluginConfig: plugins.save,
      savePreset: presets.savePreset,
      setActivePreset: presets.setActivePreset,
      setPluginEnabled: plugins.setEnabled,
    }),
    [ingestConfigMutationEvent, plugins, presets, system],
  );
}
