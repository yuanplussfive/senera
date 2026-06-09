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
const SESSION_OVERLAY_WIDTH = "w-[min(360px,calc(100vw-32px))]";
const WORKFLOW_DRAWER_WIDTH = "w-[min(560px,calc(100vw-24px))]";
const WORKFLOW_OVERLAY_WIDTH = "w-[min(560px,calc(100vw-32px))]";

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
  displayMode: "sheet" | "overlay";
  children: ReactNode;
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
  const useSessionSheet = responsiveMode.prefersDrawerNavigation;
  const useWorkflowSheet = responsiveMode.prefersDrawerNavigation;
  const useSessionOverlay = !responsiveMode.hasPersistentSessionPanel && !useSessionSheet;
  const useWorkflowOverlay = !responsiveMode.hasPersistentWorkflowPanel && !useWorkflowSheet;
  const workflowPanelWidth =
    responsiveMode.viewport === "desktop" ? WORKFLOW_PANEL_WIDTH_COMPACT : WORKFLOW_PANEL_WIDTH;

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
    <div className="relative flex h-screen w-screen overflow-hidden text-ink-900">
      <div className="hidden md:flex xl:hidden">{sessionRail}</div>
      <motion.div
        initial={false}
        animate={{ width: sidebarCollapsed ? SESSION_RAIL_WIDTH : SESSION_PANEL_WIDTH }}
        transition={panelResizeTransition}
        className="hidden h-full shrink-0 overflow-hidden xl:flex"
      >
        {sessionPanel}
      </motion.div>
      <div className="flex min-w-0 flex-1">{chatPanel}</div>
      <motion.div
        initial={false}
        animate={{ width: rightPanelCollapsed ? WORKFLOW_RAIL_WIDTH : workflowPanelWidth }}
        transition={panelResizeTransition}
        className="hidden h-full shrink-0 overflow-hidden lg:flex"
      >
        {workflowPanel}
      </motion.div>

      {useSessionOverlay ? (
        <ResponsiveDrawer
          open={sessionDrawerOpen}
          onOpenChange={onSessionDrawerOpenChange}
          side="left"
          title="会话"
          widthClassName={SESSION_OVERLAY_WIDTH}
          displayMode="overlay"
        >
          {sessionDrawer}
        </ResponsiveDrawer>
      ) : null}

      {useWorkflowOverlay ? (
        <ResponsiveDrawer
          open={workflowDrawerOpen}
          onOpenChange={onWorkflowDrawerOpenChange}
          side="right"
          title="思考过程"
          widthClassName={WORKFLOW_OVERLAY_WIDTH}
          displayMode="overlay"
        >
          {workflowDrawer}
        </ResponsiveDrawer>
      ) : null}

      {useSessionSheet ? (
        <ResponsiveDrawer
          open={sessionDrawerOpen}
          onOpenChange={onSessionDrawerOpenChange}
          side="left"
          title="会话"
          widthClassName={SESSION_DRAWER_WIDTH}
          displayMode="sheet"
        >
          {sessionDrawer}
        </ResponsiveDrawer>
      ) : null}

      {useWorkflowSheet ? (
        <ResponsiveDrawer
          open={workflowDrawerOpen}
          onOpenChange={onWorkflowDrawerOpenChange}
          side="right"
          title="思考过程"
          widthClassName={WORKFLOW_DRAWER_WIDTH}
          displayMode="sheet"
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
  displayMode,
  children,
}: ResponsiveDrawerProps): JSX.Element {
  const isOverlay = displayMode === "overlay";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        title={title}
        className={`${widthClassName} p-0`}
        overlayClassName={isOverlay ? "bg-ink-950/20" : undefined}
        focusContentOnOpen={isOverlay}
        showClose={isOverlay && side === "left" ? false : undefined}
        showHeader={isOverlay && side === "left" ? false : undefined}
      >
        <div className="min-h-0 flex-1">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
