import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import {
  EventKinds,
  type EventEnvelope,
  type McpInputMutationState,
  type McpInputValue,
  type McpServerSnapshotData,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import type { SettingsSystemConfigHandle } from "../features/settings/SettingsContracts";
import { useStore } from "../store/sessionStore";
import { useConfigMutationController, type ConfigMutationController } from "./useConfigMutationController";
import { generateId } from "../lib/util";
import { resolveBackendMessage } from "../i18n/backendMessage";

export interface SettingsRuntimeHandle {
  controller: ConfigMutationController;
  systemConfig: SettingsSystemConfigHandle;
  ingestSettingsEvent: (event: EventEnvelope) => boolean;
}

export function useSettingsRuntime({
  sendRef,
  statusRef,
}: {
  sendRef: MutableRefObject<((request: WsRequest) => boolean) | null>;
  statusRef: MutableRefObject<SocketStatus>;
}): SettingsRuntimeHandle {
  const configSnapshot = useStore((state) => state.configSnapshot);
  const providerModelCatalogs = useStore((state) => state.providerModelCatalogs);
  const providerModelErrors = useStore((state) => state.providerModelErrors);
  const systemTools = useStore((state) => state.systemTools);
  const systemExtensions = useStore((state) => state.systemExtensions);
  const mcpServers = useStore((state) => state.mcpServers);
  const toolSettingsSynced = useStore((state) => state.toolSettingsSynced);
  const [mcpInputOperation, setMcpInputOperation] = useState<McpInputMutationState | null>(null);
  const controller = useConfigMutationController({ configSnapshot, sendRef, statusRef });
  const sendWhenConnected = useCallback(
    (request: WsRequest): boolean => statusRef.current === "open" && Boolean(sendRef.current?.(request)),
    [sendRef, statusRef],
  );
  const refreshToolSettings = useCallback((): boolean => {
    const systemToolsSent = sendWhenConnected({ type: "systemTool.list" });
    const mcpServersSent = sendWhenConnected({ type: "mcpServer.list" });
    return systemToolsSent && mcpServersSent;
  }, [sendWhenConnected]);
  const updateMcpInputs = useCallback(
    (serverId: string, values: Record<string, McpInputValue>, deletes?: string[]): string | null => {
      const requestId = generateId();
      if (
        !sendWhenConnected({
          type: "mcpInput.update",
          requestId,
          serverId,
          values,
          ...(deletes?.length ? { deletes } : {}),
        })
      ) {
        return null;
      }
      setMcpInputOperation({ requestId, status: "pending" });
      return requestId;
    },
    [sendWhenConnected],
  );
  const restartMcpServer = useCallback(
    (serverId: string): boolean => sendWhenConnected({ type: "mcpServer.restart", serverId }),
    [sendWhenConnected],
  );

  const systemConfig = useMemo<SettingsSystemConfigHandle>(
    () => ({
      ...controller,
      configSnapshot,
      systemTools,
      systemExtensions,
      mcpServers,
      toolSettingsSynced,
      mcpInputOperation,
      providerModelCatalogs,
      providerModelErrors,
      refreshToolSettings,
      updateMcpInputs,
      restartMcpServer,
    }),
    [
      configSnapshot,
      controller,
      mcpServers,
      mcpInputOperation,
      providerModelCatalogs,
      providerModelErrors,
      refreshToolSettings,
      restartMcpServer,
      updateMcpInputs,
      systemExtensions,
      systemTools,
      toolSettingsSynced,
    ],
  );

  const ingestSettingsEvent = useCallback(
    (event: EventEnvelope): boolean => {
      const configHandled = controller.ingestConfigMutationEvent(event);
      if (event.kind === EventKinds.McpServerSnapshot) {
        const operation = (event.data as McpServerSnapshotData).operation;
        if (operation?.kind === "mcp_input_update") {
          setMcpInputOperation({ requestId: operation.requestId, status: "success" });
          return true;
        }
      }
      if (event.kind === EventKinds.RequestInvalid) {
        const data = event.data as { message?: string; details?: Record<string, unknown> };
        if (data.details?.requestType === "mcpInput.update" && typeof data.details.requestId === "string") {
          setMcpInputOperation({
            requestId: data.details.requestId,
            status: "error",
            message: resolveBackendMessage(data),
          });
          return true;
        }
      }
      return configHandled;
    },
    [controller],
  );

  return { controller, systemConfig, ingestSettingsEvent };
}
