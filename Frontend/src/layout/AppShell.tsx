import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { motion, type Transition } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { Sheet, SheetContent } from "../shared/ui";
import { motionTimings, useMotionLevel } from "../shared/motion";
import { useStore } from "../store/sessionStore";
import type { ResponsiveMode } from "../shared/responsive";

const SESSION_PANEL_WIDTH = 268;
const WORKFLOW_DOCK_WIDTH = 46;
const WORKFLOW_PANEL_WIDTH_COMPACT = 360;
const WORKFLOW_PANEL_WIDTH = 460;
const SESSION_DRAWER_WIDTH = "w-[min(360px,calc(100vw-24px))]";
const WORKFLOW_DRAWER_WIDTH = "w-[min(560px,calc(100vw-24px))]";

interface AppShellProps {
  sessionPanel: ReactNode;
  sessionDrawer: ReactNode;
  chatPanel: ReactNode;
  workflowDock: ReactNode;
  workflowPanel: ReactNode;
  workflowDrawer: ReactNode;
  sessionDrawerOpen: boolean;
  onSessionDrawerOpenChange: (open: boolean) => void;
  workflowDrawerOpen: boolean;
  onWorkflowDrawerOpenChange: (open: boolean) => void;
  responsiveMode: ResponsiveMode;
}

interface ResponsiveDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right";
  title: string;
  widthClassName: string;
  focusContentOnOpen?: boolean;
  showClose?: boolean;
  showHeader?: boolean;
  children: ReactNode;
}

type AppShellSurface = "drawer" | "persistent";
type WorkflowPanelLayout = "drawer" | "overlay" | "inline";

interface AppShellSurfacePlan {
  session: AppShellSurface;
  workflow: AppShellSurface;
}

interface AppShellRenderPlan {
  showSessionPersistentPanel: boolean;
  showWorkflowDock: boolean;
  showWorkflowPersistentPanel: boolean;
  workflowPanelLayout: WorkflowPanelLayout;
  showSessionDrawer: boolean;
  showWorkflowDrawer: boolean;
  showChatSessionPanelAction: boolean;
  showChatWorkflowPanelAction: boolean;
}

export function readAppShellSurfacePlan(responsiveMode: ResponsiveMode): AppShellSurfacePlan {
  return {
    session: responsiveMode.hasPersistentSessionPanel ? "persistent" : "drawer",
    workflow: responsiveMode.hasPersistentWorkflowPanel ? "persistent" : "drawer",
  };
}

export function readAppShellRenderPlan(responsiveMode: ResponsiveMode): AppShellRenderPlan {
  const surfacePlan = readAppShellSurfacePlan(responsiveMode);
  const showWorkflowPersistentPanel = surfacePlan.workflow === "persistent";
  return {
    showSessionPersistentPanel: surfacePlan.session === "persistent",
    showWorkflowDock: showWorkflowPersistentPanel,
    showWorkflowPersistentPanel,
    workflowPanelLayout: showWorkflowPersistentPanel
      ? responsiveMode.hasInlineWorkflowPanel
        ? "inline"
        : "overlay"
      : "drawer",
    showSessionDrawer: surfacePlan.session === "drawer",
    showWorkflowDrawer: surfacePlan.workflow === "drawer",
    showChatSessionPanelAction: surfacePlan.session === "drawer",
    showChatWorkflowPanelAction: surfacePlan.workflow === "drawer",
  };
}

export function readWorkflowPanelWidth(responsiveMode: ResponsiveMode): number {
  return responsiveMode.viewport === "wide" ? WORKFLOW_PANEL_WIDTH : WORKFLOW_PANEL_WIDTH_COMPACT;
}

