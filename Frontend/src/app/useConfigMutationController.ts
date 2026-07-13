import { useCallback, useMemo, useReducer, useRef, type Dispatch, type MutableRefObject } from "react";
import { toast } from "sonner";
import {
  EventKinds,
  type ConfigFailedData,
  type ConfigMutationState,
  type ConfigSnapshotData,
  type EventEnvelope,
  type PresetFailedData,
  type PresetFormat,
  type PresetMutationState,
  type PresetSnapshotData,
  type ProviderModelEndpointInput,
  type ProviderModelsFailedData,
  type ProviderModelsSnapshotData,
  type PluginConfigMutationState,
  type PluginConfigOperationKind,
  type PluginConfigSnapshotData,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import {
  providerEndpointMessageKeys,
  readConfigRevisionGuard,
  resolveProviderEndpointMutationEvent,
  type PendingProviderEndpointOperation,
  type ProviderEndpointConfigRequest,
  type ProviderEndpointDeleteOptions,
  type ProviderEndpointMutationResolution,
} from "./providerEndpointMutations";
import type { ProviderModelDeleteInput, ProviderModelUpsertInput } from "./providerModelMutations";
import { useProviderModelMutations } from "./useProviderModelMutations";

type SendRequest = (request: WsRequest) => boolean;

export interface SocketTransportRefs {
  configSnapshot?: ConfigSnapshotData | null;
  sendRef: MutableRefObject<SendRequest | null>;
  statusRef: MutableRefObject<SocketStatus>;
}

type PendingPluginConfigKind = Extract<PluginConfigOperationKind, "update" | "set_enabled">;

type PendingPluginConfigOperation = {
  pluginName: string;
  kind: PendingPluginConfigKind;
};

type PendingConfigOperation = {
  kind: "config_update";
};

type PendingPresetOperation = {
  name?: string | null;
  kind: "save" | "delete" | "set_active";
};

interface ConfigMutationControllerState {
  pluginConfigOperations: Record<string, PluginConfigMutationState>;
  providerEndpointOperations: Record<string, ConfigMutationState>;
  configOperation: ConfigMutationState | null;
  providerModelLoadingIds: Record<string, boolean>;
  presetOperations: Record<string, PresetMutationState>;
}

type ConfigMutationControllerAction =
  | { type: "plugin_operation_upsert"; operation: PluginConfigMutationState }
  | { type: "plugin_operation_remove"; requestId: string }
  | { type: "provider_endpoint_operation_upsert"; providerId: string; operation: ConfigMutationState }
  | { type: "provider_endpoint_operation_remove"; providerId: string }
  | { type: "config_operation_set"; operation: ConfigMutationState | null }
  | { type: "provider_models_started"; providerId: string }
  | { type: "provider_models_finished"; providerId: string }
  | { type: "preset_operation_upsert"; operation: PresetMutationState }
  | { type: "preset_operation_remove"; requestId: string };

const initialState: ConfigMutationControllerState = {
  pluginConfigOperations: {},
  providerEndpointOperations: {},
  configOperation: null,
  providerModelLoadingIds: {},
  presetOperations: {},
};

const pluginConfigCopy = {
  update: {
    offline: frontendMessage("pluginConfig.saveOffline"),
    disconnected: frontendMessage("pluginConfig.saveDisconnected"),
    success: frontendMessage("pluginConfig.saved"),
    failure: frontendMessage("pluginConfig.saveFailed"),
  },
  set_enabled: {
    offline: frontendMessage("pluginConfig.setEnabledOffline"),
    disconnected: frontendMessage("pluginConfig.setEnabledDisconnected"),
    success: frontendMessage("pluginConfig.setEnabledSucceeded"),
    failure: frontendMessage("pluginConfig.setEnabledFailed"),
  },
} satisfies Record<PendingPluginConfigKind, Record<"offline" | "disconnected" | "success" | "failure", string>>;

const presetCopy = {
  save: {
    success: frontendMessage("preset.saved"),
    failure: frontendMessage("preset.saveFailed"),
  },
  delete: {
    success: frontendMessage("preset.deleted"),
    failure: frontendMessage("preset.deleteFailed"),
  },
  set_active: {
    success: frontendMessage("preset.setActiveSucceeded"),
    failure: frontendMessage("preset.setActiveFailed"),
  },
} satisfies Record<PendingPresetOperation["kind"], Record<"success" | "failure", string>>;

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
  const [state, dispatch] = useReducer(configMutationReducer, initialState);
  const pendingPluginConfigOpsRef = useRef<Map<string, PendingPluginConfigOperation>>(new Map());
  const pendingProviderEndpointOpsRef = useRef<Map<string, PendingProviderEndpointOperation>>(new Map());
  const pendingConfigOpsRef = useRef<Map<string, PendingConfigOperation>>(new Map());
  const pendingPresetOpsRef = useRef<Map<string, PendingPresetOperation>>(new Map());
  const {
    deleteProviderModel,
    ingestConfigMutationEvent: ingestProviderModelMutationEvent,
    providerModelOperations,
    setDefaultProviderModel,
    upsertProviderModel,
  } = useProviderModelMutations({ configSnapshot, sendRef, statusRef });

  const readOpenTransport = useCallback(
    (offlineMessage: string): SendRequest | null => {
      const send = sendRef.current;
      if (statusRef.current !== "open" || !send) {
        toast.error(offlineMessage);
        return null;
      }
      return send;
    },
    [sendRef, statusRef],
  );

  const refreshPluginConfigs = useCallback((): void => {
    const send = sendRef.current;
    if (statusRef.current !== "open" || !send) return;
    send({ type: "plugin.config.list" });
  }, [sendRef, statusRef]);

  const refreshPresets = useCallback((): void => {
    const send = sendRef.current;
    if (statusRef.current !== "open" || !send) return;
    send({ type: "preset.list" });
  }, [sendRef, statusRef]);

  const refreshConfig = useCallback((): void => {
    const send = sendRef.current;
    if (statusRef.current !== "open" || !send) return;
    send({ type: "config.get" });
  }, [sendRef, statusRef]);

  const savePluginConfig = useCallback(
    (pluginName: string, toml: string): string | null => {
      const send = readOpenTransport(pluginConfigCopy.update.offline);
      if (!send) return null;

      const requestId = generateId();
      const pending: PendingPluginConfigOperation = { pluginName, kind: "update" };
      pendingPluginConfigOpsRef.current.set(requestId, pending);
      dispatch({
        type: "plugin_operation_upsert",
        operation: {
          requestId,
          pluginName,
          kind: pending.kind,
          status: "pending",
          updatedAt: timestamp(),
        },
      });

      const ok = send({
        type: "plugin.config.update",
        requestId,
        pluginName,
        toml,
      });
      if (!ok) {
        pendingPluginConfigOpsRef.current.delete(requestId);
        dispatch({ type: "plugin_operation_remove", requestId });
        toast.error(pluginConfigCopy.update.disconnected);
        return null;
      }
      return requestId;
    },
    [readOpenTransport],
  );

  const setPluginEnabled = useCallback(
    (pluginName: string, enabled: boolean, toolName?: string): string | null => {
      const send = readOpenTransport(pluginConfigCopy.set_enabled.offline);
      if (!send) return null;

      const requestId = generateId();
      const pending: PendingPluginConfigOperation = { pluginName, kind: "set_enabled" };
      pendingPluginConfigOpsRef.current.set(requestId, pending);
      dispatch({
        type: "plugin_operation_upsert",
        operation: {
          requestId,
          pluginName,
          kind: pending.kind,
          status: "pending",
          updatedAt: timestamp(),
        },
      });

      const ok = send({
        type: "plugin.config.set_enabled",
        requestId,
        pluginName,
        toolName,
        enabled,
      });
      if (!ok) {
        pendingPluginConfigOpsRef.current.delete(requestId);
        dispatch({ type: "plugin_operation_remove", requestId });
        toast.error(pluginConfigCopy.set_enabled.disconnected);
        return null;
      }
      return requestId;
    },
    [readOpenTransport],
  );

  const saveConfig = useCallback(
    (config: Record<string, unknown>): string | null => {
      const send = readOpenTransport(frontendMessage("config.mainOffline"));
      if (!send) return null;

      const requestId = generateId();
      const pending: PendingConfigOperation = { kind: "config_update" };
      pendingConfigOpsRef.current.set(requestId, pending);
      dispatch({
        type: "config_operation_set",
        operation: {
          requestId,
          kind: pending.kind,
          status: "pending",
          updatedAt: timestamp(),
        },
      });

      const ok = send({
        type: "config.update",
        requestId,
        config,
        mirrorJson: true,
      });
      if (!ok) {
        pendingConfigOpsRef.current.delete(requestId);
        dispatch({ type: "config_operation_set", operation: null });
        toast.error(frontendMessage("config.mainDisconnected"));
        return null;
      }
      return requestId;
    },
    [readOpenTransport],
  );

  const startProviderEndpointOperation = useCallback(
    (pending: PendingProviderEndpointOperation, request: ProviderEndpointConfigRequest): string | null => {
      const copy = providerEndpointMessageKeys[pending.kind];
      const send = readOpenTransport(frontendMessage(copy.offline));
      if (!send) return null;
      if (!configSnapshot) {
        toast.error(frontendMessage(copy.configUnavailable));
        return null;
      }

      const requestId = generateId();
      const operation: ConfigMutationState = {
        requestId,
        kind: pending.kind,
        status: "pending",
        updatedAt: timestamp(),
      };
      pendingProviderEndpointOpsRef.current.set(requestId, pending);
      dispatch({
        type: "provider_endpoint_operation_upsert",
        providerId: pending.providerId,
        operation,
      });

      const ok = send({
        ...request,
        ...readConfigRevisionGuard(configSnapshot),
        requestId,
        mirrorJson: true,
      } as ProviderEndpointConfigRequest);
      if (!ok) {
        pendingProviderEndpointOpsRef.current.delete(requestId);
        dispatch({ type: "provider_endpoint_operation_remove", providerId: pending.providerId });
        toast.error(frontendMessage(copy.disconnected));
        return null;
      }
      return requestId;
    },
    [configSnapshot, readOpenTransport],
  );

  const upsertProviderEndpoint = useCallback(
    (endpoint: ProviderModelEndpointInput): string | null =>
      startProviderEndpointOperation(
        {
          kind: "provider.endpoint.upsert",
          providerId: endpoint.Id,
        },
        {
          type: "provider.endpoint.upsert",
          endpoint,
        },
      ),
    [startProviderEndpointOperation],
  );

  const renameProviderEndpoint = useCallback(
    (providerId: string, nextProviderId: string): string | null =>
      startProviderEndpointOperation(
        {
          kind: "provider.endpoint.rename",
          providerId,
        },
        {
          type: "provider.endpoint.rename",
          providerId,
          nextProviderId,
        },
      ),
    [startProviderEndpointOperation],
  );

  const deleteProviderEndpoint = useCallback(
    (providerId: string, options: ProviderEndpointDeleteOptions = {}): string | null =>
      startProviderEndpointOperation(
        {
          kind: "provider.endpoint.delete",
          providerId,
        },
        {
          type: "provider.endpoint.delete",
          providerId,
          ...options,
        },
      ),
    [startProviderEndpointOperation],
  );

  const fetchProviderModels = useCallback(
    (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput): void => {
      const send = readOpenTransport(frontendMessage("config.providerModelsOffline"));
      if (!send) return;

      dispatch({ type: "provider_models_started", providerId });
      const ok = send({
        type: "provider.models.fetch",
        providerId,
        force,
        endpoint,
      });
      if (!ok) {
        dispatch({ type: "provider_models_finished", providerId });
        toast.error(frontendMessage("config.providerModelsDisconnected"));
      }
    },
    [readOpenTransport],
  );

  const startPresetOperation = useCallback(
    (
      pending: PendingPresetOperation,
      request: Extract<WsRequest, { type: "preset.save" | "preset.delete" | "preset.set_active" }>,
    ): string | null => {
      const send = readOpenTransport(frontendMessage("preset.updateOffline"));
      if (!send) return null;

      const requestId = generateId();
      pendingPresetOpsRef.current.set(requestId, pending);
      dispatch({
        type: "preset_operation_upsert",
        operation: {
          requestId,
          name: pending.name,
          kind: pending.kind,
          status: "pending",
          updatedAt: timestamp(),
        },
      });

      const ok = send({
        ...request,
        requestId,
      });
      if (!ok) {
        pendingPresetOpsRef.current.delete(requestId);
        dispatch({ type: "preset_operation_remove", requestId });
        toast.error(frontendMessage("preset.updateDisconnected"));
        return null;
      }
      return requestId;
    },
    [readOpenTransport],
  );

  const savePreset = useCallback(
    (input: { name: string; format: PresetFormat; content: string; activate?: boolean }): string | null =>
      startPresetOperation(
        {
          name: input.name,
          kind: "save",
        },
        {
          type: "preset.save",
          name: input.name,
          format: input.format,
          content: input.content,
          activate: input.activate,
        },
      ),
    [startPresetOperation],
  );

  const deletePreset = useCallback(
    (name: string): string | null =>
      startPresetOperation(
        {
          name,
          kind: "delete",
        },
        {
          type: "preset.delete",
          name,
        },
      ),
    [startPresetOperation],
  );

  const setActivePreset = useCallback(
    (name: string | null): string | null =>
      startPresetOperation(
        {
          name,
          kind: "set_active",
        },
        {
          type: "preset.set_active",
          name,
        },
      ),
    [startPresetOperation],
  );

  const ingestConfigMutationEvent = useCallback(
    (env: EventEnvelope): boolean => {
      if (ingestProviderModelMutationEvent(env)) return true;
      const providerEndpointResolution = resolveProviderEndpointMutationEvent(
        env,
        pendingProviderEndpointOpsRef.current,
      );
      if (providerEndpointResolution) {
        ingestProviderEndpointResolution(providerEndpointResolution, pendingProviderEndpointOpsRef, dispatch);
        return true;
      }
      if (env.kind === EventKinds.PluginConfigSnapshot) {
        ingestPluginConfigSnapshot(env.data as PluginConfigSnapshotData, pendingPluginConfigOpsRef, dispatch);
        return true;
      }
      if (env.kind === EventKinds.PresetSnapshot) {
        ingestPresetSnapshot(env.data as PresetSnapshotData, pendingPresetOpsRef, dispatch);
        return true;
      }
      if (env.kind === EventKinds.ConfigSnapshot) {
        ingestConfigSnapshot(env.data as ConfigSnapshotData, pendingConfigOpsRef, dispatch);
        return true;
      }
      if (env.kind === EventKinds.ProviderModelsSnapshot) {
        dispatch({
          type: "provider_models_finished",
          providerId: (env.data as ProviderModelsSnapshotData).providerId,
        });
        return true;
      }
      if (env.kind === EventKinds.ProviderModelsFailed) {
        const data = env.data as ProviderModelsFailedData;
        dispatch({ type: "provider_models_finished", providerId: data.providerId });
        toast.error(frontendMessage("config.providerModelsFailed"), {
          description: data.message,
        });
        return true;
      }
      if (env.kind === EventKinds.ConfigFailed) {
        ingestConfigFailure(env.data as ConfigFailedData, pendingConfigOpsRef, pendingPluginConfigOpsRef, dispatch);
        return true;
      }
      if (env.kind === EventKinds.PresetFailed) {
        ingestPresetFailure(env.data as PresetFailedData, pendingPresetOpsRef, dispatch);
        return true;
      }
      return false;
    },
    [ingestProviderModelMutationEvent],
  );

  return useMemo(
    () => ({
      configOperation: state.configOperation,
      deleteProviderEndpoint,
      fetchProviderModels,
      ingestConfigMutationEvent,
      pluginConfigOperations: state.pluginConfigOperations,
      presetOperations: state.presetOperations,
      providerEndpointOperations: state.providerEndpointOperations,
      providerModelOperations,
      providerModelLoadingIds: state.providerModelLoadingIds,
      refreshConfig,
      refreshPluginConfigs,
      refreshPresets,
      renameProviderEndpoint,
      saveConfig,
      savePluginConfig,
      savePreset,
      setActivePreset,
      setPluginEnabled,
      deletePreset,
      upsertProviderEndpoint,
      upsertProviderModel,
      deleteProviderModel,
      setDefaultProviderModel,
    }),
    [
      deletePreset,
      deleteProviderEndpoint,
      fetchProviderModels,
      ingestConfigMutationEvent,
      refreshConfig,
      refreshPluginConfigs,
      refreshPresets,
      renameProviderEndpoint,
      saveConfig,
      savePluginConfig,
      savePreset,
      setActivePreset,
      setPluginEnabled,
      state.configOperation,
      state.pluginConfigOperations,
      state.presetOperations,
      state.providerEndpointOperations,
      providerModelOperations,
      state.providerModelLoadingIds,
      upsertProviderEndpoint,
      deleteProviderModel,
      setDefaultProviderModel,
      upsertProviderModel,
    ],
  );
}

