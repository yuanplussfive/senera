import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import {
  EventKinds,
  type ConfigFailedData,
  type EventEnvelope,
  type PluginConfigItem,
  type PluginConfigMutationState,
  type PluginConfigOperationKind,
  type PluginConfigSnapshotData,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { useStore } from "../store/sessionStore";

type PendingPluginConfigOperation = {
  pluginName: string;
  kind: Extract<PluginConfigOperationKind, "update" | "set_enabled">;
};

type PluginConfigMutationRequest =
  | { type: "plugin.config.update"; pluginName: string; toml: string }
  | { type: "plugin.config.set_enabled"; pluginName: string; toolName?: string; enabled: boolean };

export type PluginSettingsEventResolution =
  | {
      kind: "plugin_config_success";
      requestId: string;
    }
  | {
      kind: "plugin_config_failed";
      requestId?: string;
      message: string;
    };

export interface PluginSettingsCommandsHandle {
  pluginConfigs: PluginConfigItem[];
  pluginConfigOperations: Record<string, PluginConfigMutationState>;
  socketStatus: SocketStatus;
  handlePluginSettingsEvent: (env: EventEnvelope) => boolean;
  refreshPluginConfigs: () => void;
  savePluginConfig: (pluginName: string, toml: string) => string | null;
  setPluginEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
}

export interface UsePluginSettingsCommandsOptions {
  send: (request: WsRequest) => boolean;
  status: SocketStatus;
}

export function resolvePluginSettingsEvent(
  env: EventEnvelope,
  pendingPluginRequestIds: ReadonlySet<string>,
): PluginSettingsEventResolution | null {
  if (env.kind === EventKinds.PluginConfigSnapshot) {
    const data = env.data as PluginConfigSnapshotData;
    const requestId = data.operation?.requestId;
    if (requestId && pendingPluginRequestIds.has(requestId)) {
      return {
        kind: "plugin_config_success",
        requestId,
      };
    }
    return null;
  }

  if (env.kind === EventKinds.ConfigFailed) {
    const data = env.data as ConfigFailedData;
    const requestId = data.operation?.requestId;
    if (
      requestId &&
      pendingPluginRequestIds.has(requestId) &&
      (data.operation?.kind === "update" || data.operation?.kind === "set_enabled")
    ) {
      return {
        kind: "plugin_config_failed",
        requestId,
        message: data.message,
      };
    }
  }

  return null;
}

export function usePluginSettingsCommands({
  send,
  status,
}: UsePluginSettingsCommandsOptions): PluginSettingsCommandsHandle {
  const pluginConfigs = useStore((s) => s.pluginConfigs);
  const [pluginConfigOperations, setPluginConfigOperations] = useState<Record<string, PluginConfigMutationState>>({});
  const pendingPluginConfigOpsRef = useRef<Map<string, PendingPluginConfigOperation>>(new Map());

  const handlePluginSettingsEvent = useCallback((env: EventEnvelope): boolean => {
    const resolution = resolvePluginSettingsEvent(env, new Set(pendingPluginConfigOpsRef.current.keys()));
    if (!resolution) return false;

    if (resolution.kind === "plugin_config_success") {
      const pending = pendingPluginConfigOpsRef.current.get(resolution.requestId);
      if (!pending) return true;
      pendingPluginConfigOpsRef.current.delete(resolution.requestId);
      setPluginConfigOperations((operations) => ({
        ...operations,
        [resolution.requestId]: {
          requestId: resolution.requestId,
          pluginName: pending.pluginName,
          kind: pending.kind,
          status: "success",
          updatedAt: new Date().toISOString(),
        },
      }));
      return true;
    }

    const pending = resolution.requestId ? pendingPluginConfigOpsRef.current.get(resolution.requestId) : undefined;
    if (resolution.requestId && pending) {
      const requestId = resolution.requestId;
      pendingPluginConfigOpsRef.current.delete(requestId);
      setPluginConfigOperations((operations) => ({
        ...operations,
        [requestId]: {
          requestId,
          pluginName: pending.pluginName,
          kind: pending.kind,
          status: "error",
          message: resolution.message,
          updatedAt: new Date().toISOString(),
        },
      }));
      toast.error(
        frontendMessage(pending.kind === "update" ? "pluginConfig.saveFailed" : "pluginConfig.setEnabledFailed"),
        {
          description: resolution.message,
        },
      );
      return true;
    }

    return false;
  }, []);

  const refreshPluginConfigs = useCallback((): void => {
    if (status !== "open") return;
    send({ type: "plugin.config.list" });
  }, [send, status]);

  const savePluginConfig = useCallback(
    (pluginName: string, toml: string): string | null => {
      if (status !== "open") {
        toast.error(frontendMessage("pluginConfig.saveOffline"));
        return null;
      }
      return startPluginOperation({
        send,
        setPluginConfigOperations,
        pendingPluginConfigOpsRef,
        pending: {
          pluginName,
          kind: "update",
        },
        request: {
          type: "plugin.config.update",
          pluginName,
          toml,
        },
        failureToast: frontendMessage("pluginConfig.saveDisconnected"),
      });
    },
    [send, status],
  );

  const setPluginEnabled = useCallback(
    (pluginName: string, enabled: boolean, toolName?: string): string | null => {
      if (status !== "open") {
        toast.error(frontendMessage("pluginConfig.setEnabledOffline"));
        return null;
      }
      return startPluginOperation({
        send,
        setPluginConfigOperations,
        pendingPluginConfigOpsRef,
        pending: {
          pluginName,
          kind: "set_enabled",
        },
        request: {
          type: "plugin.config.set_enabled",
          pluginName,
          toolName,
          enabled,
        },
        failureToast: frontendMessage("pluginConfig.setEnabledDisconnected"),
      });
    },
    [send, status],
  );

  return {
    pluginConfigs,
    pluginConfigOperations,
    socketStatus: status,
    handlePluginSettingsEvent,
    refreshPluginConfigs,
    savePluginConfig,
    setPluginEnabled,
  };
}

function startPluginOperation({
  send,
  setPluginConfigOperations,
  pendingPluginConfigOpsRef,
  pending,
  request,
  failureToast,
}: {
  send: (request: WsRequest) => boolean;
  setPluginConfigOperations: Dispatch<SetStateAction<Record<string, PluginConfigMutationState>>>;
  pendingPluginConfigOpsRef: MutableRefObject<Map<string, PendingPluginConfigOperation>>;
  pending: PendingPluginConfigOperation;
  request: PluginConfigMutationRequest;
  failureToast: string;
}): string | null {
  const requestId = generateId();
  pendingPluginConfigOpsRef.current.set(requestId, pending);
  setPluginConfigOperations((operations) => ({
    ...operations,
    [requestId]: {
      requestId,
      pluginName: pending.pluginName,
      kind: pending.kind,
      status: "pending",
      updatedAt: new Date().toISOString(),
    },
  }));
  const ok = send({
    ...request,
    requestId,
  } as WsRequest);
  if (!ok) {
    pendingPluginConfigOpsRef.current.delete(requestId);
    setPluginConfigOperations((operations) => {
      const next = { ...operations };
      delete next[requestId];
      return next;
    });
    toast.error(failureToast);
    return null;
  }
  return requestId;
}
