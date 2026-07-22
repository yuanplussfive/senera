import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "sonner";
import { TooltipProvider, ErrorBoundary } from "./shared/ui";
import { useAgentSocket, type SocketStatus } from "./api/useAgentSocket";
import { buildUploadUrl } from "./api/uploadClient";
import { useStore } from "./store/sessionStore";
import { ChatPanel } from "./features/chat";
import { SessionList } from "./features/session";
import { ThinkingTimeline } from "./features/workflow";
import { AppShell, readAppShellRenderPlan, type WorkflowDockTool } from "./layout/AppShell";
import { EventKinds, type EventEnvelope, type WsRequest } from "./api/eventTypes";
import { useChatCommands, type LastSentMessage } from "./app/useChatCommands";
import { useGlobalShortcuts } from "./app/useGlobalShortcuts";
import { useSessionCommands } from "./app/useSessionCommands";
import { useSessionCatalogSync } from "./app/useSessionCatalogSync";
import { useSessionHistoryRecovery } from "./app/useSessionHistoryRecovery";
import { useSessionNotFoundRecovery } from "./app/useSessionNotFoundRecovery";
import { useServerKnownSessions } from "./app/useServerKnownSessions";
import { useSandboxRuntimeStatus } from "./app/useSandboxRuntimeStatus";
import { useSocketErrorToasts } from "./app/useSocketErrorToasts";
import { useSocketPostIngestEffects } from "./app/useSocketPostIngestEffects";
import { useWorkflowNavigation } from "./app/useWorkflowNavigation";
import { useResponsiveMode } from "./shared/responsive";
import { installCopyableToasts } from "./shared/ui/installCopyableToasts";
import { resolveRuntimeWebSocketUrl } from "./config/runtimeConfig";
import { useSettingsRuntime } from "./app/useSettingsRuntime";
import { useWebSettingsController } from "./app/useWebSettingsController";
import { SettingsOverlay } from "./features/settings";
import { useExecutionResourceCommands } from "./app/useExecutionResourceCommands";
import { TerminalPanelStatus, TerminalRuntimeBoundary } from "./features/terminal/TerminalPanelStatus";

const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
type BackgroundTerminalPanelComponent = (typeof import("./features/terminal"))["BackgroundTerminalPanel"];
type TerminalPanelLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; Component: BackgroundTerminalPanelComponent }
  | { status: "error" };
installCopyableToasts();

