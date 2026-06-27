import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { TooltipProvider } from "./shared/ui";
import { useAgentSocket } from "./api/useAgentSocket";
import { buildUploadUrl } from "./api/uploadClient";
import { useStore } from "./store/sessionStore";
import { ChatPanel } from "./features/chat";
import { SessionList } from "./features/session";
import { ThinkingTimeline } from "./features/workflow";
import { AppShell, readAppShellRenderPlan } from "./layout/AppShell";
import {
  EventKinds,
  type ConfigMutationState,
  type ConfigFailedData,
  type ConfigSnapshotData,
  type PresetFailedData,
  type PresetFormat,
  type ProviderModelEndpointInput,
  type ProviderModelsFailedData,
  type ProviderModelsSnapshotData,
  type PluginConfigMutationState,
  type PluginConfigSnapshotData,
  type PresetMutationState,
  type PresetSnapshotData,
  type WsRequest,
} from "./api/eventTypes";
import {
  useChatCommands,
  type LastSentMessage,
  type PendingAfterTruncate,
} from "./app/useChatCommands";
import { useGlobalShortcuts } from "./app/useGlobalShortcuts";
import { useSessionCommands } from "./app/useSessionCommands";
import { useSessionCatalogSync } from "./app/useSessionCatalogSync";
import { useSessionHistoryRecovery } from "./app/useSessionHistoryRecovery";
import { useSessionNotFoundRecovery } from "./app/useSessionNotFoundRecovery";
import { useSessionTruncateReplay } from "./app/useSessionTruncateReplay";
import { useServerKnownSessions } from "./app/useServerKnownSessions";
import { useSocketErrorToasts } from "./app/useSocketErrorToasts";
import { useSocketPostIngestEffects } from "./app/useSocketPostIngestEffects";
import { useWorkflowNavigation } from "./app/useWorkflowNavigation";
import { useResponsiveMode } from "./shared/responsive";
import { installCopyableToasts } from "./shared/ui/installCopyableToasts";
import { generateId } from "./lib/util";

const WS_URL = __SENERA_DEFAULT_WS_URL__;
installCopyableToasts();

type PendingPluginConfigOperation = {
  pluginName: string;
  kind: "update" | "set_enabled";
};

type PendingConfigOperation = {
  kind: "config_update";
};

type PendingPresetOperation = {
  name?: string | null;
  kind: "save" | "delete" | "set_active";
};

function presetSuccessToast(kind: PendingPresetOperation["kind"]): string {
  switch (kind) {
    case "save":
      return "角色预设已保存";
    case "delete":
      return "角色预设已删除";
    case "set_active":
      return "角色预设状态已更新";
  }
}

function presetFailureToast(kind: PendingPresetOperation["kind"]): string {
  switch (kind) {
    case "save":
      return "角色预设保存失败";
    case "delete":
      return "角色预设删除失败";
    case "set_active":
      return "角色预设状态更新失败";
  }
}

