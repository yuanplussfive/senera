import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "sonner";
import { TooltipProvider, ErrorBoundary } from "./shared/ui";
import { useAgentSocket } from "./api/useAgentSocket";
import { buildUploadUrl } from "./api/uploadClient";
import { useStore } from "./store/sessionStore";
import { ChatPanel } from "./features/chat";
import { SessionList } from "./features/session";
import { ThinkingTimeline } from "./features/workflow";
import { AppShell, readAppShellRenderPlan } from "./layout/AppShell";
import {
  type EventEnvelope,
  type WsRequest,
} from "./api/eventTypes";
import { usePresetCommands } from "./app/usePresetCommands";
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
import { useSandboxRuntimeStatus } from "./app/useSandboxRuntimeStatus";
import { useSocketErrorToasts } from "./app/useSocketErrorToasts";
import { useSocketPostIngestEffects } from "./app/useSocketPostIngestEffects";
import { useWorkflowNavigation } from "./app/useWorkflowNavigation";
import { useResponsiveMode } from "./shared/responsive";
import { installCopyableToasts } from "./shared/ui/installCopyableToasts";
import { resolveRuntimeWebSocketUrl } from "./config/runtimeConfig";

const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
installCopyableToasts();

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
  const userProfile = useStore((s) => s.userProfile);
  const markUserProfileSynced = useStore((s) => s.markUserProfileSynced);
  const responsiveMode = useResponsiveMode();
  const { hasPersistentSessionPanel, hasPersistentWorkflowPanel } = responsiveMode;
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false);
  const uploadUrl = useMemo(() => buildUploadUrl(WS_URL), []);
  const appShellRenderPlan = readAppShellRenderPlan(responsiveMode);

  const sendRef = useRef<((req: WsRequest) => boolean) | null>(null);
  const lastSendRef = useRef<LastSentMessage | null>(null);
  const pendingAfterTruncateRef = useRef<PendingAfterTruncate[]>([]);
  const presetEventHandlerRef = useRef<(env: EventEnvelope) => boolean>(() => false);
  const { sandboxStatus, ingestSandboxEvent } = useSandboxRuntimeStatus();

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

  // Stabilize event handlers to prevent WebSocket reconnection
  const eventHandlersRef = useRef({
    syncServerKnownSessionFromEvent,
    handleSessionNotFound,
    notifySocketError,
    ingest,
    runSocketPostIngestEffects,
    ingestSandboxEvent,
    replayAfterSessionTruncated,
  });

  useEffect(() => {
    eventHandlersRef.current = {
      syncServerKnownSessionFromEvent,
      handleSessionNotFound,
      notifySocketError,
      ingest,
      runSocketPostIngestEffects,
      ingestSandboxEvent,
      replayAfterSessionTruncated,
    };
  });

  const { status, send } = useAgentSocket({
    url: WS_URL,
    onEvent: useCallback(
      (env) => {
        const handlers = eventHandlersRef.current;

        handlers.syncServerKnownSessionFromEvent(env);

        if (handlers.handleSessionNotFound(env)) {
          return;
        }

        handlers.notifySocketError(env);
        handlers.ingest(env);
        handlers.runSocketPostIngestEffects(env);
        handlers.ingestSandboxEvent(env);

        presetEventHandlerRef.current(env);

        handlers.replayAfterSessionTruncated(env);
      },
      [], // Empty deps - handlers read from ref
    ),
  });

  const presetCommands = usePresetCommands({
    send,
    status,
  });
  presetEventHandlerRef.current = presetCommands.handlePresetEvent;

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
    resolveApproval: handleResolveApproval,
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
          <ErrorBoundary resetKey={activeId}>
            <ChatPanel
              userProfile={userProfile}
              modelConfig={{
                modelProviders,
                selectedModelProviderId,
                onSelectModelProvider: selectModelProvider,
              }}
              presetConfig={{
                presets: presetCommands.presets,
                activePresetName: presetCommands.activePresetName,
                presetsEnabled: presetCommands.presetsEnabled,
                presetRootDir: presetCommands.presetRootDir,
                presetOperations: presetCommands.presetOperations,
                onRefreshPresets: presetCommands.refreshPresets,
                onSavePreset: presetCommands.savePreset,
                onDeletePreset: presetCommands.deletePreset,
                onSetActivePreset: presetCommands.setActivePreset,
              }}
              runtime={{
                socketStatus: status,
                sandboxStatus,
                uploadUrl,
              }}
              messageActions={{
                onSend: handleSend,
                onCancel: handleCancel,
                onRegenerate: handleRegenerate,
                onEditUserMessage: handleEditUserMessage,
                onDeleteFromMessage: handleDeleteFromMessage,
                onViewWorkflow: handleViewWorkflow,
                onResolveApproval: handleResolveApproval,
              }}
              navigationActions={{
                onOpenSessionPanel: appShellRenderPlan.showChatSessionPanelAction ? handleOpenSessionPanel : undefined,
                onOpenWorkflowPanel: appShellRenderPlan.showChatWorkflowPanelAction ? () => setWorkflowDrawerOpen(true) : undefined,
                onRetryHistory: requestSessionHistory,
              }}
            />
          </ErrorBoundary>
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