function configMutationReducer(
  state: ConfigMutationControllerState,
  action: ConfigMutationControllerAction,
): ConfigMutationControllerState {
  switch (action.type) {
    case "plugin_operation_upsert":
      return {
        ...state,
        pluginConfigOperations: {
          ...state.pluginConfigOperations,
          [action.operation.requestId]: action.operation,
        },
      };
    case "plugin_operation_remove": {
      const pluginConfigOperations = { ...state.pluginConfigOperations };
      delete pluginConfigOperations[action.requestId];
      return { ...state, pluginConfigOperations };
    }
    case "provider_endpoint_operation_upsert":
      return {
        ...state,
        providerEndpointOperations: {
          ...state.providerEndpointOperations,
          [action.providerId]: action.operation,
        },
      };
    case "provider_endpoint_operation_remove": {
      const providerEndpointOperations = { ...state.providerEndpointOperations };
      delete providerEndpointOperations[action.providerId];
      return { ...state, providerEndpointOperations };
    }
    case "config_operation_set":
      return { ...state, configOperation: action.operation };
    case "provider_models_started":
      return {
        ...state,
        providerModelLoadingIds: {
          ...state.providerModelLoadingIds,
          [action.providerId]: true,
        },
      };
    case "provider_models_finished": {
      const providerModelLoadingIds = { ...state.providerModelLoadingIds };
      delete providerModelLoadingIds[action.providerId];
      return { ...state, providerModelLoadingIds };
    }
    case "preset_operation_upsert":
      return {
        ...state,
        presetOperations: {
          ...state.presetOperations,
          [action.operation.requestId]: action.operation,
        },
      };
    case "preset_operation_remove": {
      const presetOperations = { ...state.presetOperations };
      delete presetOperations[action.requestId];
      return { ...state, presetOperations };
    }
  }
}

