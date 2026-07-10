import { useCallback, useEffect, useMemo, useRef } from "react";
import { Toaster, toast } from "sonner";
import { TooltipProvider } from "./shared/ui";
import { useAgentSocket, type SocketStatus } from "./api/useAgentSocket";
import { buildUploadUrl } from "./api/uploadClient";
import { useStore } from "./store/sessionStore";
import { ChatPanel } from "./features/chat";
import { ThinkingTimeline } from "./features/workflow";
import { AppShell } from "./layout/AppShell";
import type { WsRequest } from "./api/eventTypes";
import {
  useChatCommands,
  type LastSentMessage,
  type PendingAfterTruncate,
} from "./app/useChatCommands";
import { AppSessionSurface, type AppSessionActions } from "./app/AppSessionSurfaces";
import { useAppPanelController } from "./app/useAppPanelController";
import { useConfigMutationController } from "./app/useConfigMutationController";
import { useGlobalShortcuts } from "./app/useGlobalShortcuts";
import { useSessionCommands } from "./app/useSessionCommands";
import { useSessionCatalogSync } from "./app/useSessionCatalogSync";
import { useSessionHistoryRecovery } from "./app/useSessionHistoryRecovery";
import { useSessionNotFoundRecovery } from "./app/useSessionNotFoundRecovery";
import { useSessionTruncateReplay } from "./app/useSessionTruncateReplay";
import { useServerKnownSessions } from "./app/useServerKnownSessions";
import { useSandboxRuntimeStatus } from "./app/useSandboxRuntimeStatus";
import { useSocketErrorToasts } from "./app/useSocketErrorToasts";
import { useSocketPostIngestEffects } from "./app/useSocketPostIngestEffects";
import { useWorkflowNavigation } from "./app/useWorkflowNavigation";
import { installCopyableToasts } from "./shared/ui/installCopyableToasts";
import { resolveRuntimeWebSocketUrl } from "./config/runtimeConfig";
import { frontendMessage } from "./i18n/frontendMessageCatalog";
import type {
  ChatMessageActions,
  ChatModelConfig,
  ChatNavigationActions,
  ChatPluginConfig,
  ChatPresetConfig,
  ChatRuntimeState,
  ChatSystemConfig,
} from "./features/chat/ChatPanelContracts";

const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
installCopyableToasts();

