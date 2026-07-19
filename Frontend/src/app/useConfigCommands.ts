import { useCallback, useMemo, useReducer, useRef, type MutableRefObject } from "react";
import { toast } from "sonner";
import {
  EventKinds,
  type ConfigFailedData,
  type ConfigMutationState,
  type ConfigSnapshotData,
  type EventEnvelope,
  type ProviderModelEndpointInput,
  type ProviderModelsFailedData,
  type ProviderModelsSnapshotData,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { readConfigFailureCode } from "./configMutationFailure";
import { readConfigRevisionGuard } from "./providerEndpointMutations";

type SendRequest = (request: WsRequest) => boolean;

export interface ConfigCommandTransport {
  configSnapshot?: ConfigSnapshotData | null;
  sendRef: MutableRefObject<SendRequest | null>;
  statusRef: MutableRefObject<SocketStatus>;
}

type State = { configOperation: ConfigMutationState | null; providerModelLoadingIds: Record<string, boolean> };
type Action =
  | { type: "config"; operation: ConfigMutationState | null }
  | { type: "started"; providerId: string }
  | { type: "finished"; providerId: string };
const initialState: State = { configOperation: null, providerModelLoadingIds: {} };

export function useConfigCommands({ configSnapshot = null, sendRef, statusRef }: ConfigCommandTransport) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const pendingRef = useRef(new Set<string>());
  const refreshConfig = useCallback(() => sendIfOpen(sendRef, statusRef, { type: "config.get" }), [sendRef, statusRef]);
  const refreshPluginConfigs = useCallback(
    () => sendIfOpen(sendRef, statusRef, { type: "plugin.config.list" }),
    [sendRef, statusRef],
  );
  const refreshPresets = useCallback(
    () => sendIfOpen(sendRef, statusRef, { type: "preset.list" }),
    [sendRef, statusRef],
  );
  const saveConfig = useCallback(
    (config: Record<string, unknown>): string | null => {
      const send = sendRef.current;
      if (statusRef.current !== "open" || !send) {
        toast.error(frontendMessage("config.mainOffline"));
        return null;
      }
      if (!configSnapshot) {
        toast.error(frontendMessage("config.mainFailed"));
        return null;
      }
      const requestId = generateId();
      pendingRef.current.add(requestId);
      dispatch({
        type: "config",
        operation: { requestId, kind: "config_update", status: "pending", updatedAt: timestamp() },
      });
      if (
        !send({
          type: "config.update",
          requestId,
          config,
          ...readConfigRevisionGuard(configSnapshot),
          mirrorJson: true,
        })
      ) {
        pendingRef.current.delete(requestId);
        dispatch({ type: "config", operation: null });
        toast.error(frontendMessage("config.mainDisconnected"));
        return null;
      }
      return requestId;
    },
    [configSnapshot, sendRef, statusRef],
  );
  const fetchProviderModels = useCallback(
    (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput): void => {
      const send = sendRef.current;
      if (statusRef.current !== "open" || !send) {
        toast.error(frontendMessage("config.providerModelsOffline"));
        return;
      }
      dispatch({ type: "started", providerId });
      if (!send({ type: "provider.models.fetch", providerId, force, endpoint })) {
        dispatch({ type: "finished", providerId });
        toast.error(frontendMessage("config.providerModelsDisconnected"));
      }
    },
    [sendRef, statusRef],
  );
  const ingestConfigCommandEvent = useCallback((env: EventEnvelope): boolean => {
    if (env.kind === EventKinds.ProviderModelsSnapshot) {
      dispatch({ type: "finished", providerId: (env.data as ProviderModelsSnapshotData).providerId });
      return true;
    }
    if (env.kind === EventKinds.ProviderModelsFailed) {
      const data = env.data as ProviderModelsFailedData;
      dispatch({ type: "finished", providerId: data.providerId });
      toast.error(frontendMessage("config.providerModelsFailed"), { description: data.message });
      return true;
    }
    const data = env.data as ConfigSnapshotData | ConfigFailedData;
    const requestId = data.operation?.requestId;
    if (!requestId || !pendingRef.current.has(requestId) || data.operation?.kind !== "config_update") return false;
    pendingRef.current.delete(requestId);
    if (env.kind === EventKinds.ConfigSnapshot) {
      dispatch({
        type: "config",
        operation: { requestId, kind: "config_update", status: "success", updatedAt: timestamp() },
      });
    } else if (env.kind === EventKinds.ConfigFailed) {
      dispatch({
        type: "config",
        operation: {
          requestId,
          kind: "config_update",
          status: "error",
          message: (data as ConfigFailedData).message,
          errorCode: readConfigFailureCode((data as ConfigFailedData).details),
          updatedAt: timestamp(),
        },
      });
      toast.error(frontendMessage("config.mainFailed"), { description: (data as ConfigFailedData).message });
    } else return false;
    return true;
  }, []);
  return useMemo(
    () => ({
      ...state,
      fetchProviderModels,
      ingestConfigCommandEvent,
      refreshConfig,
      refreshPluginConfigs,
      refreshPresets,
      saveConfig,
    }),
    [
      fetchProviderModels,
      ingestConfigCommandEvent,
      refreshConfig,
      refreshPluginConfigs,
      refreshPresets,
      saveConfig,
      state,
    ],
  );
}

function reducer(state: State, action: Action): State {
  if (action.type === "config") return { ...state, configOperation: action.operation };
  if (action.type === "started")
    return { ...state, providerModelLoadingIds: { ...state.providerModelLoadingIds, [action.providerId]: true } };
  const providerModelLoadingIds = { ...state.providerModelLoadingIds };
  delete providerModelLoadingIds[action.providerId];
  return { ...state, providerModelLoadingIds };
}

function sendIfOpen(
  sendRef: MutableRefObject<SendRequest | null>,
  statusRef: MutableRefObject<SocketStatus>,
  request: WsRequest,
): void {
  if (statusRef.current === "open") sendRef.current?.(request);
}

function timestamp(): string {
  return new Date().toISOString();
}
