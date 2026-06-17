import { motion, type Transition } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { Sheet, SheetContent } from "../shared/ui";
import { motionTimings, useMotionLevel } from "../shared/motion";
import { useStore } from "../store/sessionStore";
import type { ResponsiveMode } from "../shared/responsive";

const SESSION_RAIL_WIDTH = 56;
const SESSION_PANEL_WIDTH = 264;
const WORKFLOW_RAIL_WIDTH = 44;
const WORKFLOW_PANEL_WIDTH_COMPACT = 360;
const WORKFLOW_PANEL_WIDTH = 460;
const SESSION_DRAWER_WIDTH = "w-[min(360px,calc(100vw-24px))]";
const WORKFLOW_DRAWER_WIDTH = "w-[min(560px,calc(100vw-24px))]";

interface AppShellProps {
  sessionRail: ReactNode;
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

interface AppShellSurfacePlan {
  session: AppShellSurface;
  workflow: AppShellSurface;
}

interface AppShellRenderPlan {
  showSessionRail: boolean;
  showSessionPersistentPanel: boolean;
  showWorkflowPersistentPanel: boolean;
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
  return {
    showSessionRail: responsiveMode.viewport === "tablet" || responsiveMode.viewport === "desktop",
    showSessionPersistentPanel: surfacePlan.session === "persistent",
    showWorkflowPersistentPanel: surfacePlan.workflow === "persistent",
    showSessionDrawer: surfacePlan.session === "drawer",
    showWorkflowDrawer: surfacePlan.workflow === "drawer",
    showChatSessionPanelAction: responsiveMode.viewport === "mobile",
    showChatWorkflowPanelAction: surfacePlan.workflow === "drawer",
  };
}

export function readWorkflowPanelWidth(responsiveMode: ResponsiveMode): number {
  return responsiveMode.viewport === "wide" ? WORKFLOW_PANEL_WIDTH : WORKFLOW_PANEL_WIDTH_COMPACT;
}

export function AppShell({
  sessionRail,
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
  const { reduceMotion, disableMotion } = useMotionLevel();
  const panelResizeTransition: Transition =
    disableMotion || reduceMotion ? { duration: 0 } : motionTimings.slow;
  const renderPlan = readAppShellRenderPlan(responsiveMode);
  const workflowPanelWidth = readWorkflowPanelWidth(responsiveMode);

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

  return (
    <div className="relative flex h-dvh w-screen overflow-hidden text-ink-900">
      {renderPlan.showSessionRail ? <div className="flex">{sessionRail}</div> : null}
      {renderPlan.showSessionPersistentPanel ? (
        <motion.div
          initial={false}
          animate={{ width: sidebarCollapsed ? SESSION_RAIL_WIDTH : SESSION_PANEL_WIDTH }}
          transition={panelResizeTransition}
          className="h-full shrink-0 overflow-hidden"
        >
          {sessionPanel}
        </motion.div>
      ) : null}
      <div className="flex min-w-0 flex-1">{chatPanel}</div>
      {renderPlan.showWorkflowPersistentPanel ? (
        <motion.div
          initial={false}
          animate={{ width: rightPanelCollapsed ? WORKFLOW_RAIL_WIDTH : workflowPanelWidth }}
          transition={panelResizeTransition}
          className="h-full shrink-0 overflow-hidden"
        >
          {workflowPanel}
        </motion.div>
      ) : null}

      {renderPlan.showSessionDrawer ? (
        <ResponsiveDrawer
          open={sessionDrawerOpen}
          onOpenChange={onSessionDrawerOpenChange}
          side="left"
          title="会话"
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
          title="思考过程"
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