export function AppShell({
  sessionPanel,
  sessionDrawer,
  chatPanel,
  workflowDock,
  workflowPanel,
  workflowDrawer,
  sessionDrawerOpen,
  onSessionDrawerOpenChange,
  workflowDrawerOpen,
  onWorkflowDrawerOpenChange,
  responsiveMode,
}: AppShellProps): JSX.Element {
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed);
  const rightPanelCollapsed = useStore((state) => state.rightPanelCollapsed);
  const defaultSidebarCollapsed = useStore((state) => state.defaultSidebarCollapsed);
  const defaultRightPanelCollapsed = useStore((state) => state.defaultRightPanelCollapsed);
  const setSidebarCollapsed = useStore((state) => state.setSidebarCollapsed);
  const setRightPanelCollapsed = useStore((state) => state.setRightPanelCollapsed);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const panelResizeTransition: Transition = disableMotion || reduceMotion ? { duration: 0 } : motionTimings.slow;
  const renderPlan = readAppShellRenderPlan(responsiveMode);
  const workflowPanelWidth = readWorkflowPanelWidth(responsiveMode);
  const hadPersistentSessionPanel = useRef(renderPlan.showSessionPersistentPanel);
  const hadPersistentWorkflowPanel = useRef(renderPlan.showWorkflowPersistentPanel);

  useEffect(() => {
    if (responsiveMode.hasPersistentSessionPanel && sessionDrawerOpen) {
      onSessionDrawerOpenChange(false);
    }
    if (responsiveMode.hasPersistentWorkflowPanel && workflowDrawerOpen) {
      onWorkflowDrawerOpenChange(false);
    }
  }, [
    onSessionDrawerOpenChange,
    onWorkflowDrawerOpenChange,
    responsiveMode.hasPersistentSessionPanel,
    responsiveMode.hasPersistentWorkflowPanel,
    sessionDrawerOpen,
    workflowDrawerOpen,
  ]);

  useEffect(() => {
    if (renderPlan.showSessionPersistentPanel && !hadPersistentSessionPanel.current) {
      setSidebarCollapsed(defaultSidebarCollapsed);
    }
    if (renderPlan.showWorkflowPersistentPanel && !hadPersistentWorkflowPanel.current) {
      setRightPanelCollapsed(defaultRightPanelCollapsed);
    }
    hadPersistentSessionPanel.current = renderPlan.showSessionPersistentPanel;
    hadPersistentWorkflowPanel.current = renderPlan.showWorkflowPersistentPanel;
  }, [
    defaultRightPanelCollapsed,
    defaultSidebarCollapsed,
    renderPlan.showSessionPersistentPanel,
    renderPlan.showWorkflowPersistentPanel,
    setRightPanelCollapsed,
    setSidebarCollapsed,
  ]);

  const workflowPanelMotion =
    renderPlan.workflowPanelLayout === "inline"
      ? { width: rightPanelCollapsed ? 0 : workflowPanelWidth, opacity: rightPanelCollapsed ? 0 : 1, x: 0 }
      : { width: workflowPanelWidth, opacity: rightPanelCollapsed ? 0 : 1, x: rightPanelCollapsed ? 24 : 0 };

  return (
    <div
      className="relative flex h-dvh w-screen overflow-hidden bg-[var(--theme-bg)] text-ink-900"
      data-workspace-shell
    >
      {renderPlan.showSessionPersistentPanel ? (
        <motion.div
          initial={false}
          animate={{ width: sidebarCollapsed ? 0 : SESSION_PANEL_WIDTH, opacity: sidebarCollapsed ? 0 : 1 }}
          transition={panelResizeTransition}
          className="relative z-20 h-full shrink-0 overflow-hidden"
          style={{ visibility: sidebarCollapsed ? "hidden" : "visible" }}
          aria-hidden={sidebarCollapsed}
        >
          {sessionPanel}
        </motion.div>
      ) : null}

      <div className="workspace-main relative flex min-w-0 flex-1 overflow-hidden" data-workspace-main>
        {chatPanel}
      </div>

      {renderPlan.showWorkflowDock ? (
        <div className="relative z-30 h-full shrink-0" style={{ width: WORKFLOW_DOCK_WIDTH }}>
          {workflowDock}
        </div>
      ) : null}

      {renderPlan.showWorkflowPersistentPanel ? (
        <motion.div
          initial={false}
          animate={workflowPanelMotion}
          transition={panelResizeTransition}
          className={
            renderPlan.workflowPanelLayout === "overlay"
              ? "absolute bottom-0 right-[46px] top-0 z-20 overflow-hidden shadow-[-18px_0_34px_-30px_rgb(24_25_28/0.45)]"
              : "relative z-20 h-full shrink-0 overflow-hidden"
          }
          style={{
            ...(renderPlan.workflowPanelLayout === "overlay" ? { width: workflowPanelWidth } : {}),
            pointerEvents: rightPanelCollapsed ? "none" : "auto",
            visibility: rightPanelCollapsed ? "hidden" : "visible",
          }}
          aria-hidden={rightPanelCollapsed}
        >
          <div className="h-full" style={{ width: workflowPanelWidth }}>
            {workflowPanel}
          </div>
        </motion.div>
      ) : null}

      {renderPlan.showSessionDrawer ? (
        <ResponsiveDrawer
          open={sessionDrawerOpen}
          onOpenChange={onSessionDrawerOpenChange}
          side="left"
          title={frontendMessage("session.section")}
          widthClassName={SESSION_DRAWER_WIDTH}
          focusContentOnOpen
          showClose={false}
          showHeader={false}
        >
          {sessionDrawer}
        </ResponsiveDrawer>
      ) : null}

      {renderPlan.showWorkflowDrawer ? (
        <ResponsiveDrawer
          open={workflowDrawerOpen}
          onOpenChange={onWorkflowDrawerOpenChange}
          side="right"
          title={frontendMessage("workflow.panel.title")}
          widthClassName={WORKFLOW_DRAWER_WIDTH}
        >
          {workflowDrawer}
        </ResponsiveDrawer>
      ) : null}
    </div>
  );
}

function ResponsiveDrawer({
  open,
  onOpenChange,
  side,
  title,
  widthClassName,
  focusContentOnOpen,
  showClose,
  showHeader,
  children,
}: ResponsiveDrawerProps): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        title={title}
        className={`${widthClassName} p-0`}
        deferContentMount
        focusContentOnOpen={focusContentOnOpen}
        showClose={showClose}
        showHeader={showHeader}
      >
        <div className="min-h-0 flex-1">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
