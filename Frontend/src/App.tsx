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
  type ConfigFailedData,
  type PluginConfigMutationState,
  type PluginConfigSnapshotData,
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
  const userProfile = useStore((s) => s.userProfile);
  const markUserProfileSynced = useStore((s) => s.markUserProfileSynced);
  const responsiveMode = useResponsiveMode();
  const { hasPersistentSessionPanel, hasPersistentWorkflowPanel } = responsiveMode;
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false);
  const [pluginConfigOperations, setPluginConfigOperations] = useState<Record<string, PluginConfigMutationState>>({});
  const uploadUrl = useMemo(() => buildUploadUrl(WS_URL), []);
  const appShellRenderPlan = readAppShellRenderPlan(responsiveMode);

  const sendRef = useRef<((req: WsRequest) => boolean) | null>(null);
  const lastSendRef = useRef<LastSentMessage | null>(null);
  const pendingAfterTruncateRef = useRef<PendingAfterTruncate[]>([]);
  const pendingPluginConfigOpsRef = useRef<Map<string, PendingPluginConfigOperation>>(new Map());

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

        if (env.kind === EventKinds.ConfigFailed) {
          const data = env.data as ConfigFailedData;
          const requestId = data.operation?.requestId;
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
            onRefreshPluginConfigs={handleRefreshPluginConfigs}
            onSavePluginConfig={handleSavePluginConfig}
            onSetPluginEnabled={handleSetPluginEnabled}
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
