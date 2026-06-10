import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "./shared/ui";
import { useAgentSocket } from "./api/useAgentSocket";
import { useStore } from "./store/sessionStore";
import { ChatPanel } from "./features/chat";
import { SessionList } from "./features/session";
import { ThinkingTimeline } from "./features/workflow";
import { AppShell, readAppShellRenderPlan } from "./layout/AppShell";
import type { WsRequest } from "./api/eventTypes";
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

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8787";

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
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false);
  const { hasPersistentSessionPanel, hasPersistentWorkflowPanel } = responsiveMode;
  const appShellRenderPlan = readAppShellRenderPlan(responsiveMode);

  const handleOpenSessionPanel = useCallback((): void => {
    if (hasPersistentSessionPanel) {
      setSidebarCollapsed(false);
      return;
    }
    setSessionDrawerOpen(true);
  }, [hasPersistentSessionPanel, setSidebarCollapsed]);

  const sendRef = useRef<((req: WsRequest) => boolean) | null>(null);
  const lastSendRef = useRef<LastSentMessage | null>(null);
  // 待办的"truncate 完后做点啥"队列——避免 setTimeout 魔法等待
  const pendingAfterTruncateRef = useRef<PendingAfterTruncate[]>([]);
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
        // Must stay after ingest(env): the store truncates old messages first, then this replays/appends.
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

  // 暴露 send 给 ref，让事件回调能用最新的 send
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
          <ChatPanel
            userProfile={userProfile}
            modelProviders={modelProviders}
            selectedModelProviderId={selectedModelProviderId}
            onSelectModelProvider={selectModelProvider}
            socketStatus={status}
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