export function App(): JSX.Element {
  const ingest = useStore((s) => s.ingest);
  const registerSession = useStore((s) => s.registerCreatingSession);
  const appendUserMessage = useStore((s) => s.appendUserMessage);
  const activeId = useStore((s) => s.activeSessionId);
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
  const uploadUrl = useMemo(() => buildUploadUrl(WS_URL), []);

  const sendRef = useRef<((req: WsRequest) => boolean) | null>(null);
  const statusRef = useRef<SocketStatus>("idle");
  const lastSendRef = useRef<LastSentMessage | null>(null);
  const pendingAfterTruncateRef = useRef<PendingAfterTruncate[]>([]);
  const {
    appShellRenderPlan,
    handleOpenSessionPanel,
    handleOpenWorkflowPanel,
    handleToggleSessionPanelShortcut,
    hasPersistentWorkflowPanel,
    responsiveMode,
    sessionDrawerOpen,
    setSessionDrawerOpen,
    workflowDrawerOpen,
    setWorkflowDrawerOpen,
  } = useAppPanelController();
  const configMutations = useConfigMutationController({
    sendRef,
    statusRef,
  });
  const {
    configOperation,
    deletePreset,
    fetchProviderModels,
    ingestConfigMutationEvent,
    pluginConfigOperations,
    presetOperations,
    providerModelLoadingIds,
    refreshConfig,
    refreshPluginConfigs,
    refreshPresets,
    saveConfig,
    savePluginConfig,
    savePreset,
    setActivePreset,
    setPluginEnabled,
  } = configMutations;
  const {
    sandboxStatus,
    ingestSandboxEvent,
  } = useSandboxRuntimeStatus();

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
        ingestConfigMutationEvent(env);
        ingestSandboxEvent(env);
        replayAfterSessionTruncated(env);
      },
      [
        handleSessionNotFound,
        ingest,
        ingestConfigMutationEvent,
        ingestSandboxEvent,
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
    selectedModelProviderId,
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

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useGlobalShortcuts({
    onNewSession: handleNewSession,
    onToggleSessionPanel: handleToggleSessionPanelShortcut,
  });

  const handleResolveApproval = useCallback(
    (approvalId: string, approvalStatus: "approved" | "denied"): void => {
      if (status !== "open") {
        toast.error(frontendMessage("approval.resolveOffline"));
        return;
      }
      const ok = send({
        type: "approval.resolve",
        approvalId,
        status: approvalStatus,
      });
      if (!ok) {
        toast.error(frontendMessage("approval.resolveDisconnected"));
      }
    },
    [send, status],
  );

  const chatModelConfig = useMemo<ChatModelConfig>(() => ({
    modelProviders,
    selectedModelProviderId,
    onSelectModelProvider: selectModelProvider,
  }), [modelProviders, selectModelProvider, selectedModelProviderId]);

  const chatPluginConfig = useMemo<ChatPluginConfig>(() => ({
    pluginConfigs,
    pluginConfigOperations,
    onRefreshPluginConfigs: refreshPluginConfigs,
    onSavePluginConfig: savePluginConfig,
    onSetPluginEnabled: setPluginEnabled,
  }), [
    pluginConfigs,
    pluginConfigOperations,
    refreshPluginConfigs,
    savePluginConfig,
    setPluginEnabled,
  ]);

  const chatSystemConfig = useMemo<ChatSystemConfig>(() => ({
    configSnapshot,
    configOperation,
    providerModelCatalogs,
    providerModelErrors,
    providerModelLoadingIds,
    onRefreshConfig: refreshConfig,
    onSaveConfig: saveConfig,
    onFetchProviderModels: fetchProviderModels,
  }), [
    configOperation,
    configSnapshot,
    fetchProviderModels,
    providerModelCatalogs,
    providerModelErrors,
    providerModelLoadingIds,
    refreshConfig,
    saveConfig,
  ]);

  const chatPresetConfig = useMemo<ChatPresetConfig>(() => ({
    presets,
    activePresetName,
    presetsEnabled,
    presetRootDir,
    presetOperations,
    onRefreshPresets: refreshPresets,
    onSavePreset: savePreset,
    onDeletePreset: deletePreset,
    onSetActivePreset: setActivePreset,
  }), [
    activePresetName,
    deletePreset,
    presetRootDir,
    presetOperations,
    presets,
    presetsEnabled,
    refreshPresets,
    savePreset,
    setActivePreset,
  ]);

  const chatRuntime = useMemo<ChatRuntimeState>(() => ({
    socketStatus: status,
    sandboxStatus,
    uploadUrl,
  }), [sandboxStatus, status, uploadUrl]);

  const chatMessageActions = useMemo<ChatMessageActions>(() => ({
    onSend: handleSend,
    onCancel: handleCancel,
    onRegenerate: handleRegenerate,
    onEditUserMessage: handleEditUserMessage,
    onDeleteFromMessage: handleDeleteFromMessage,
    onViewWorkflow: handleViewWorkflow,
    onResolveApproval: handleResolveApproval,
  }), [
    handleCancel,
    handleDeleteFromMessage,
    handleEditUserMessage,
    handleRegenerate,
    handleResolveApproval,
    handleSend,
    handleViewWorkflow,
  ]);

  const chatNavigationActions = useMemo<ChatNavigationActions>(() => ({
    onOpenSessionPanel: appShellRenderPlan.showChatSessionPanelAction
      ? handleOpenSessionPanel
      : undefined,
    onOpenWorkflowPanel: appShellRenderPlan.showChatWorkflowPanelAction
      ? handleOpenWorkflowPanel
      : undefined,
    onRetryHistory: requestSessionHistory,
  }), [
    appShellRenderPlan.showChatSessionPanelAction,
    appShellRenderPlan.showChatWorkflowPanelAction,
    handleOpenSessionPanel,
    handleOpenWorkflowPanel,
    requestSessionHistory,
  ]);

  const sessionActions = useMemo<AppSessionActions>(() => ({
    onNewSession: handleNewSession,
    onCloseSession: handleCloseSession,
    onCloseSessions: handleCloseSessions,
    onRefreshSessions: refreshSessionCatalog,
    onRenameSession: handleRenameSession,
    onUpdateUserProfile: handleUpdateUserProfile,
  }), [
    handleCloseSession,
    handleCloseSessions,
    handleNewSession,
    handleRenameSession,
    handleUpdateUserProfile,
    refreshSessionCatalog,
  ]);

  return (
    <TooltipProvider delayDuration={300}>
      <AppShell
        sessionRail={
          <AppSessionSurface
            actions={sessionActions}
            presentation="rail"
            userProfile={userProfile}
            socketStatus={status}
            onOpenSessionPanel={handleOpenSessionPanel}
          />
        }
        sessionPanel={
          <AppSessionSurface
            actions={sessionActions}
            presentation="auto"
            userProfile={userProfile}
            socketStatus={status}
          />
        }
        sessionDrawer={
          <AppSessionSurface
            actions={sessionActions}
            presentation="panel"
            userProfile={userProfile}
            socketStatus={status}
            onClosePanel={() => setSessionDrawerOpen(false)}
            onSessionSelected={() => setSessionDrawerOpen(false)}
          />
        }
        chatPanel={
          <ChatPanel
            userProfile={userProfile}
            modelConfig={chatModelConfig}
            pluginConfig={chatPluginConfig}
            systemConfig={chatSystemConfig}
            presetConfig={chatPresetConfig}
            runtime={chatRuntime}
            messageActions={chatMessageActions}
            navigationActions={chatNavigationActions}
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
