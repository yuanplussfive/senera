import { useCallback, useRef, useState } from "react";
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
import { useStore } from "../store/sessionStore";

type PendingConfigOperation = {
  kind: "config_update";
};

export type ConfigSettingsEventResolution =
  | {
      kind: "config_update_success";
      requestId: string;
    }
  | {
      kind: "config_update_failed";
      requestId?: string;
      message: string;
    }
  | {
      kind: "provider_models_finished";
      providerId: string;
      message?: string;
    };

export interface ConfigSettingsCommandsHandle {
  configSnapshot: ConfigSnapshotData | null;
  configOperation: ConfigMutationState | null;
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  providerModelLoadingIds: Record<string, boolean>;
  handleConfigSettingsEvent: (env: EventEnvelope) => boolean;
  refreshConfig: () => void;
  saveConfig: (config: Record<string, unknown>) => string | null;
  fetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
}

export interface UseConfigSettingsCommandsOptions {
  send: (request: WsRequest) => boolean;
  status: SocketStatus;
}

export function resolveConfigSettingsEvent(
  env: EventEnvelope,
  pendingConfigRequestIds: ReadonlySet<string>,
): ConfigSettingsEventResolution | null {
  if (env.kind === EventKinds.ConfigSnapshot) {
    const data = env.data as ConfigSnapshotData;
    const requestId = data.operation?.requestId;
    if (data.operation?.kind === "config_update" && requestId && pendingConfigRequestIds.has(requestId)) {
      return {
        kind: "config_update_success",
        requestId,
      };
    }
    return null;
  }

  if (env.kind === EventKinds.ConfigFailed) {
    const data = env.data as ConfigFailedData;
    if (data.operation?.kind === "config_update") {
      return {
        kind: "config_update_failed",
        requestId: data.operation.requestId,
        message: data.message,
      };
    }
    return null;
  }

  if (env.kind === EventKinds.ProviderModelsSnapshot) {
    const data = env.data as ProviderModelsSnapshotData;
    return {
      kind: "provider_models_finished",
      providerId: data.providerId,
    };
  }

  if (env.kind === EventKinds.ProviderModelsFailed) {
    const data = env.data as ProviderModelsFailedData;
    return {
      kind: "provider_models_finished",
      providerId: data.providerId,
      message: data.message,
    };
  }

  return null;
}

export function useConfigSettingsCommands({
  send,
  status,
}: UseConfigSettingsCommandsOptions): ConfigSettingsCommandsHandle {
  const configSnapshot = useStore((s) => s.configSnapshot);
  const providerModelCatalogs = useStore((s) => s.providerModelCatalogs);
  const providerModelErrors = useStore((s) => s.providerModelErrors);
  const [configOperation, setConfigOperation] = useState<ConfigMutationState | null>(null);
  const [providerModelLoadingIds, setProviderModelLoadingIds] = useState<Record<string, boolean>>({});
  const pendingConfigOpsRef = useRef<Map<string, PendingConfigOperation>>(new Map());

  const handleConfigSettingsEvent = useCallback((env: EventEnvelope): boolean => {
    const resolution = resolveConfigSettingsEvent(env, new Set(pendingConfigOpsRef.current.keys()));
    if (!resolution) return false;

    if (resolution.kind === "config_update_success") {
      const pending = pendingConfigOpsRef.current.get(resolution.requestId);
      if (!pending) return true;
      pendingConfigOpsRef.current.delete(resolution.requestId);
      setConfigOperation({
        requestId: resolution.requestId,
        kind: pending.kind,
        status: "success",
        updatedAt: new Date().toISOString(),
      });
      toast.success(frontendMessage("config.mainSaved"));
      return true;
    }

    if (resolution.kind === "config_update_failed") {
      const pending = resolution.requestId ? pendingConfigOpsRef.current.get(resolution.requestId) : undefined;
      if (resolution.requestId && pending) {
        pendingConfigOpsRef.current.delete(resolution.requestId);
        setConfigOperation({
          requestId: resolution.requestId,
          kind: pending.kind,
          status: "error",
          message: resolution.message,
          updatedAt: new Date().toISOString(),
        });
      }
      toast.error(frontendMessage("config.mainFailed"), {
        description: resolution.message,
      });
      return true;
    }

    setProviderModelLoadingIds((current) => {
      const next = { ...current };
      delete next[resolution.providerId];
      return next;
    });
    if (resolution.message) {
      toast.error(frontendMessage("config.providerModelsFailed"), {
        description: resolution.message,
      });
    }
    return true;
  }, []);

  const refreshConfig = useCallback((): void => {
    if (status !== "open") return;
    send({ type: "config.get" });
  }, [send, status]);

  const saveConfig = useCallback((config: Record<string, unknown>): string | null => {
    if (status !== "open") {
      toast.error(frontendMessage("config.mainOffline"));
      return null;
    }
    const requestId = generateId();
    pendingConfigOpsRef.current.set(requestId, {
      kind: "config_update",
    });
    setConfigOperation({
      requestId,
      kind: "config_update",
      status: "pending",
      updatedAt: new Date().toISOString(),
    });
    const ok = send({
      type: "config.update",
      requestId,
      config,
      mirrorJson: true,
    });
    if (!ok) {
      pendingConfigOpsRef.current.delete(requestId);
      setConfigOperation(null);
      toast.error(frontendMessage("config.mainDisconnected"));
      return null;
    }
    return requestId;
  }, [send, status]);

  const fetchProviderModels = useCallback((
    providerId: string,
    force?: boolean,
    endpoint?: ProviderModelEndpointInput,
  ): void => {
    if (status !== "open") {
      toast.error(frontendMessage("config.providerModelsOffline"));
      return;
    }
    setProviderModelLoadingIds((current) => ({
      ...current,
      [providerId]: true,
    }));
    const ok = send({
      type: "provider.models.fetch",
      providerId,
      force,
      endpoint,
    });
    if (!ok) {
      setProviderModelLoadingIds((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      toast.error(frontendMessage("config.providerModelsDisconnected"));
    }
  }, [send, status]);

  return {
    configSnapshot,
    configOperation,
    providerModelCatalogs,
    providerModelErrors,
    providerModelLoadingIds,
    handleConfigSettingsEvent,
    refreshConfig,
    saveConfig,
    fetchProviderModels,
  };
}
