import { useCallback, useMemo, type MutableRefObject } from "react";
import type {
  ConfigMutationState,
  ConfigSnapshotData,
  EventEnvelope,
  PresetFormat,
  PresetMutationState,
  ProviderModelEndpointInput,
  ProviderModelEndpointPatchInput,
  WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import type { ProviderEndpointDeleteOptions } from "./providerEndpointMutations";
import type { ProviderModelDeleteInput, ProviderModelUpsertInput } from "./providerModelMutations";
import { useConfigCommands } from "./useConfigCommands";
import { usePresetCommands } from "./usePresetCommands";
import { useProviderEndpointMutations } from "./useProviderEndpointMutations";
import { useProviderModelMutations } from "./useProviderModelMutations";
import { useSystemConfigCommandQueue } from "./useSystemConfigCommandQueue";

type SendRequest = (request: WsRequest) => boolean;

export interface SocketTransportRefs {
  configSnapshot?: ConfigSnapshotData | null;
  sendRef: MutableRefObject<SendRequest | null>;
  statusRef: MutableRefObject<SocketStatus>;
}

export interface ConfigMutationController {
  configOperation: ConfigMutationState | null;
  socketStatus: SocketStatus;
  deleteProviderEndpoint: (providerId: string, options?: ProviderEndpointDeleteOptions) => string | null;
  fetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
  ingestConfigMutationEvent: (env: EventEnvelope) => boolean;
  presetOperations: Record<string, PresetMutationState>;
  providerEndpointOperations: Record<string, ConfigMutationState>;
  providerModelOperations: Record<string, ConfigMutationState>;
  providerModelLoadingIds: Record<string, boolean>;
  refreshConfig: () => void;
  refreshPresets: () => void;
  saveConfig: (config: Record<string, unknown>) => string | null;
  savePreset: (input: { name: string; format: PresetFormat; content: string; activate?: boolean }) => string | null;
  renameProviderEndpoint: (providerId: string, nextProviderId: string) => string | null;
  setActivePreset: (name: string | null) => string | null;
  deletePreset: (name: string) => string | null;
  upsertProviderEndpoint: (endpoint: ProviderModelEndpointPatchInput) => string | null;
  upsertProviderModel: (input: ProviderModelUpsertInput) => string | null;
  deleteProviderModel: (input: ProviderModelDeleteInput) => string | null;
  setDefaultProviderModel: (modelId: string) => string | null;
}

export function useConfigMutationController({
  configSnapshot = null,
  sendRef,
  statusRef,
}: SocketTransportRefs): ConfigMutationController {
  const socketStatus = statusRef.current;
  const systemConfigQueue = useSystemConfigCommandQueue({ configSnapshot, sendRef, status: socketStatus });
  const configCommands = useConfigCommands({ commandQueue: systemConfigQueue, sendRef, statusRef });
  const endpointMutations = useProviderEndpointMutations({ commandQueue: systemConfigQueue });
  const providerModelMutations = useProviderModelMutations({ commandQueue: systemConfigQueue });
  const send = sendRef.current ?? (() => false);
  const presetMutations = usePresetCommands({ send, status: statusRef.current });

  const ingestConfigMutationEvent = useCallback(
    (env: EventEnvelope): boolean => {
      const queueHandled = systemConfigQueue.ingest(env);
      return (
        providerModelMutations.ingestConfigMutationEvent(env) ||
        endpointMutations.ingestProviderEndpointMutationEvent(env) ||
        presetMutations.handlePresetEvent(env) ||
        configCommands.ingestConfigCommandEvent(env) ||
        queueHandled
      );
    },
    [configCommands, endpointMutations, presetMutations, providerModelMutations, systemConfigQueue],
  );

  return useMemo(
    () => ({
      configOperation: configCommands.configOperation,
      deleteProviderEndpoint: endpointMutations.deleteProviderEndpoint,
      fetchProviderModels: configCommands.fetchProviderModels,
      ingestConfigMutationEvent,
      presetOperations: presetMutations.presetOperations,
      providerEndpointOperations: endpointMutations.providerEndpointOperations,
      providerModelOperations: providerModelMutations.providerModelOperations,
      providerModelLoadingIds: configCommands.providerModelLoadingIds,
      refreshConfig: configCommands.refreshConfig,
      refreshPresets: configCommands.refreshPresets,
      saveConfig: configCommands.saveConfig,
      socketStatus,
      savePreset: presetMutations.savePreset,
      renameProviderEndpoint: endpointMutations.renameProviderEndpoint,
      setActivePreset: presetMutations.setActivePreset,
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
      presetMutations,
      providerModelMutations,
      socketStatus,
    ],
  );
}