function ingestProviderEndpointResolution(
  resolution: ProviderEndpointMutationResolution,
  pendingRef: MutableRefObject<Map<string, PendingProviderEndpointOperation>>,
  dispatch: Dispatch<ConfigMutationControllerAction>,
): void {
  pendingRef.current.delete(resolution.requestId);
  dispatch({
    type: "provider_endpoint_operation_upsert",
    providerId: resolution.providerId,
    operation: {
      requestId: resolution.requestId,
      kind: resolution.operationKind,
      status: resolution.kind === "success" ? "success" : "error",
      ...(resolution.kind === "failure" ? { message: resolution.message } : {}),
      updatedAt: timestamp(),
    },
  });

  const copy = providerEndpointMessageKeys[resolution.operationKind];
  if (resolution.kind === "success") {
    toast.success(frontendMessage(copy.success));
    return;
  }
  toast.error(frontendMessage(copy.failure), {
    description: resolution.message,
  });
}

function ingestPluginConfigSnapshot(
  data: PluginConfigSnapshotData,
  pendingRef: MutableRefObject<Map<string, PendingPluginConfigOperation>>,
  dispatch: Dispatch<ConfigMutationControllerAction>,
): void {
  const requestId = data.operation?.requestId;
  const pending = requestId ? pendingRef.current.get(requestId) : undefined;
  if (!requestId || !pending) return;

  pendingRef.current.delete(requestId);
  dispatch({
    type: "plugin_operation_upsert",
    operation: {
      requestId,
      pluginName: pending.pluginName,
      kind: pending.kind,
      status: "success",
      updatedAt: timestamp(),
    },
  });
  toast.success(pluginConfigCopy[pending.kind].success);
}

