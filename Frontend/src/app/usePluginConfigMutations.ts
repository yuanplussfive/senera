import { useCallback, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";
import {
  EventKinds,
  type ConfigFailedData,
  type EventEnvelope,
  type PluginConfigMutationState,
  type PluginConfigOperationKind,
  type PluginConfigSnapshotData,
} from "../api/eventTypes";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import type { ConfigMutationTransport } from "./useConfigMutationTransport";

type PendingPluginConfigKind = Extract<PluginConfigOperationKind, "update" | "set_enabled">;

interface PendingPluginConfigOperation {
  pluginName: string;
  kind: PendingPluginConfigKind;
}

type PluginConfigMutationAction =
  { type: "upsert"; operation: PluginConfigMutationState } | { type: "remove"; requestId: string };

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

export interface PluginConfigMutations {
  ingestEvent: (env: EventEnvelope) => boolean;
  operations: Record<string, PluginConfigMutationState>;
  refresh: () => void;
  save: (pluginName: string, toml: string) => string | null;
  setEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
}

export function usePluginConfigMutations(transport: ConfigMutationTransport): PluginConfigMutations {
  const [operations, dispatch] = useReducer(pluginConfigMutationReducer, {});
  const pendingRef = useRef<Map<string, PendingPluginConfigOperation>>(new Map());

  const refresh = useCallback((): void => {
    transport.sendWhenOpen({ type: "plugin.config.list" });
  }, [transport]);

  const startOperation = useCallback(
    (
      pending: PendingPluginConfigOperation,
      request:
        | { type: "plugin.config.update"; pluginName: string; toml: string }
        | {
            type: "plugin.config.set_enabled";
            pluginName: string;
            enabled: boolean;
            toolName?: string;
          },
    ): string | null => {
      const send = transport.readOpenTransport(pluginConfigCopy[pending.kind].offline);
      if (!send) return null;

      const requestId = generateId();
      pendingRef.current.set(requestId, pending);
      dispatch({
        type: "upsert",
        operation: {
          requestId,
          pluginName: pending.pluginName,
          kind: pending.kind,
          status: "pending",
          updatedAt: timestamp(),
        },
      });

      if (send({ ...request, requestId })) {
        return requestId;
      }

      pendingRef.current.delete(requestId);
      dispatch({ type: "remove", requestId });
      toast.error(pluginConfigCopy[pending.kind].disconnected);
      return null;
    },
    [transport],
  );

  const save = useCallback(
    (pluginName: string, toml: string): string | null =>
      startOperation(
        { pluginName, kind: "update" },
        {
          type: "plugin.config.update",
          pluginName,
          toml,
        },
      ),
    [startOperation],
  );

  const setEnabled = useCallback(
    (pluginName: string, enabled: boolean, toolName?: string): string | null =>
      startOperation(
        { pluginName, kind: "set_enabled" },
        {
          type: "plugin.config.set_enabled",
          pluginName,
          enabled,
          toolName,
        },
      ),
    [startOperation],
  );

  const ingestEvent = useCallback((env: EventEnvelope): boolean => {
    if (env.kind === EventKinds.PluginConfigSnapshot) {
      const data = env.data as PluginConfigSnapshotData;
      const requestId = data.operation?.requestId;
      const pending = requestId ? pendingRef.current.get(requestId) : undefined;
      if (requestId && pending) {
        pendingRef.current.delete(requestId);
        dispatch({
          type: "upsert",
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
      return true;
    }

    if (env.kind !== EventKinds.ConfigFailed) return false;
    const data = env.data as ConfigFailedData;
    if (data.operation?.kind === "config_update") return false;

    const requestId = data.operation?.requestId;
    const pending = requestId ? pendingRef.current.get(requestId) : undefined;
    if (requestId && pending) {
      pendingRef.current.delete(requestId);
      dispatch({
        type: "upsert",
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
    return true;
  }, []);

  return useMemo(
    () => ({
      ingestEvent,
      operations,
      refresh,
      save,
      setEnabled,
    }),
    [ingestEvent, operations, refresh, save, setEnabled],
  );
}

function pluginConfigMutationReducer(
  state: Record<string, PluginConfigMutationState>,
  action: PluginConfigMutationAction,
): Record<string, PluginConfigMutationState> {
  if (action.type === "upsert") {
    return {
      ...state,
      [action.operation.requestId]: action.operation,
    };
  }
  const next = { ...state };
  delete next[action.requestId];
  return next;
}

function timestamp(): string {
  return new Date().toISOString();
}
