import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { ErrorBoundary, SeneraToaster, TooltipProvider } from "./shared/ui";
import { useAgentSocket, type AgentSocketReconnectPolicy, type SocketStatus } from "./api/useAgentSocket";
import { buildResourceUploadUrl } from "./api/uploadClient";
import { useStore } from "./store/sessionStore";
import { ChatPanel } from "./features/chat/ChatPanel";
import { SessionList } from "./features/session";
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
import { resolveRuntimeHttpBaseUrl, resolveRuntimeWebSocketUrl } from "./config/runtimeConfig";
import { useSettingsRuntime } from "./app/useSettingsRuntime";
import { useWebSettingsController } from "./app/useWebSettingsController";
import { useExecutionResourceCommands } from "./app/useExecutionResourceCommands";
import { TerminalPanelStatus, TerminalRuntimeBoundary } from "./features/terminal/TerminalPanelStatus";
import { loadWebSettingsOverlayComponent } from "./app/applicationModuleLoaders";
import { SettingsSurfaceLoading } from "./app/SurfaceLoading";
import { scheduleIdleTask } from "./shared/scheduling/scheduleIdleTask";
import { frontendMessage } from "./i18n/frontendMessageCatalog";
import { AppMotionProvider } from "./shared/motion/MotionProvider";
import { AppAppearanceProvider } from "./shared/theme/useAppearance";
import { WorkspaceResourceProvider } from "./shared/workspace/WorkspaceResourceProvider";
import { useRuntimeUpdate } from "./app/runtimeUpdate";

const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
const HTTP_BASE_URL = resolveRuntimeHttpBaseUrl(WS_URL);
type BackgroundTerminalPanelComponent = (typeof import("./features/terminal"))["BackgroundTerminalPanel"];
type SettingsOverlayComponentType = (typeof import("./features/settings/SettingsOverlay"))["SettingsOverlay"];
type ThinkingTimelineProps = ComponentProps<
  (typeof import("./features/workflow/ThinkingTimeline"))["ThinkingTimeline"]
>;
const LazyThinkingTimeline = lazy(() =>
  import("./features/workflow/ThinkingTimeline").then((module) => ({ default: module.ThinkingTimeline })),
);
const LazyEventObservabilityPanel = lazy(() =>
  import("./features/observability/EventObservabilityPanel").then((module) => ({
    default: module.EventObservabilityPanel,
  })),
);
const LazyContinuityPanel = lazy(() =>
  import("./features/continuity/ContinuityPanel").then((module) => ({
    default: module.ContinuityPanel,
  })),
);
type TerminalPanelLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; Component: BackgroundTerminalPanelComponent }
  | { status: "error" };