export function App(): JSX.Element {
  const ingest = useStore((s) => s.ingest);
  const registerSession = useStore((s) => s.registerCreatingSession);
  const appendUserMessage = useStore((s) => s.appendUserMessage);
  const activeId = useStore((s) => s.activeSessionId);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const modelProviders = useStore((s) => s.modelProviders);
  const selectedModelProviderId = useStore((s) => s.selectedModelProviderId);
  const selectModelProvider = useStore((s) => s.selectModelProvider);
  const pluginConfigs = useStore((s) => s.pluginConfigs);
  const configSnapshot = useStore((s) => s.configSnapshot);
  const providerModelCatalogs = useStore((s) => s.providerModelCatalogs);
  const providerModelErrors = useStore((s) => s.providerModelErrors);
  const presets = useStore((s) => s.presets);
  const activePresetName = useStore((s) => s.activePresetName);
  const presetsEnabled = useStore((s) => s.presetsEnabled);
  const presetRootDir = useStore((s) => s.presetRootDir);
  const userProfile = useStore((s) => s.userProfile);
  const markUserProfileSynced = useStore((s) => s.markUserProfileSynced);
  const responsiveMode = useResponsiveMode();
  const { hasPersistentSessionPanel, hasPersistentWorkflowPanel } = responsiveMode;
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false);
  const [pluginConfigOperations, setPluginConfigOperations] = useState<Record<string, PluginConfigMutationState>>({});
  const [configOperation, setConfigOperation] = useState<ConfigMutationState | null>(null);
  const [providerModelLoadingIds, setProviderModelLoadingIds] = useState<Record<string, boolean>>({});
  const [presetOperations, setPresetOperations] = useState<Record<string, PresetMutationState>>({});
  const uploadUrl = useMemo(() => buildUploadUrl(WS_URL), []);
  const appShellRenderPlan = readAppShellRenderPlan(responsiveMode);

  const sendRef = useRef<((req: WsRequest) => boolean) | null>(null);
  const lastSendRef = useRef<LastSentMessage | null>(null);
  const pendingAfterTruncateRef = useRef<PendingAfterTruncate[]>([]);
  const pendingPluginConfigOpsRef = useRef<Map<string, PendingPluginConfigOperation>>(new Map());
  const pendingConfigOpsRef = useRef<Map<string, PendingConfigOperation>>(new Map());
  const pendingPresetOpsRef = useRef<Map<string, PendingPresetOperation>>(new Map());

  const handleOpenSessionPanel = useCallback((): void => {
    if (hasPersistentSessionPanel) {
      setSidebarCollapsed(false);
      return;
    }
    setSessionDrawerOpen(true);
  }, [hasPersistentSessionPanel, setSidebarCollapsed]);

  const {
    resetServerKnownSessions,
    serverKnownSessionIdsRef,
    syncServerKnownSessionFromEvent,
  } = useServerKnownSessions();
  const { notifySocketError } = useSocketErrorToasts();
  const { handleSessionNotFound } = useSessionNotFoundRecovery({
    ingest,
    lastSendRef,
    sendRef,
    serverKnownSessionIdsRef,
  });
  const { runSocketPostIngestEffects } = useSocketPostIngestEffects({
    markUserProfileSynced,
    sendRef,
  });
  const { replayAfterSessionTruncated } = useSessionTruncateReplay({
    appendUserMessage,
    lastSendRef,
    pendingAfterTruncateRef,
    sendRef,
  });

  const { status, send } = useAgentSocket({
    url: WS_URL,
    onEvent: useCallback(
      (env) => {
        syncServerKnownSessionFromEvent(env);

        if (handleSessionNotFound(env)) {
          return;
        }

        notifySocketError(env);
        ingest(env);
        runSocketPostIngestEffects(env);

        if (env.kind === EventKinds.PluginConfigSnapshot) {
          const operation = (env.data as PluginConfigSnapshotData).operation;
          const requestId = operation?.requestId;
          const pending = requestId ? pendingPluginConfigOpsRef.current.get(requestId) : undefined;
          if (requestId && pending) {
            pendingPluginConfigOpsRef.current.delete(requestId);
            setPluginConfigOperations((operations) => ({
              ...operations,
              [requestId]: {
                requestId,
                pluginName: pending.pluginName,
                kind: pending.kind,
                status: "success",
                updatedAt: new Date().toISOString(),
              },
            }));
            toast.success(pending.kind === "update" ? "插件配置已保存" : "插件状态已更新");
          }
        }

        if (env.kind === EventKinds.PresetSnapshot) {
          const operation = (env.data as PresetSnapshotData).operation;
          const requestId = operation?.requestId;
          const pending = requestId ? pendingPresetOpsRef.current.get(requestId) : undefined;
          if (requestId && pending) {
            pendingPresetOpsRef.current.delete(requestId);
            setPresetOperations((operations) => ({
              ...operations,
              [requestId]: {
                requestId,
                name: operation?.name ?? pending.name,
                kind: pending.kind,
                status: "success",
                updatedAt: new Date().toISOString(),
              },
            }));
            toast.success(presetSuccessToast(pending.kind));
          }
        }

        if (env.kind === EventKinds.ConfigSnapshot) {
          const operation = (env.data as ConfigSnapshotData).operation;
          const requestId = operation?.requestId;
          const pending = requestId ? pendingConfigOpsRef.current.get(requestId) : undefined;
          if (requestId && pending) {
            pendingConfigOpsRef.current.delete(requestId);
            setConfigOperation({
              requestId,
              kind: pending.kind,
              status: "success",
              updatedAt: new Date().toISOString(),
            });
            toast.success("主配置已保存");
          }
        }

        if (env.kind === EventKinds.ProviderModelsSnapshot) {
          const data = env.data as ProviderModelsSnapshotData;
          setProviderModelLoadingIds((current) => {
            const next = { ...current };
            delete next[data.providerId];
            return next;
          });
        }

        if (env.kind === EventKinds.ProviderModelsFailed) {
          const data = env.data as ProviderModelsFailedData;
          setProviderModelLoadingIds((current) => {
            const next = { ...current };
            delete next[data.providerId];
            return next;
          });
          toast.error("模型列表检测失败", {
            description: data.message,
          });
        }

        if (env.kind === EventKinds.ConfigFailed) {
          const data = env.data as ConfigFailedData;
          const requestId = data.operation?.requestId;
          if (data.operation?.kind === "config_update") {
            const pending = requestId ? pendingConfigOpsRef.current.get(requestId) : undefined;
            if (requestId && pending) {
              pendingConfigOpsRef.current.delete(requestId);
              setConfigOperation({
                requestId,
                kind: pending.kind,
                status: "error",
                message: data.message,
                updatedAt: new Date().toISOString(),
              });
            }
            toast.error("主配置保存失败", {
              description: data.message,
            });
            return;
          }

          const pending = requestId ? pendingPluginConfigOpsRef.current.get(requestId) : undefined;
          if (requestId && pending) {
            pendingPluginConfigOpsRef.current.delete(requestId);
            setPluginConfigOperations((operations) => ({
              ...operations,
              [requestId]: {
                requestId,
                pluginName: pending.pluginName,
                kind: pending.kind,
                status: "error",
                message: data.message,
                updatedAt: new Date().toISOString(),
              },
            }));
            toast.error(pending.kind === "update" ? "插件配置保存失败" : "插件状态更新失败", {
              description: data.message,
            });
          }
        }

        if (env.kind === EventKinds.PresetFailed) {
          const data = env.data as PresetFailedData;
          const requestId = data.operation?.requestId;
          const pending = requestId ? pendingPresetOpsRef.current.get(requestId) : undefined;
          if (requestId && pending) {
            pendingPresetOpsRef.current.delete(requestId);
            setPresetOperations((operations) => ({
              ...operations,
              [requestId]: {
                requestId,
                name: pending.name,
                kind: pending.kind,
                status: "error",
                message: data.message,
                updatedAt: new Date().toISOString(),
              },
            }));
            toast.error(presetFailureToast(pending.kind), {
              description: data.message,
            });
          }
        }

        replayAfterSessionTruncated(env);
      },
      [
        handleSessionNotFound,
        ingest,
        notifySocketError,
        replayAfterSessionTruncated,
        runSocketPostIngestEffects,
        syncServerKnownSessionFromEvent,
      ],
    ),
  });

  const { requestSessionHistory } = useSessionHistoryRecovery({
    activeSessionId: activeId,
    send,
    status,
  });
  const { refreshSessionCatalog } = useSessionCatalogSync({
    send,
    status,
    onServerSessionsReset: resetServerKnownSessions,
  });
  const {
    closeSession: handleCloseSession,
    closeSessions: handleCloseSessions,
    createSession: handleNewSession,
    renameSession: handleRenameSession,
    updateUserProfile: handleUpdateUserProfile,
  } = useSessionCommands({
    send,
    serverKnownSessionIdsRef,
    status,
  });
  const { viewMessageWorkflow: handleViewWorkflow } = useWorkflowNavigation({
    activeSessionId: activeId,
    hasPersistentWorkflowPanel,
    setWorkflowDrawerOpen,
  });
  const {
    cancelActiveSession: handleCancel,
    deleteFromMessage: handleDeleteFromMessage,
    editUserMessage: handleEditUserMessage,
    regenerateMessage: handleRegenerate,
    sendMessage: handleSend,
  } = useChatCommands({
    activeSessionId: activeId,
    appendUserMessage,
    lastSendRef,
    pendingAfterTruncateRef,
    registerSession,
    send,
    serverKnownSessionIdsRef,
    status,
  });

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const handleToggleSessionPanelShortcut = useCallback((): void => {
    if (hasPersistentSessionPanel) {
      toggleSidebar();
      return;
    }
    setSessionDrawerOpen((open) => !open);
  }, [hasPersistentSessionPanel, toggleSidebar]);

  useGlobalShortcuts({
    onNewSession: handleNewSession,
    onToggleSessionPanel: handleToggleSessionPanelShortcut,
  });

  const handleRefreshPluginConfigs = useCallback((): void => {
    if (status !== "open") return;
    send({ type: "plugin.config.list" });
  }, [send, status]);

  const handleSavePluginConfig = useCallback(
    (pluginName: string, toml: string): string | null => {
      if (status !== "open") {
        toast.error("插件配置保存失败，后端未连接");
        return null;
      }
      const requestId = generateId();
      pendingPluginConfigOpsRef.current.set(requestId, {
        pluginName,
        kind: "update",
      });
      setPluginConfigOperations((operations) => ({
        ...operations,
        [requestId]: {
          requestId,
          pluginName,
          kind: "update",
          status: "pending",
          updatedAt: new Date().toISOString(),
        },
      }));
      const ok = send({
        type: "plugin.config.update",
        requestId,
        pluginName,
        toml,
      });
      if (!ok) {
        pendingPluginConfigOpsRef.current.delete(requestId);
        setPluginConfigOperations((operations) => {
          const next = { ...operations };
          delete next[requestId];
          return next;
        });
        toast.error("插件配置保存失败，连接可能已断开");
        return null;
      }
      return requestId;
    },
    [send, status],
  );

  const handleSetPluginEnabled = useCallback(
    (pluginName: string, enabled: boolean, toolName?: string): string | null => {
      if (status !== "open") {
        toast.error("插件配置更新失败，后端未连接");
        return null;
      }
      const requestId = generateId();
      pendingPluginConfigOpsRef.current.set(requestId, {
        pluginName,
        kind: "set_enabled",
      });
      setPluginConfigOperations((operations) => ({
        ...operations,
        [requestId]: {
          requestId,
          pluginName,
          kind: "set_enabled",
          status: "pending",
          updatedAt: new Date().toISOString(),
        },
      }));
      const ok = send({
        type: "plugin.config.set_enabled",
        requestId,
        pluginName,
        toolName,
        enabled,
      });
      if (!ok) {
        pendingPluginConfigOpsRef.current.delete(requestId);
        setPluginConfigOperations((operations) => {
          const next = { ...operations };
          delete next[requestId];
          return next;
        });
        toast.error("插件配置更新失败，连接可能已断开");
        return null;
      }
      return requestId;
    },
    [send, status],
  );

  const handleRefreshPresets = useCallback((): void => {
    if (status !== "open") return;
    send({ type: "preset.list" });
  }, [send, status]);

  const handleRefreshConfig = useCallback((): void => {
    if (status !== "open") return;
    send({ type: "config.get" });
  }, [send, status]);

  const handleSaveConfig = useCallback((config: Record<string, unknown>): string | null => {
    if (status !== "open") {
      toast.error("主配置保存失败，后端未连接");
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
      toast.error("主配置保存失败，连接可能已断开");
      return null;
    }
    return requestId;
  }, [send, status]);

  const handleFetchProviderModels = useCallback((
    providerId: string,
    force?: boolean,
    endpoint?: ProviderModelEndpointInput,
  ): void => {
    if (status !== "open") {
      toast.error("模型列表检测失败，后端未连接");
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
      toast.error("模型列表检测失败，连接可能已断开");
    }
  }, [send, status]);

  const startPresetOperation = useCallback((
    pending: PendingPresetOperation,
    request: Extract<WsRequest, { type: "preset.save" | "preset.delete" | "preset.set_active" }>,
  ): string | null => {
    if (status !== "open") {
      toast.error("角色预设更新失败，后端未连接");
      return null;
    }
    const requestId = generateId();
    pendingPresetOpsRef.current.set(requestId, pending);
    setPresetOperations((operations) => ({
      ...operations,
      [requestId]: {
        requestId,
        name: pending.name,
        kind: pending.kind,
        status: "pending",
        updatedAt: new Date().toISOString(),
      },
    }));
    const ok = send({
      ...request,
      requestId,
    });
    if (!ok) {
      pendingPresetOpsRef.current.delete(requestId);
      setPresetOperations((operations) => {
        const next = { ...operations };
        delete next[requestId];
        return next;
      });
      toast.error("角色预设更新失败，连接可能已断开");
      return null;
    }
    return requestId;
  }, [send, status]);

  const handleSavePreset = useCallback((input: {
    name: string;
    format: PresetFormat;
    content: string;
    activate?: boolean;
  }): string | null => startPresetOperation(
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
  ), [startPresetOperation]);

  const handleDeletePreset = useCallback((name: string): string | null => startPresetOperation(
    {
      name,
      kind: "delete",
    },
    {
      type: "preset.delete",
      name,
    },
  ), [startPresetOperation]);

  const handleSetActivePreset = useCallback((name: string | null): string | null => startPresetOperation(
    {
      name,
      kind: "set_active",
    },
    {
      type: "preset.set_active",
      name,
    },
  ), [startPresetOperation]);

  return (
    <TooltipProvider delayDuration={300}>
      <AppShell
        sessionRail={
          <SessionList
            presentation="rail"
            onNewSession={handleNewSession}
            onCloseSession={handleCloseSession}
            onCloseSessions={handleCloseSessions}
            onRefreshSessions={refreshSessionCatalog}
            onRenameSession={handleRenameSession}
            userProfile={userProfile}
            onUpdateUserProfile={handleUpdateUserProfile}
            socketStatus={status}
            onOpenSessionPanel={handleOpenSessionPanel}
          />
        }
        sessionPanel={
          <SessionList
            presentation="auto"
            onNewSession={handleNewSession}
            onCloseSession={handleCloseSession}
            onCloseSessions={handleCloseSessions}
            onRefreshSessions={refreshSessionCatalog}
            onRenameSession={handleRenameSession}
            userProfile={userProfile}
            onUpdateUserProfile={handleUpdateUserProfile}
            socketStatus={status}
          />
        }
        sessionDrawer={
          <SessionList
            presentation="panel"
            onNewSession={handleNewSession}
            onCloseSession={handleCloseSession}
            onCloseSessions={handleCloseSessions}
            onRefreshSessions={refreshSessionCatalog}
            onRenameSession={handleRenameSession}
            userProfile={userProfile}
            onUpdateUserProfile={handleUpdateUserProfile}
            socketStatus={status}
            onClosePanel={() => setSessionDrawerOpen(false)}
            onSessionSelected={() => setSessionDrawerOpen(false)}
          />
        }
        chatPanel={
          <ChatPanel
            userProfile={userProfile}
            modelProviders={modelProviders}
            selectedModelProviderId={selectedModelProviderId}
            onSelectModelProvider={selectModelProvider}
            pluginConfigs={pluginConfigs}
            pluginConfigOperations={pluginConfigOperations}
            configSnapshot={configSnapshot}
            configOperation={configOperation}
            providerModelCatalogs={providerModelCatalogs}
            providerModelErrors={providerModelErrors}
            providerModelLoadingIds={providerModelLoadingIds}
            presets={presets}
            activePresetName={activePresetName}
            presetsEnabled={presetsEnabled}
            presetRootDir={presetRootDir}
            presetOperations={presetOperations}
            onRefreshPluginConfigs={handleRefreshPluginConfigs}
            onSavePluginConfig={handleSavePluginConfig}
            onSetPluginEnabled={handleSetPluginEnabled}
            onRefreshConfig={handleRefreshConfig}
            onSaveConfig={handleSaveConfig}
            onFetchProviderModels={handleFetchProviderModels}
            onRefreshPresets={handleRefreshPresets}
            onSavePreset={handleSavePreset}
            onDeletePreset={handleDeletePreset}
            onSetActivePreset={handleSetActivePreset}
            socketStatus={status}
            uploadUrl={uploadUrl}
            onSend={handleSend}
            onCancel={handleCancel}
            onRegenerate={handleRegenerate}
            onEditUserMessage={handleEditUserMessage}
            onDeleteFromMessage={handleDeleteFromMessage}
            onViewWorkflow={handleViewWorkflow}
            onOpenSessionPanel={appShellRenderPlan.showChatSessionPanelAction ? handleOpenSessionPanel : undefined}
            onOpenWorkflowPanel={
              appShellRenderPlan.showChatWorkflowPanelAction ? () => setWorkflowDrawerOpen(true) : undefined
            }
            onRetryHistory={requestSessionHistory}
          />
        }
        workflowPanel={<ThinkingTimeline presentation="auto" />}
        workflowDrawer={<ThinkingTimeline presentation="panel" hidePanelTitle />}
        sessionDrawerOpen={sessionDrawerOpen}
        onSessionDrawerOpenChange={setSessionDrawerOpen}
        workflowDrawerOpen={workflowDrawerOpen}
        onWorkflowDrawerOpenChange={setWorkflowDrawerOpen}
        responsiveMode={responsiveMode}
      />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className:
            "!font-sans !text-[13px] !bg-paper-50 !text-ink-900 !border !border-ink-200 !shadow-soft",
        }}
      />
    </TooltipProvider>
  );
}
