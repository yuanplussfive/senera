import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { ErrorBoundary, SeneraToaster, StateView, TooltipProvider } from "./shared/ui";
import { useAgentSocket, type AgentSocketReconnectPolicy, type SocketStatus } from "./api/useAgentSocket";
import { buildResourceUploadUrl } from "./api/uploadClient";
import { useStore } from "./store/sessionStore";
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
import { ApplicationSurfaceLoading, SettingsSurfaceLoading } from "./app/SurfaceLoading";
import { scheduleIdleTask } from "./shared/scheduling/scheduleIdleTask";
import { frontendMessage } from "./i18n/frontendMessageCatalog";
import { isSessionHydratedForStartup, readSessionHydrationState } from "./store/session/sessionHydration";
import { AppMotionProvider } from "./shared/motion/MotionProvider";
import { AppAppearanceProvider } from "./shared/theme/useAppearance";
import { WorkspaceResourceProvider } from "./shared/workspace/WorkspaceResourceProvider";
import { useRuntimeUpdate } from "./app/runtimeUpdate";
import { readDesktopBridge } from "./app/desktopBridge";
import { activateWorkspaceSessionProjection } from "./store/workspaceSessionProjection";
import type { WorkspaceSnapshotData } from "./api/workspaceEventTypes";
import { WorkspaceMenuProvider } from "./shared/workspace/WorkspaceMenu";

const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
const HTTP_BASE_URL = resolveRuntimeHttpBaseUrl(WS_URL);
type BackgroundTerminalPanelComponent = (typeof import("./features/terminal"))["BackgroundTerminalPanel"];
type SettingsOverlayComponentType = (typeof import("./features/settings/SettingsOverlay"))["SettingsOverlay"];
type SessionListComponent = (typeof import("./features/session/SessionList"))["SessionList"];
type ThinkingTimelineProps = ComponentProps<
  (typeof import("./features/workflow/ThinkingTimeline"))["ThinkingTimeline"]
