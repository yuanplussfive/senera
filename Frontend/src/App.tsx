import { useCallback, useEffect, useMemo, useRef } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "./shared/ui";
import { useAgentSocket, type SocketStatus } from "./api/useAgentSocket";
import { ChatPanel } from "./features/chat";
import { ThinkingTimeline } from "./features/workflow";
import { AppShell } from "./layout/AppShell";
import type { WsRequest } from "./api/eventTypes";
import { useChatCommands, type LastSentMessage, type PendingAfterTruncate } from "./app/useChatCommands";
import { AppSessionSurface, type AppSessionActions } from "./app/AppSessionSurfaces";
import { useAppChatPanelBindings } from "./app/useAppChatPanelBindings";
import { useAppPanelController } from "./app/useAppPanelController";
import { useAppStoreBindings } from "./app/useAppStoreBindings";
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
import { ServerAuthenticationGate } from "./app/ServerAuthenticationGate";
import { useServerAuthentication } from "./app/useServerAuthentication";

const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
installCopyableToasts();

export function App(): JSX.Element {
  const authentication = useServerAuthentication(WS_URL);
  if (authentication.state.status !== "authenticated") {
    return (
      <ServerAuthenticationGate
        state={authentication.state}
        onLogin={authentication.login}
        onRetry={authentication.refresh}
      />
    );
  }
  return (
    <AuthenticatedApp
      uploadCsrfToken={authentication.state.authentication.csrfToken}
      onLogout={authentication.logout}
    />
  );
}

function AuthenticatedApp({
  uploadCsrfToken,
  onLogout,
}: {
  uploadCsrfToken?: string;
  onLogout: () => Promise<void>;
}): JSX.Element {
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
  const { sandboxStatus, ingestSandboxEvent } = useSandboxRuntimeStatus();
  const {
    actions,
    activeSessionId: activeId,
    chatModelConfig,
    chatPluginConfig,
    chatPresetConfig,
    chatSystemConfig,
    selectedModelProviderId,
    uploadUrl,
    userProfile,
  } = useAppStoreBindings({
    configMutations,
    wsUrl: WS_URL,
  });
  const { appendUserMessage, ingest, markUserProfileSynced, registerCreatingSession: registerSession } = actions;

  const { resetServerKnownSessions, serverKnownSessionIdsRef, syncServerKnownSessionFromEvent } =
    useServerKnownSessions();
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
        configMutations.ingestConfigMutationEvent(env);
        ingestSandboxEvent(env);
        replayAfterSessionTruncated(env);
      },
      [
        configMutations,
        handleSessionNotFound,
        ingest,
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

  const { chatMessageActions, chatNavigationActions, chatRuntime } = useAppChatPanelBindings({
    messageHandlers: {
      onSend: handleSend,
      onCancel: handleCancel,
      onRegenerate: handleRegenerate,
      onEditUserMessage: handleEditUserMessage,
      onDeleteFromMessage: handleDeleteFromMessage,
      onViewWorkflow: handleViewWorkflow,
    },
    navigationHandlers: {
      onOpenSessionPanel: handleOpenSessionPanel,
      onOpenWorkflowPanel: handleOpenWorkflowPanel,
      onRetryHistory: requestSessionHistory,
      showSessionPanelAction: appShellRenderPlan.showChatSessionPanelAction,
      showWorkflowPanelAction: appShellRenderPlan.showChatWorkflowPanelAction,
    },
    runtime: {
      sandboxStatus,
      uploadUrl,
      uploadCsrfToken,
    },
    send,
    status,
  });

  const sessionActions = useMemo<AppSessionActions>(
    () => ({
      onNewSession: handleNewSession,
      onCloseSession: handleCloseSession,
      onCloseSessions: handleCloseSessions,
      onRefreshSessions: refreshSessionCatalog,
      onRenameSession: handleRenameSession,
      onUpdateUserProfile: handleUpdateUserProfile,
      onLogout,
    }),
    [
      handleCloseSession,
      handleCloseSessions,
      handleNewSession,
      handleRenameSession,
      handleUpdateUserProfile,
      onLogout,
      refreshSessionCatalog,
    ],
  );

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
          className: "!font-sans !text-[13px] !bg-paper-50 !text-ink-900 !border !border-ink-200 !shadow-soft",
        }}
      />
    </TooltipProvider>
  );
}
