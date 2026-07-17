import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { motion, type Transition } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { Sheet, SheetContent } from "../shared/ui";
import { motionTimings, useMotionLevel } from "../shared/motion";
import { useStore } from "../store/sessionStore";
import type { ResponsiveMode } from "../shared/responsive";

const SESSION_PANEL_WIDTH = 246;
const SESSION_PANEL_COLLAPSED_WIDTH = 58;
const WORKFLOW_PANEL_WIDTH_COMPACT = 360;
const WORKFLOW_PANEL_WIDTH = 460;
const SESSION_DRAWER_WIDTH = "w-[min(360px,calc(100vw-24px))]";
const WORKFLOW_DRAWER_WIDTH = "w-[min(560px,calc(100vw-24px))]";

interface AppShellProps {
  sessionPanel: ReactNode;
  sessionDrawer: ReactNode;
  chatPanel: ReactNode;
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
  showWorkflowPersistentPanel: boolean;
  workflowPanelLayout: WorkflowPanelLayout;
  showSessionDrawer: boolean;
  showWorkflowDrawer: boolean;
  showChatSessionPanelAction: boolean;
  showChatWorkflowPanelAction: boolean;
}

export interface AppShellResponsiveEntryPlan {
  sidebarCollapsed: boolean | null;
  rightPanelCollapsed: boolean | null;
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
    showWorkflowPersistentPanel,
    workflowPanelLayout: showWorkflowPersistentPanel
      ? responsiveMode.hasInlineWorkflowPanel
        ? "inline"
        : "overlay"
      : "drawer",
    showSessionDrawer: surfacePlan.session === "drawer",
    showWorkflowDrawer: surfacePlan.workflow === "drawer",
    showChatSessionPanelAction: surfacePlan.session === "drawer",
    showChatWorkflowPanelAction: true,
  };
}

export function readWorkflowPanelWidth(responsiveMode: ResponsiveMode): number {
  return responsiveMode.viewport === "wide" ? WORKFLOW_PANEL_WIDTH : WORKFLOW_PANEL_WIDTH_COMPACT;
}

export function readAppShellResponsiveEntryPlan(responsiveMode: ResponsiveMode): AppShellResponsiveEntryPlan {
  return {
    sidebarCollapsed: responsiveMode.hasPersistentSessionPanel ? false : null,
    rightPanelCollapsed: responsiveMode.hasPersistentWorkflowPanel ? !responsiveMode.hasInlineWorkflowPanel : null,
  };
}

export function AppShell({
  sessionPanel,
  sessionDrawer,
  chatPanel,
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
  const setSidebarCollapsed = useStore((state) => state.setSidebarCollapsed);
  const setRightPanelCollapsed = useStore((state) => state.setRightPanelCollapsed);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const renderPlan = readAppShellRenderPlan(responsiveMode);
  const workflowPanelWidth = readWorkflowPanelWidth(responsiveMode);
  const responsiveLayoutKey = `${renderPlan.showSessionPersistentPanel ? "persistent" : "drawer"}:${renderPlan.workflowPanelLayout}`;
  const previousResponsiveLayoutKeyRef = useRef<string | null>(null);

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
    if (previousResponsiveLayoutKeyRef.current === responsiveLayoutKey) return;
    previousResponsiveLayoutKeyRef.current = responsiveLayoutKey;
    const entryPlan = readAppShellResponsiveEntryPlan(responsiveMode);
    if (entryPlan.sidebarCollapsed !== null) {
      setSidebarCollapsed(entryPlan.sidebarCollapsed);
    }
    if (entryPlan.rightPanelCollapsed !== null) {
      setRightPanelCollapsed(entryPlan.rightPanelCollapsed);
    }
  }, [responsiveLayoutKey, responsiveMode, setRightPanelCollapsed, setSidebarCollapsed]);

  const workflowPanelInline = renderPlan.workflowPanelLayout === "inline";
  const sessionPanelTransition: Transition =
    disableMotion || reduceMotion
      ? { duration: 0 }
      : sidebarCollapsed
        ? motionTimings.panelClose
        : motionTimings.panelOpen;
  const workflowPanelTransition: Transition =
    disableMotion || reduceMotion
      ? { duration: 0 }
      : rightPanelCollapsed
        ? motionTimings.panelClose
        : motionTimings.panelOpen;
  const workflowPanelTarget = workflowPanelInline
    ? {
        width: rightPanelCollapsed ? 0 : workflowPanelWidth,
        opacity: rightPanelCollapsed ? 0 : 1,
        x: rightPanelCollapsed ? 16 : 0,
      }
    : {
        width: workflowPanelWidth,
        opacity: rightPanelCollapsed ? 0 : 1,
        x: rightPanelCollapsed ? 16 : 0,
      };

  return (
    <div
      className="relative flex h-dvh w-screen gap-2.5 overflow-hidden bg-surface-canvas p-2.5 text-content-primary"
      data-workspace-shell
    >
      {renderPlan.showSessionPersistentPanel ? (
        <motion.div
          initial={false}
          animate={{
            width: sidebarCollapsed ? SESSION_PANEL_COLLAPSED_WIDTH : SESSION_PANEL_WIDTH,
          }}
          transition={sessionPanelTransition}
          className="relative z-20 h-full shrink-0 overflow-hidden"
          style={{ willChange: "width" }}
          data-open={!sidebarCollapsed}
          data-collapsed={sidebarCollapsed}
        >
          <div
            className="h-full"
            style={{ width: sidebarCollapsed ? SESSION_PANEL_COLLAPSED_WIDTH : SESSION_PANEL_WIDTH }}
          >
            {sessionPanel}
          </div>
        </motion.div>
      ) : null}

      <div className="workspace-main relative flex min-w-0 flex-1 overflow-hidden" data-workspace-main>
        {chatPanel}
      </div>

      {renderPlan.showWorkflowPersistentPanel ? (
        <motion.div
          initial={false}
          animate={workflowPanelTarget}
          transition={workflowPanelTransition}
          className={
            renderPlan.workflowPanelLayout === "overlay"
              ? "absolute bottom-0 right-0 top-0 z-30 overflow-hidden rounded-xl border border-line-subtle bg-surface-panel [box-shadow:var(--theme-overlay-shadow)]"
              : "relative z-20 h-full shrink-0 overflow-hidden border-l border-line-subtle bg-surface-panel"
          }
          style={{
            ...(renderPlan.workflowPanelLayout === "overlay"
              ? { top: "var(--senera-titlebar-height, 0px)", right: "8px", bottom: "8px" }
              : undefined),
            pointerEvents: rightPanelCollapsed ? "none" : "auto",
            willChange: "width, opacity, transform",
          }}
          aria-hidden={rightPanelCollapsed}
          data-open={!rightPanelCollapsed}
          data-workflow-panel-surface
          data-workflow-panel-layout={renderPlan.workflowPanelLayout}
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
