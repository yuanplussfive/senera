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
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { readConfigFailureCode } from "./configMutationFailure";
import type { SystemConfigCommandQueue, SystemConfigCommandTransportFailure } from "./useSystemConfigCommandQueue";

type SendRequest = (request: WsRequest) => boolean;

export interface ConfigCommandTransport {
  commandQueue: SystemConfigCommandQueue;
  sendRef: MutableRefObject<SendRequest | null>;
  statusRef: MutableRefObject<SocketStatus>;
}

type State = { configOperation: ConfigMutationState | null; providerModelLoadingIds: Record<string, boolean> };
type Action =
  | { type: "config"; operation: ConfigMutationState | null }
  | { type: "started"; providerId: string }
  | { type: "finished"; providerId: string };
const initialState: State = { configOperation: null, providerModelLoadingIds: {} };

export function useConfigCommands({ commandQueue, sendRef, statusRef }: ConfigCommandTransport) {
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
      let commandId: string | null = null;
      const handleTransportFailure = (failure: SystemConfigCommandTransportFailure): void => {
        if (commandId) {
          pendingRef.current.delete(commandId);
          dispatch({
            type: "config",
            operation: {
              commandId,
              kind: "config_update",
              status: "error",
              message: frontendMessage(
                failure === "config_unavailable"
                  ? "config.mainFailed"
                  : failure === "offline"
                    ? "config.mainOffline"
                    : "config.mainDisconnected",
              ),
              updatedAt: timestamp(),
            },
          });
        }
        toast.error(
          frontendMessage(
            failure === "config_unavailable"
              ? "config.mainFailed"
              : failure === "offline"
                ? "config.mainOffline"
                : "config.mainDisconnected",
          ),
        );
      };
      commandId = commandQueue.enqueue({
        operationKind: "config_update",
        coalesceKey: "config.update",
        request: (snapshot) => ({
          type: "config.update",
          config,
          ...(typeof snapshot.revision === "number"
            ? { baseRevision: snapshot.revision }
            : { baseVersion: snapshot.version }),
        }),
        onTransportFailure: handleTransportFailure,
      });
      if (!commandId) return null;
      pendingRef.current.add(commandId);
      dispatch({
        type: "config",
        operation: { commandId, kind: "config_update", status: "pending", updatedAt: timestamp() },
      });
      return commandId;
    },
    [commandQueue],
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
    const operation = data.operation && "commandId" in data.operation ? data.operation : undefined;
    const commandId = operation?.commandId;
    if (!commandId || !pendingRef.current.has(commandId) || operation.kind !== "config_update") return false;
    pendingRef.current.delete(commandId);
    if (env.kind === EventKinds.ConfigSnapshot) {
      dispatch({
        type: "config",
        operation: { commandId, kind: "config_update", status: "success", updatedAt: timestamp() },
      });
    } else if (env.kind === EventKinds.ConfigFailed) {
      dispatch({
        type: "config",
        operation: {
          commandId,
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