export function App({
  onLogout,
  socketReconnectPolicy,
  uploadCsrfToken,
}: {
  onLogout?: () => Promise<void>;
  socketReconnectPolicy: AgentSocketReconnectPolicy;
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
  const presetWorldPackages = useStore((s) => s.presetWorldPackages);
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
  const uploadUrl = useMemo(() => buildResourceUploadUrl(HTTP_BASE_URL), []);
  const appShellRenderPlan = readAppShellRenderPlan(responsiveMode);
  const runtimeUpdate = useRuntimeUpdate({
    httpBaseUrl: HTTP_BASE_URL,
    currentVersion: __SENERA_APP_VERSION__,
    surface: "web",
  });
  const [SettingsOverlayComponent, setSettingsOverlayComponent] = useState<SettingsOverlayComponentType | null>(null);
  const prepareSettingsOverlay = useCallback(async (): Promise<void> => {
    const module = await loadWebSettingsOverlayComponent();
    setSettingsOverlayComponent(() => module.default);
  }, []);
  const settingsController = useWebSettingsController({ prepareSurface: prepareSettingsOverlay });

  useEffect(
    () =>
      scheduleIdleTask(() => {
        void prepareSettingsOverlay().catch(() => undefined);
      }),
    [prepareSettingsOverlay],
  );

  const handleWorkflowDockToolChange = useCallback((tool: WorkflowDockTool): void => {
    setWorkflowDockTool(tool);
    if (tool === "terminal") {
      setTerminalPanelLoadState((current) =>
        current.status === "idle" || current.status === "error" ? { status: "loading" } : current,
      );
    }
  }, []);

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
    reconnectPolicy: socketReconnectPolicy,
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
  const settingsRuntime = useSettingsRuntime({ httpBaseUrl: HTTP_BASE_URL, sendRef, statusRef });
  settingsEventHandlerRef.current = settingsRuntime.ingestSettingsEvent;
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
  const handleRefreshActiveSession = useCallback((): void => {
    if (!activeId) return;
    requestSessionHistory(activeId, { refresh: true });
  }, [activeId, requestSessionHistory]);
  useSessionCatalogSync({
    send,
    status,
    onServerSessionsReset: resetServerKnownSessions,
  });

  useEffect(() => {
    if (status !== "open" || !activeId) return;
    send({ type: "session.runtime_status", sessionId: activeId });
  }, [activeId, send, status]);

  const {
    closeSession: handleCloseSession,
    closeSessions: handleCloseSessions,
    compactSession: handleCompactSession,
    createSession: handleNewSession,
    exportSession: handleExportSession,
    inspectSessionRuntime: handleInspectSessionRuntime,
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
    resolveApprovalBatch: handleResolveApprovalBatch,
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
        onStartTerminal={executionResourceCommands.startTerminal}
        onRefresh={executionResourceCommands.refresh}
        onWrite={executionResourceCommands.write}
        onResize={executionResourceCommands.resize}
        onSignal={executionResourceCommands.signal}
        onClose={executionResourceCommands.close}
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

  // sessionPanel(常驻侧栏)与 sessionDrawer(移动端抽屉)共用同一份会话列表行为。
  const sessionListSharedProps: Omit<
    ComponentProps<typeof SessionList>,
    "presentation" | "onClosePanel" | "onSessionSelected"
  > = {
    onNewSession: handleNewSession,
    onCloseSession: handleCloseSession,
    onCloseSessions: handleCloseSessions,
    onCompactSession: handleCompactSession,
    onExportSession: handleExportSession,
    onInspectSessionRuntime: handleInspectSessionRuntime,
    onRenameSession: handleRenameSession,
    userProfile,
    onUpdateUserProfile: handleUpdateUserProfile,
    onLogout,
    socketStatus: status,
    onSettingsIntent: () => {
      void prepareSettingsOverlay().catch(() => undefined);
    },
    onOpenSettings: (section, returnFocus) => {
      void settingsController
        .openSettings(section, returnFocus)
        .catch(() => toast.error(frontendMessage("settings.loadFailed")));
    },
  };

  return (
    <AppMotionProvider level={motionLevel}>
      <AppAppearanceProvider motionLevel={motionLevel}>
        <TooltipProvider delayDuration={300}>
          <WorkspaceResourceProvider httpBaseUrl={HTTP_BASE_URL} csrfToken={uploadCsrfToken}>
            <AppShell
              sessionPanel={<SessionList presentation="auto" {...sessionListSharedProps} />}
              sessionDrawer={
                <SessionList
                  presentation="panel"
                  {...sessionListSharedProps}
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
                      onAddModel: () => {
                        void settingsController
                          .openSettings("model-service")
                          .catch(() => toast.error(frontendMessage("settings.loadFailed")));
                      },
                    }}
                    presetConfig={{
                      presets,
                      worldPackages: presetWorldPackages,
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
                      onResolveApprovalBatch: handleResolveApprovalBatch,
                      onResolveInteractionInput: handleResolveInteractionInput,
                    }}
                    navigationActions={{
                      onOpenSessionPanel: appShellRenderPlan.showChatSessionPanelAction
                        ? handleOpenSessionPanel
                        : undefined,
                      onOpenWorkflowPanel:
                        appShellRenderPlan.showChatWorkflowPanelAction &&
                        (hasPersistentWorkflowPanel ? rightPanelCollapsed : !workflowDrawerOpen)
                          ? handleOpenWorkflowPanel
                          : undefined,
                      onRetryHistory: requestSessionHistory,
                      onOpenSettings: (section, returnFocus) => {
                        void settingsController
                          .openSettings(section, returnFocus)
                          .catch(() => toast.error(frontendMessage("settings.loadFailed")));
                      },
                    }}
                  />
                </ErrorBoundary>
              }
              workflowPanel={<DeferredThinkingTimeline presentation="dock" />}
              workflowDrawer={<DeferredThinkingTimeline presentation="panel" hidePanelTitle />}
              terminalPanel={terminalPanel}
              eventPanel={
                <Suspense fallback={<div className="h-full bg-surface-panel" />}>
                  <LazyEventObservabilityPanel />
                </Suspense>
              }
              statePanel={
                <Suspense fallback={<div className="h-full bg-surface-panel" />}>
                  <LazyContinuityPanel send={send} connected={status === "open"} />
                </Suspense>
              }
              workflowDockTool={workflowDockTool}
              onWorkflowDockToolChange={handleWorkflowDockToolChange}
              sessionDrawerOpen={sessionDrawerOpen}
              onSessionDrawerOpenChange={setSessionDrawerOpen}
              workflowDrawerOpen={workflowDrawerOpen}
              onWorkflowDrawerOpenChange={setWorkflowDrawerOpen}
              responsiveMode={responsiveMode}
              onNewSession={handleNewSession}
              onOpenSessionPanel={handleOpenSessionPanel}
              onOpenWorkflowPanel={handleOpenWorkflowPanel}
              onRefreshSession={activeId ? handleRefreshActiveSession : undefined}
            />
            {settingsController.section !== null || settingsController.closeConfirmationOpen ? (
              SettingsOverlayComponent ? (
                <SettingsOverlayComponent
                  controller={settingsController}
                  workbench={{
                    environment: {
                      appVersion: __SENERA_APP_VERSION__,
                      frontendVersion: __SENERA_FRONTEND_VERSION__,
                      mode: import.meta.env.MODE,
                      surface: "web",
                      runtimeUpdate,
                    },
                    values: { defaultSidebarCollapsed, defaultRightPanelCollapsed },
                    motionLevel,
                    onValueChange: (id, value) => {
                      if (id === "defaultSidebarCollapsed") setDefaultSidebarCollapsed(value);
                      if (id === "defaultRightPanelCollapsed") setDefaultRightPanelCollapsed(value);
                    },
                    onMotionLevelChange: setMotionLevel,
                    systemConfig: settingsRuntime.systemConfig,
                  }}
                />
              ) : (
                <SettingsSurfaceLoading presentation="overlay" />
              )
            ) : null}
            <SeneraToaster />
          </WorkspaceResourceProvider>
        </TooltipProvider>
      </AppAppearanceProvider>
    </AppMotionProvider>
  );
}

function DeferredThinkingTimeline(props: ThinkingTimelineProps): JSX.Element {
  return (
    <Suspense fallback={<div className="h-full w-full" aria-busy="true" />}>
      <LazyThinkingTimeline {...props} />
    </Suspense>
  );
}