function ingestPresetSnapshot(
  data: PresetSnapshotData,
  pendingRef: MutableRefObject<Map<string, PendingPresetOperation>>,
  dispatch: Dispatch<ConfigMutationControllerAction>,
): void {
  const requestId = data.operation?.requestId;
  const pending = requestId ? pendingRef.current.get(requestId) : undefined;
  if (!requestId || !pending) return;

  pendingRef.current.delete(requestId);
  dispatch({
    type: "preset_operation_upsert",
    operation: {
      requestId,
      name: data.operation?.name ?? pending.name,
      kind: pending.kind,
      status: "success",
      updatedAt: timestamp(),
    },
  });
  toast.success(presetCopy[pending.kind].success);
}

function ingestConfigSnapshot(
  data: ConfigSnapshotData,
  pendingRef: MutableRefObject<Map<string, PendingConfigOperation>>,
  dispatch: Dispatch<ConfigMutationControllerAction>,
): void {
  const requestId = data.operation?.requestId;
  const pending = requestId ? pendingRef.current.get(requestId) : undefined;
  if (!requestId || !pending) return;

  pendingRef.current.delete(requestId);
  dispatch({
    type: "config_operation_set",
    operation: {
      requestId,
      kind: pending.kind,
      status: "success",
      updatedAt: timestamp(),
    },
  });
  toast.success(frontendMessage("config.mainSaved"));
}