export function App({
  onLogout,
  uploadCsrfToken,
}: {
  onLogout?: () => Promise<void>;
  uploadCsrfToken?: string;
}): JSX.Element {
  const ingest = useStore((s) => s.ingest);
  const ingestMany = useStore((s) => s.ingestMany);
  const registerSession = useStore((s) => s.registerCreatingSession);
  const appendUserMessage = useStore((s) => s.appendUserMessage);
  const activeId = useStore((s) => s.activeSessionId);
  const rightPanelCollapsed = useStore((s) => s.rightPanelCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const setRightPanelCollapsed = useStore((s) => s.setRightPanelCollapsed);
  const modelProviders = useStore((s) => s.modelProviders);
  const selectedModelProviderId = useStore((s) => s.selectedModelProviderId);
  const defaultModelProviderId = useStore((s) => s.defaultModelProviderId);
  const selectModelProvider = useStore((s) => s.selectModelProvider);
  const applyDefaultModelToActiveSession = useStore((s) => s.applyDefaultModelToActiveSession);
  const userProfile = useStore((s) => s.userProfile);
  const markUserProfileSynced = useStore((s) => s.markUserProfileSynced);
  const presets = useStore((s) => s.presets);
  const activePresetName = useStore((s) => s.activePresetName);
  const presetsEnabled = useStore((s) => s.presetsEnabled);
  const presetRootDir = useStore((s) => s.presetRootDir);
  const defaultSidebarCollapsed = useStore((s) => s.defaultSidebarCollapsed);
  const defaultRightPanelCollapsed = useStore((s) => s.defaultRightPanelCollapsed);
  const motionLevel = useStore((s) => s.motionLevel);
  const setDefaultSidebarCollapsed = useStore((s) => s.setDefaultSidebarCollapsed);
  const setDefaultRightPanelCollapsed = useStore((s) => s.setDefaultRightPanelCollapsed);
  const setMotionLevel = useStore((s) => s.setMotionLevel);
  const responsiveMode = useResponsiveMode();
  const { hasPersistentSessionPanel, hasPersistentWorkflowPanel } = responsiveMode;
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false);
  const [workflowDockTool, setWorkflowDockTool] = useState<WorkflowDockTool>("execution");
  const [terminalPanelLoadState, setTerminalPanelLoadState] = useState<TerminalPanelLoadState>({ status: "idle" });
  const [terminalRuntimeRevision, setTerminalRuntimeRevision] = useState(0);
  const uploadUrl = useMemo(() => buildUploadUrl(WS_URL), []);
  const appShellRenderPlan = readAppShellRenderPlan(responsiveMode);
  const settingsController = useWebSettingsController();

  const handleWorkflowDockToolChange = useCallback((tool: WorkflowDockTool): void => {
    setWorkflowDockTool(tool);
    if (tool === "terminal") {
      setTerminalPanelLoadState((current) =>
        current.status === "idle" || current.status === "error" ? { status: "loading" } : current,
      );
    }
  }, []);

  const handleOpenTerminalPanel = useCallback((): void => {
    handleWorkflowDockToolChange("terminal");
    if (hasPersistentWorkflowPanel) {
      setRightPanelCollapsed(false);
      return;
    }
    setWorkflowDrawerOpen(true);
  }, [handleWorkflowDockToolChange, hasPersistentWorkflowPanel, setRightPanelCollapsed]);

  useEffect(() => {
    if (terminalPanelLoadState.status !== "loading") return;
    let active = true;
    void import("./features/terminal").then(
      (module) => {
        if (active) setTerminalPanelLoadState({ status: "ready", Component: module.BackgroundTerminalPanel });
      },
      () => {
        if (active) setTerminalPanelLoadState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [terminalPanelLoadState.status]);

  const sendRef = useRef<((req: WsRequest) => boolean) | null>(null);
  const statusRef = useRef<SocketStatus>("idle");
  const lastSendRef = useRef<LastSentMessage | null>(null);
  const settingsEventHandlerRef = useRef<(env: EventEnvelope) => boolean>(() => false);
  const executionResourceEventHandlerRef = useRef<(env: EventEnvelope) => boolean>(() => false);
  const { sandboxStatus, ingestSandboxEvent } = useSandboxRuntimeStatus();

  const handleOpenSessionPanel = useCallback((): void => {
    if (hasPersistentSessionPanel) {
      setSidebarCollapsed(false);
      return;
    }
    setSessionDrawerOpen(true);
  }, [hasPersistentSessionPanel, setSidebarCollapsed]);

  const handleOpenWorkflowPanel = useCallback((): void => {
    handleWorkflowDockToolChange("execution");
    if (hasPersistentWorkflowPanel) {
      setRightPanelCollapsed(false);
      return;
    }
    setWorkflowDrawerOpen(true);
  }, [handleWorkflowDockToolChange, hasPersistentWorkflowPanel, setRightPanelCollapsed]);

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
  // Stabilize event handlers to prevent WebSocket reconnection
  const eventHandlersRef = useRef({
    syncServerKnownSessionFromEvent,
    handleSessionNotFound,
    notifySocketError,
    ingest,
    ingestMany,
    runSocketPostIngestEffects,
    ingestSandboxEvent,
  });

  useEffect(() => {
    eventHandlersRef.current = {
      syncServerKnownSessionFromEvent,
      handleSessionNotFound,
      notifySocketError,
      ingest,
      ingestMany,
      runSocketPostIngestEffects,
      ingestSandboxEvent,
    };
  });

  const { status, send } = useAgentSocket({
    url: WS_URL,
    onEvents: useCallback(
      (events) => {
        const handlers = eventHandlersRef.current;
        let pendingProjection: EventEnvelope[] = [];

        const flushProjection = (): void => {
          if (pendingProjection.length === 0) return;
          const projectedEvents = pendingProjection;
          pendingProjection = [];
          handlers.ingestMany(projectedEvents);
          for (const env of projectedEvents) {
            handlers.notifySocketError(env);
            handlers.runSocketPostIngestEffects(env);
            handlers.ingestSandboxEvent(env);
            settingsEventHandlerRef.current(env);
            executionResourceEventHandlerRef.current(env);
          }
        };

        for (const env of events) {
          handlers.syncServerKnownSessionFromEvent(env);
          if (env.kind === EventKinds.SessionNotFound) {
            flushProjection();
            if (handlers.handleSessionNotFound(env)) continue;
          }
          pendingProjection.push(env);
        }
        flushProjection();
      },
      [], // Empty deps - handlers read from ref
    ),
  });

  sendRef.current = send;
  statusRef.current = status;
  const settingsRuntime = useSettingsRuntime({ sendRef, statusRef });
  settingsEventHandlerRef.current = settingsRuntime.controller.ingestConfigMutationEvent;
  const executionResourceCommands = useExecutionResourceCommands({
    activeSessionId: activeId,
    send,
    status,
  });
  executionResourceEventHandlerRef.current = executionResourceCommands.handleEvent;

  const { requestSessionHistory } = useSessionHistoryRecovery({
    activeSessionId: activeId,
    send,
    status,
  });
  useSessionCatalogSync({
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
    defaultModelProviderId,
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
    forkFromMessage: handleForkFromMessage,
    regenerateMessage: handleRegenerate,
    resolveApproval: handleResolveApproval,
    resolveInteractionInput: handleResolveInteractionInput,
    sendMessage: handleSend,
  } = useChatCommands({
    activeSessionId: activeId,
    appendUserMessage,
    lastSendRef,
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
  const TerminalPanel = terminalPanelLoadState.status === "ready" ? terminalPanelLoadState.Component : undefined;
  const terminalPanel = TerminalPanel ? (
    <TerminalRuntimeBoundary
      resetKey={`${activeId ?? "none"}:${terminalRuntimeRevision}`}
      onRetry={() => setTerminalRuntimeRevision((revision) => revision + 1)}
    >
      <TerminalPanel
        key={terminalRuntimeRevision}
        resources={executionResourceCommands.resources}
        outputs={executionResourceCommands.outputs}
        onRefresh={executionResourceCommands.refresh}
        onWrite={executionResourceCommands.write}
        onResize={executionResourceCommands.resize}
        onSignal={executionResourceCommands.signal}
        onStopAll={executionResourceCommands.stopAll}
      />
    </TerminalRuntimeBoundary>
  ) : terminalPanelLoadState.status === "loading" || terminalPanelLoadState.status === "error" ? (
    <TerminalPanelStatus
      status={terminalPanelLoadState.status}
      onRetry={
        terminalPanelLoadState.status === "error" ? () => setTerminalPanelLoadState({ status: "loading" }) : undefined
      }
    />
  ) : null;

  return (
    <TooltipProvider delayDuration={300}>
      <AppShell
        sessionPanel={
          <SessionList
            presentation="auto"
            onNewSession={handleNewSession}
            onCloseSession={handleCloseSession}
            onCloseSessions={handleCloseSessions}
            onRenameSession={handleRenameSession}
            userProfile={userProfile}
            onUpdateUserProfile={handleUpdateUserProfile}
            onLogout={onLogout}
            socketStatus={status}
            sandboxStatus={sandboxStatus}
            onOpenSettings={(section, returnFocus) => {
              void settingsController.openSettings(section, returnFocus);
            }}
          />
        }
        sessionDrawer={
          <SessionList
            presentation="panel"
            onNewSession={handleNewSession}
            onCloseSession={handleCloseSession}
            onCloseSessions={handleCloseSessions}
            onRenameSession={handleRenameSession}
            userProfile={userProfile}
            onUpdateUserProfile={handleUpdateUserProfile}
            onLogout={onLogout}
            socketStatus={status}
            sandboxStatus={sandboxStatus}
            onOpenSettings={(section, returnFocus) => {
              void settingsController.openSettings(section, returnFocus);
            }}
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
                defaultModelProviderId,
                onSelectModelProvider: selectModelProvider,
                onApplyDefaultModel: applyDefaultModelToActiveSession,
              }}
              presetConfig={{
                presets,
                activePresetName,
                presetsEnabled,
                presetRootDir,
                presetOperations: settingsRuntime.controller.presetOperations,
                onRefreshPresets: settingsRuntime.controller.refreshPresets,
                onSavePreset: settingsRuntime.controller.savePreset,
                onDeletePreset: settingsRuntime.controller.deletePreset,
                onSetActivePreset: settingsRuntime.controller.setActivePreset,
              }}
              runtime={{
                socketStatus: status,
                uploadUrl,
                uploadCsrfToken,
                sandboxStatus,
              }}
              messageActions={{
                onSend: handleSend,
                onCancel: handleCancel,
                onForkFromMessage: handleForkFromMessage,
                onRegenerate: handleRegenerate,
                onEditUserMessage: handleEditUserMessage,
                onDeleteFromMessage: handleDeleteFromMessage,
                onViewWorkflow: handleViewWorkflow,
                onResolveApproval: handleResolveApproval,
                onResolveInteractionInput: handleResolveInteractionInput,
              }}
              navigationActions={{
                onOpenSessionPanel: appShellRenderPlan.showChatSessionPanelAction ? handleOpenSessionPanel : undefined,
                onOpenWorkflowPanel:
                  appShellRenderPlan.showChatWorkflowPanelAction &&
                  (hasPersistentWorkflowPanel ? rightPanelCollapsed : !workflowDrawerOpen)
                    ? handleOpenWorkflowPanel
                    : undefined,
                onOpenTerminalPanel: activeId ? handleOpenTerminalPanel : undefined,
                onRetryHistory: requestSessionHistory,
              }}
            />
          </ErrorBoundary>
        }
        workflowPanel={<ThinkingTimeline presentation="dock" />}
        workflowDrawer={<ThinkingTimeline presentation="panel" hidePanelTitle />}
        terminalPanel={terminalPanel}
        workflowDockTool={workflowDockTool}
        onWorkflowDockToolChange={handleWorkflowDockToolChange}
        sessionDrawerOpen={sessionDrawerOpen}
        onSessionDrawerOpenChange={setSessionDrawerOpen}
        workflowDrawerOpen={workflowDrawerOpen}
        onWorkflowDrawerOpenChange={setWorkflowDrawerOpen}
        responsiveMode={responsiveMode}
      />
      <SettingsOverlay
        controller={settingsController}
        send={send}
        status={status}
        workbench={{
          environment: {
            appVersion: __SENERA_APP_VERSION__,
            frontendVersion: __SENERA_FRONTEND_VERSION__,
            mode: import.meta.env.MODE,
            surface: "web",
          },
          values: { defaultSidebarCollapsed, defaultRightPanelCollapsed },
          motionLevel,
          onValueChange: (id, value) => {
            if (id === "defaultSidebarCollapsed") setDefaultSidebarCollapsed(value);
            if (id === "defaultRightPanelCollapsed") setDefaultRightPanelCollapsed(value);
          },
          onMotionLevelChange: setMotionLevel,
          pluginSettings: settingsRuntime.pluginSettings,
          systemConfig: settingsRuntime.systemConfig,
        }}
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