>;
const LazySessionList = lazy(() =>
  import("./features/session/SessionList").then((module) => ({ default: module.SessionList })),
);
const LazyChatPanel = lazy(() => import("./features/chat/ChatPanel").then((module) => ({ default: module.ChatPanel })));
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
  const selectedThinkingLevel = useStore((s) => s.selectedThinkingLevel);
  const selectThinkingLevel = useStore((s) => s.selectThinkingLevel);
  const applyDefaultModelToActiveSession = useStore((s) => s.applyDefaultModelToActiveSession);
  const userProfile = useStore((s) => s.userProfile);
  const markUserProfileSynced = useStore((s) => s.markUserProfileSynced);
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
  const [startupReleased, setStartupReleased] = useState(false);
  const startupCatalogSynced = useStore((state) => state.catalogSynced.sessions);
  const startupHydrationState = useStore((state) => {
    const session = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
    return readSessionHydrationState({
      catalogSynced: state.catalogSynced.sessions,
      session,
      historyLoaded: state.activeSessionId ? !!state.historyLoadedIds[state.activeSessionId] : false,
      historyLoading: state.activeSessionId ? !!state.historyLoadingIds[state.activeSessionId] : false,
      historyFailed: state.activeSessionId ? !!state.historyFailedIds[state.activeSessionId] : false,
    });
  });
  const [workspaceSocketUrl, setWorkspaceSocketUrl] = useState(WS_URL);
  const desiredSocketUrl = useRef(WS_URL);
  const [workspaceIdentity, setWorkspaceIdentity] = useState<string>();
  const scopedHttpBaseUrl = useMemo(() => {
    const url = new URL(HTTP_BASE_URL, window.location.href);
    if (workspaceIdentity) url.searchParams.set("workspaceId", workspaceIdentity);
    return url.toString();
  }, [workspaceIdentity]);
  const uploadUrl = useMemo(() => buildResourceUploadUrl(scopedHttpBaseUrl), [scopedHttpBaseUrl]);
  const handleWorkspaceReady = useCallback((snapshot: WorkspaceSnapshotData, switched: boolean): void => {
    activateWorkspaceSessionProjection(snapshot.workspaceId);
    setWorkspaceIdentity(snapshot.workspaceId);
    if (switched) {
      const url = new URL(WS_URL, window.location.href);
      url.searchParams.set("workspaceId", snapshot.workspaceId);
      desiredSocketUrl.current = url.toString();
      setWorkspaceSocketUrl(url.toString());
      const current = new URL(window.location.href);
      current.searchParams.set("workspaceId", snapshot.workspaceId);
      window.history.replaceState(window.history.state, "", current);
    }
  }, []);
  const appShellRenderPlan = readAppShellRenderPlan(responsiveMode);
  const runtimeSurface = readDesktopBridge()?.isDesktop ? "desktop" : "web";
  const runtimeUpdate = useRuntimeUpdate({
    httpBaseUrl: HTTP_BASE_URL,
    currentVersion: __SENERA_APP_VERSION__,
    surface: runtimeSurface,
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
    url: workspaceSocketUrl,
    reconnectPolicy: socketReconnectPolicy,
    onEvents: useCallback(
      (events, sourceUrl) => {
        if (sourceUrl !== desiredSocketUrl.current) return;
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
          if (
            env.kind === EventKinds.WorkspaceSnapshot ||
            env.kind === EventKinds.WorkspaceSwitched ||
            env.kind === EventKinds.WorkspaceSwitchStarted ||
            env.kind === EventKinds.WorkspaceSwitchFailed
          ) {
            flushProjection();
            settingsEventHandlerRef.current(env);
            if (sourceUrl !== desiredSocketUrl.current) return;
            continue;
          }
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
  const settingsRuntime = useSettingsRuntime({
    httpBaseUrl: HTTP_BASE_URL,
    sendRef,
    statusRef,
    status,
    onWorkspaceReady: handleWorkspaceReady,
  });
  const settingsReady = Boolean(settingsRuntime.systemConfig.configSnapshot);
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
  const handleRefreshInterface = useCallback((): void => {
    window.location.reload();
  }, []);
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
    retryRun: handleRetryRun,
    continueRun: handleContinueRun,
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

  useEffect(() => {
    if (startupReleased) return;
    if (
      settingsController.section !== null ||
      (startupCatalogSynced && isSessionHydratedForStartup(startupHydrationState)) ||
      status === "closed" ||
      status === "error"
    ) {
      setStartupReleased(true);
    }
  }, [settingsController.section, startupCatalogSynced, startupHydrationState, startupReleased, status]);

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

  if (!startupReleased) return <ApplicationSurfaceLoading />;

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
    ComponentProps<SessionListComponent>,
    "presentation" | "onClosePanel" | "onSessionSelected"
  > = {
    onNewSession: handleNewSession,
    onCloseSession: handleCloseSession,
    onCloseSessions: handleCloseSessions,
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
          <WorkspaceResourceProvider
            key={workspaceIdentity}
            httpBaseUrl={scopedHttpBaseUrl}
            csrfToken={uploadCsrfToken}
          >
            <WorkspaceMenuProvider workspace={settingsRuntime.workspace} httpBaseUrl={HTTP_BASE_URL}>
              <AppShell
                sessionPanel={
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="min-h-0 flex-1">
                      <Suspense fallback={null}>
                        <LazySessionList presentation="auto" {...sessionListSharedProps} />
                      </Suspense>
                    </div>
                  </div>
                }
                sessionDrawer={
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="min-h-0 flex-1">
                      <Suspense fallback={null}>
                        <LazySessionList
                          presentation="panel"
                          {...sessionListSharedProps}
                          onClosePanel={() => setSessionDrawerOpen(false)}
                          onSessionSelected={() => setSessionDrawerOpen(false)}
                        />
                      </Suspense>
                    </div>
                  </div>
                }
                chatPanel={
                  <ErrorBoundary resetKey={activeId}>
                    <Suspense
                      fallback={
                        <StateView status="loading" title={frontendMessage("ui.loading")} className="h-full min-h-0" />
                      }
                    >
                      <LazyChatPanel
                        userProfile={userProfile}
                        modelConfig={{
                          modelProviders,
                          selectedModelProviderId,
                          defaultModelProviderId,
                          onSelectModelProvider: selectModelProvider,
                          selectedThinkingLevel,
                          onSelectThinkingLevel: selectThinkingLevel,
                          onApplyDefaultModel: applyDefaultModelToActiveSession,
                          onAddModel: () => {
                            void settingsController
                              .openSettings("model-service")
                              .catch(() => toast.error(frontendMessage("settings.loadFailed")));
                          },
                        }}
                        runtime={{
                          workspaceId: workspaceIdentity,
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
                          onRetryRun: handleRetryRun,
                          onContinueRun: handleContinueRun,
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
                    </Suspense>
                  </ErrorBoundary>
                }
                workflowPanel={<DeferredThinkingTimeline presentation="dock" />}
                workflowDrawer={<DeferredThinkingTimeline presentation="panel" hidePanelTitle />}
                terminalPanel={terminalPanel}
                eventPanel={
                  <ErrorBoundary
                    fallback={(error) => (
                      <StateView
                        status="error"
                        title={frontendMessage("app.errorBoundary.title")}
                        description={error.message}
                        onRetry={() => window.location.reload()}
                        retryLabel={frontendMessage("app.errorBoundary.reload")}
                        className="h-full min-h-0 bg-surface-panel"
                      />
                    )}
                  >
                    <Suspense
                      fallback={
                        <StateView
                          status="loading"
                          title={frontendMessage("observability.title")}
                          className="h-full min-h-0 bg-surface-panel"
                        />
                      }
                    >
                      <LazyEventObservabilityPanel />
                    </Suspense>
                  </ErrorBoundary>
                }
                statePanel={
                  <Suspense
                    fallback={
                      <StateView
                        status="loading"
                        title={frontendMessage("continuity.title")}
                        className="h-full min-h-0 bg-surface-panel"
                      />
                    }
                  >
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
                onRefreshInterface={handleRefreshInterface}
              />
              {settingsController.section !== null || settingsController.closeConfirmationOpen ? (
                SettingsOverlayComponent && settingsReady ? (
                  <SettingsOverlayComponent
                    controller={settingsController}
                    workbench={{
                      environment: {
                        appVersion: __SENERA_APP_VERSION__,
                        frontendVersion: __SENERA_FRONTEND_VERSION__,
                        mode: import.meta.env.MODE,
                        surface: runtimeSurface,
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
                      workspace: settingsRuntime.workspace,
                    }}
                  />
                ) : (
                  <SettingsSurfaceLoading presentation="overlay" />
                )
              ) : null}
              <SeneraToaster />
            </WorkspaceMenuProvider>
          </WorkspaceResourceProvider>
        </TooltipProvider>
      </AppAppearanceProvider>
    </AppMotionProvider>
  );
}
function DeferredThinkingTimeline(props: ThinkingTimelineProps): JSX.Element {
  return (
    <Suspense
      fallback={
        <StateView
          status="loading"
          title={frontendMessage("workflow.panel.loadingGraph")}
          className="h-full min-h-0 w-full"
        />
      }
    >
      <LazyThinkingTimeline {...props} />
    </Suspense>
  );
}