function ingestConfigFailure(
  data: ConfigFailedData,
  configPendingRef: MutableRefObject<Map<string, PendingConfigOperation>>,
  pluginPendingRef: MutableRefObject<Map<string, PendingPluginConfigOperation>>,
  dispatch: Dispatch<ConfigMutationControllerAction>,
): void {
  const requestId = data.operation?.requestId;
  if (data.operation?.kind === "config_update") {
    const pending = requestId ? configPendingRef.current.get(requestId) : undefined;
    if (requestId && pending) {
      configPendingRef.current.delete(requestId);
      dispatch({
        type: "config_operation_set",
        operation: {
          requestId,
          kind: pending.kind,
          status: "error",
          message: data.message,
          updatedAt: timestamp(),
        },
      });
    }
    toast.error(frontendMessage("config.mainFailed"), {
      description: data.message,
    });
    return;
  }

  const pending = requestId ? pluginPendingRef.current.get(requestId) : undefined;
  if (!requestId || !pending) return;

  pluginPendingRef.current.delete(requestId);
  dispatch({
    type: "plugin_operation_upsert",
    operation: {
      requestId,
      pluginName: pending.pluginName,
      kind: pending.kind,
      status: "error",
      message: data.message,
      updatedAt: timestamp(),
    },
  });
  toast.error(pluginConfigCopy[pending.kind].failure, {
    description: data.message,
  });
}

function ingestPresetFailure(
  data: PresetFailedData,
  pendingRef: MutableRefObject<Map<string, PendingPresetOperation>>,
  dispatch: Dispatch<ConfigMutationControllerAction>,
): void {
  const requestId = data.operation?.requestId;
  const pending = requestId ? pendingRef.current.get(requestId) : undefined;
  if (!requestId || !pending) return;

  pendingRef.current.delete(requestId);
  dispatch({
    type: "preset_operation_upsert",
    operation: {
      requestId,
      name: pending.name,
      kind: pending.kind,
      status: "error",
      message: data.message,
      updatedAt: timestamp(),
    },
  });
  toast.error(presetCopy[pending.kind].failure, {
    description: data.message,
  });
}

function timestamp(): string {
  return new Date().toISOString();
}
