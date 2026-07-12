import { useCallback, useMemo, useReducer, useRef } from "react";
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
} from "../api/eventTypes";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import type { ConfigMutationTransport } from "./useConfigMutationTransport";

interface PendingSystemConfigOperation {
  kind: "config_update";
}

interface SystemConfigMutationState {
  configOperation: ConfigMutationState | null;
  providerModelLoadingIds: Record<string, boolean>;
}

type SystemConfigMutationAction =
  | { type: "config_operation_set"; operation: ConfigMutationState | null }
  | { type: "provider_models_started"; providerId: string }
  | { type: "provider_models_finished"; providerId: string };

const initialState: SystemConfigMutationState = {
  configOperation: null,
  providerModelLoadingIds: {},
};

export interface SystemConfigMutations {
  configOperation: ConfigMutationState | null;
  fetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
  ingestEvent: (env: EventEnvelope) => boolean;
  providerModelLoadingIds: Record<string, boolean>;
  refresh: () => void;
  save: (config: Record<string, unknown>) => string | null;
}

export function useSystemConfigMutations(transport: ConfigMutationTransport): SystemConfigMutations {
  const [state, dispatch] = useReducer(systemConfigMutationReducer, initialState);
  const pendingRef = useRef<Map<string, PendingSystemConfigOperation>>(new Map());

  const refresh = useCallback((): void => {
    transport.sendWhenOpen({ type: "config.get" });
  }, [transport]);

  const save = useCallback(
    (config: Record<string, unknown>): string | null => {
      const send = transport.readOpenTransport(frontendMessage("config.mainOffline"));
      if (!send) return null;

      const requestId = generateId();
      const pending: PendingSystemConfigOperation = { kind: "config_update" };
      pendingRef.current.set(requestId, pending);
      dispatch({
        type: "config_operation_set",
        operation: {
          requestId,
          kind: pending.kind,
          status: "pending",
          updatedAt: timestamp(),
        },
      });

      if (send({ type: "config.update", requestId, config, mirrorJson: true })) {
        return requestId;
      }

      pendingRef.current.delete(requestId);
      dispatch({ type: "config_operation_set", operation: null });
      toast.error(frontendMessage("config.mainDisconnected"));
      return null;
    },
    [transport],
  );

  const fetchProviderModels = useCallback(
    (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput): void => {
      const send = transport.readOpenTransport(frontendMessage("config.providerModelsOffline"));
      if (!send) return;

      dispatch({ type: "provider_models_started", providerId });
      if (send({ type: "provider.models.fetch", providerId, force, endpoint })) {
        return;
      }
      dispatch({ type: "provider_models_finished", providerId });
      toast.error(frontendMessage("config.providerModelsDisconnected"));
    },
    [transport],
  );

  const ingestEvent = useCallback((env: EventEnvelope): boolean => {
    if (env.kind === EventKinds.ConfigSnapshot) {
      const data = env.data as ConfigSnapshotData;
      const requestId = data.operation?.requestId;
      const pending = requestId ? pendingRef.current.get(requestId) : undefined;
      if (requestId && pending) {
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

    if (env.kind !== EventKinds.ConfigFailed) return false;
    const data = env.data as ConfigFailedData;
    if (data.operation?.kind !== "config_update") return false;

    const requestId = data.operation?.requestId;
    const pending = requestId ? pendingRef.current.get(requestId) : undefined;
    if (requestId && pending) {
      pendingRef.current.delete(requestId);
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
    return true;
  }, []);

  return useMemo(
    () => ({
      configOperation: state.configOperation,
      fetchProviderModels,
      ingestEvent,
      providerModelLoadingIds: state.providerModelLoadingIds,
      refresh,
      save,
    }),
    [fetchProviderModels, ingestEvent, refresh, save, state.configOperation, state.providerModelLoadingIds],
  );
}

function systemConfigMutationReducer(
  state: SystemConfigMutationState,
  action: SystemConfigMutationAction,
): SystemConfigMutationState {
  switch (action.type) {
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
  }
}

function timestamp(): string {
  return new Date().toISOString();
}
