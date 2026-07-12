import type { MutableRefObject } from "react";
import type {
  ConfigMutationState,
  EventEnvelope,
  PresetFormat,
  PresetMutationState,
  PluginConfigMutationState,
  ProviderModelEndpointInput,
  WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";

export type ConfigMutationSendRequest = (request: WsRequest) => boolean;

export interface SocketTransportRefs {
  sendRef: MutableRefObject<ConfigMutationSendRequest | null>;
  statusRef: MutableRefObject<SocketStatus>;
}

export interface ConfigMutationController {
  configOperation: ConfigMutationState | null;
  fetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
  ingestConfigMutationEvent: (env: EventEnvelope) => boolean;
  pluginConfigOperations: Record<string, PluginConfigMutationState>;
  presetOperations: Record<string, PresetMutationState>;
  providerModelLoadingIds: Record<string, boolean>;
  refreshConfig: () => void;
  refreshPluginConfigs: () => void;
  refreshPresets: () => void;
  saveConfig: (config: Record<string, unknown>) => string | null;
  savePluginConfig: (pluginName: string, toml: string) => string | null;
  savePreset: (input: { name: string; format: PresetFormat; content: string; activate?: boolean }) => string | null;
  setActivePreset: (name: string | null) => string | null;
  setPluginEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
  deletePreset: (name: string) => string | null;
}
