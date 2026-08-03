import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { ListTree, PanelRightClose, SquareTerminal } from "lucide-react";
import { motion, type Transition } from "framer-motion";
import { cn } from "../lib/util";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { IconButton, Sheet, SheetContent, Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui";
import { motionTimings, useMotionLevel } from "../shared/motion";
import { useStore } from "../store/sessionStore";
import {
  clampWorkflowDockWidth,
  readWorkflowDockWidthConstraints,
  useViewportSize,
  type ResponsiveMode,
} from "../shared/responsive";

const SESSION_PANEL_WIDTH = 246;
const SESSION_PANEL_COLLAPSED_WIDTH = 58;
const WORKFLOW_DOCK_CAPSULE_WIDTH = 40;
const WORKFLOW_DOCK_GUTTER_WIDTH = 46;
const WORKFLOW_DOCK_KEYBOARD_STEP = 16;
const SESSION_DRAWER_WIDTH = "w-[min(360px,calc(100vw-24px))]";
const WORKFLOW_DRAWER_WIDTH = "w-[min(560px,calc(100vw-24px))]";

interface AppShellProps {
  sessionPanel: ReactNode;
  sessionDrawer: ReactNode;
  chatPanel: ReactNode;
  workflowPanel: ReactNode;
  workflowDrawer: ReactNode;
  terminalPanel: ReactNode;
  workflowDockTool: WorkflowDockTool;
  onWorkflowDockToolChange: (tool: WorkflowDockTool) => void;
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
export type WorkflowDockTool = "execution" | "terminal";

const WORKFLOW_DOCK_ITEMS = [
  {
    id: "execution",
    label: frontendMessage("workflow.dock.execution"),
    tooltip: frontendMessage("workflow.dock.execution"),
    Icon: ListTree,
  },
  {
    id: "terminal",
    label: frontendMessage("workflow.dock.terminal"),
    tooltip: frontendMessage("workflow.dock.terminal"),
    Icon: SquareTerminal,
  },
] as const satisfies readonly { id: WorkflowDockTool; label: string; tooltip: string; Icon: typeof ListTree }[];

type WorkflowDockPanelProps = {
  hidePanelTitle?: boolean;
};

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
    showChatWorkflowPanelAction: surfacePlan.workflow === "drawer",
  };
}

export function readAppShellResponsiveEntryPlan(responsiveMode: ResponsiveMode): AppShellResponsiveEntryPlan {
  return {
    sidebarCollapsed: responsiveMode.hasPersistentSessionPanel ? false : null,
    rightPanelCollapsed: responsiveMode.hasPersistentWorkflowPanel ? true : null,
  };
}

export function AppShell({
  sessionPanel,
  sessionDrawer,
  chatPanel,
  workflowPanel,
  workflowDrawer,
  terminalPanel,
  workflowDockTool,
  onWorkflowDockToolChange,
  sessionDrawerOpen,
  onSessionDrawerOpenChange,
  workflowDrawerOpen,
  onWorkflowDrawerOpenChange,
  responsiveMode,
}: AppShellProps): JSX.Element {
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed);
  const rightPanelCollapsed = useStore((state) => state.rightPanelCollapsed);
  const workflowDockWidth = useStore((state) => state.workflowDockWidth);
  const setSidebarCollapsed = useStore((state) => state.setSidebarCollapsed);
  const setRightPanelCollapsed = useStore((state) => state.setRightPanelCollapsed);
  const setWorkflowDockWidth = useStore((state) => state.setWorkflowDockWidth);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const viewport = useViewportSize();
  const renderPlan = readAppShellRenderPlan(responsiveMode);
  const workflowDockWidthConstraints = readWorkflowDockWidthConstraints(
    viewport.width,
    sidebarCollapsed ? SESSION_PANEL_COLLAPSED_WIDTH : SESSION_PANEL_WIDTH,
  );
  const workflowPanelWidth = clampWorkflowDockWidth(workflowDockWidth, workflowDockWidthConstraints);
  const responsiveLayoutKey = `${renderPlan.showSessionPersistentPanel ? "persistent" : "drawer"}:${renderPlan.workflowPanelLayout}`;
  const previousResponsiveLayoutKeyRef = useRef<string | null>(null);
  const workflowDockResizeRef = useRef<{ pointerId: number; startWidth: number; startX: number } | null>(null);
  const [workflowDockResizing, setWorkflowDockResizing] = useState(false);

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
    disableMotion || reduceMotion || workflowDockResizing
      ? { duration: 0 }
      : rightPanelCollapsed
        ? motionTimings.panelClose
        : motionTimings.panelOpen;
  const handleWorkflowDockTool = (tool: WorkflowDockTool): void => {
    onWorkflowDockToolChange(tool);
    setRightPanelCollapsed(false);
  };
  const handleWorkflowDockResizeStart = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    workflowDockResizeRef.current = {
      pointerId: event.pointerId,
      startWidth: workflowPanelWidth,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setWorkflowDockResizing(true);
  };
  const handleWorkflowDockResizeMove = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = workflowDockResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const nextWidth = resize.startWidth + resize.startX - event.clientX;
    setWorkflowDockWidth(clampWorkflowDockWidth(nextWidth, workflowDockWidthConstraints));
  };
  const handleWorkflowDockResizeEnd = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = workflowDockResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    workflowDockResizeRef.current = null;
    setWorkflowDockResizing(false);
  };
  const handleWorkflowDockResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const nextWidth =
      event.key === "ArrowLeft"
        ? workflowPanelWidth + WORKFLOW_DOCK_KEYBOARD_STEP
        : event.key === "ArrowRight"
          ? workflowPanelWidth - WORKFLOW_DOCK_KEYBOARD_STEP
          : event.key === "Home"
            ? workflowDockWidthConstraints.min
            : event.key === "End"
              ? workflowDockWidthConstraints.max
              : null;
    if (nextWidth === null) return;
    event.preventDefault();
    setWorkflowDockWidth(clampWorkflowDockWidth(nextWidth, workflowDockWidthConstraints));
  };

  const workflowPanelProps: WorkflowDockPanelProps = {
    hidePanelTitle: true,
  };

  const renderWorkflowPanel = (panel: ReactNode): ReactNode => {
    if (!isValidElement(panel) || typeof panel.type === "string") return panel;
    return cloneElement(panel as ReactElement<WorkflowDockPanelProps>, workflowPanelProps);
  };

  const renderTerminalContent = (presentation: "dock" | "drawer"): ReactNode => {
    return (
      <aside className="flex h-full min-h-0 flex-col bg-transparent" data-terminal-dock={presentation}>
        {terminalPanel}
      </aside>
    );
  };

  const renderWorkflowDockSurface = (presentation: "dock" | "drawer", executionPanel: ReactNode): ReactNode => {
    const handleValueChange = (value: string): void => {
      const nextTool = WORKFLOW_DOCK_ITEMS.find((item) => item.id === value)?.id;
      if (nextTool) handleWorkflowDockTool(nextTool);
    };

    return (
      <Tabs value={workflowDockTool} onValueChange={handleValueChange} className="flex h-full min-h-0 w-full flex-col">
        {presentation === "dock" ? (
          <div className="hidden shrink-0" data-window-drag-region data-workflow-dock-titlebar-spacer />
        ) : null}
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-line-subtle pl-3 pr-3",
            presentation === "dock" ? "h-[58px]" : "h-[52px]",
          )}
          data-window-drag-region
          data-workflow-dock-toolbar
        >
          <TabsList
            className="w-full flex-1"
            aria-label={frontendMessage("workflow.dock.tabs")}
            data-workflow-dock-tabs
            data-workflow-dock-tabs-list
          >
            {WORKFLOW_DOCK_ITEMS.map(({ id, label }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="relative isolate overflow-visible data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                data-workflow-dock-tab={id}
              >
                {workflowDockTool === id ? (
                  <motion.span
                    layoutId={`workflow-dock-active-tab-${presentation}`}
                    transition={disableMotion || reduceMotion ? { duration: 0 } : { layout: motionTimings.selection }}
                    className="pointer-events-none absolute inset-0 z-0 rounded-md bg-surface-raised shadow-sm"
                    data-workflow-dock-active-indicator={presentation}
                  />
                ) : null}
                <span className="relative z-10 min-w-0 truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {presentation === "dock" ? (
            <IconButton
              label={frontendMessage("workflow.panel.collapse")}
              tone="muted"
              tooltip={frontendMessage("workflow.panel.collapse")}
              tooltipSide="bottom"
              onClick={() => setRightPanelCollapsed(true)}
              className="shrink-0"
              data-workflow-dock-collapse
            >
              <PanelRightClose className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
        <TabsContent value="execution" className="min-h-0 flex-1 overflow-hidden">
          {renderWorkflowPanel(executionPanel)}
        </TabsContent>
        <TabsContent value="terminal" className="min-h-0 flex-1 overflow-hidden">
          {renderTerminalContent(presentation)}
        </TabsContent>
      </Tabs>
    );
  };

  return (
    <div
      className="relative flex h-dvh w-screen gap-2.5 overflow-hidden bg-surface-canvas p-2.5 text-content-primary [background-image:var(--theme-bg-image)]"
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
        <>
          <motion.div
            initial={false}
            animate={{
              width: workflowPanelInline && !rightPanelCollapsed ? workflowPanelWidth : WORKFLOW_DOCK_GUTTER_WIDTH,
            }}
            transition={workflowPanelTransition}
            className="h-full shrink-0"
            style={{ willChange: "width" }}
            aria-hidden="true"
            data-workflow-dock-gutter
          />

          <motion.div
            initial={false}
            animate={{ width: rightPanelCollapsed ? WORKFLOW_DOCK_CAPSULE_WIDTH : workflowPanelWidth }}
            transition={workflowPanelTransition}
            className="pointer-events-none absolute inset-y-0 z-30"
            style={{ right: rightPanelCollapsed ? 12 : 0, willChange: "width" }}
            data-workflow-dock
            data-workflow-dock-layout={renderPlan.workflowPanelLayout}
            data-open={!rightPanelCollapsed}
          >
            {!rightPanelCollapsed ? (
              <motion.div
                initial={false}
                animate={{ opacity: 1, x: 0 }}
                transition={workflowPanelTransition}
                className={cn(
                  "pointer-events-auto absolute inset-y-0 right-0 w-full overflow-hidden",
                  renderPlan.workflowPanelLayout === "overlay"
                    ? "border-l border-line-subtle bg-surface-panel [box-shadow:var(--theme-overlay-shadow)]"
                    : "border-l border-line-subtle bg-surface-canvas [background-image:var(--theme-bg-image)]",
                )}
                style={{ willChange: "opacity, transform" }}
                data-workflow-panel-surface
                data-workflow-panel-layout={renderPlan.workflowPanelLayout}
              >
                <div
                  role="separator"
                  aria-label={frontendMessage("workflow.dock.resize")}
                  aria-orientation="vertical"
                  aria-valuemin={workflowDockWidthConstraints.min}
                  aria-valuemax={workflowDockWidthConstraints.max}
                  aria-valuenow={workflowPanelWidth}
                  tabIndex={0}
                  className="group absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize touch-none outline-none"
                  onPointerDown={handleWorkflowDockResizeStart}
                  onPointerMove={handleWorkflowDockResizeMove}
                  onPointerUp={handleWorkflowDockResizeEnd}
                  onPointerCancel={handleWorkflowDockResizeEnd}
                  onKeyDown={handleWorkflowDockResizeKeyDown}
                  data-workflow-dock-resize
                >
                  <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent-border-strong group-focus-visible:bg-accent-solid" />
                </div>
                <div className="h-full w-full" data-workflow-dock-content>
                  {renderWorkflowDockSurface("dock", workflowPanel)}
                </div>
              </motion.div>
            ) : null}

            {rightPanelCollapsed ? (
              <motion.nav
                initial={disableMotion || reduceMotion ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={workflowPanelTransition}
                className="pointer-events-auto absolute right-0 flex flex-col items-center gap-1 rounded-full border border-line-subtle bg-surface-raised p-1 shadow-[var(--theme-overlay-shadow)]"
                style={{
                  top: "calc(var(--senera-titlebar-height, 0px) + 12px)",
                  width: WORKFLOW_DOCK_CAPSULE_WIDTH,
                  willChange: "opacity, transform",
                }}
                aria-label={frontendMessage("workflow.dock.label")}
                data-workflow-dock-capsule
              >
                {WORKFLOW_DOCK_ITEMS.map(({ id, tooltip, Icon }) => (
                  <IconButton
                    key={id}
                    label={tooltip}
                    tooltip={tooltip}
                    tooltipSide="bottom"
                    tone="muted"
                    aria-expanded={false}
                    onClick={() => handleWorkflowDockTool(id)}
                    className="h-8 w-8 rounded-full"
                    data-workflow-dock-toggle={id === "execution" ? "" : undefined}
                    data-workflow-dock-tool={id}
                  >
                    <Icon className="h-4 w-4" />
                  </IconButton>
                ))}
              </motion.nav>
            ) : null}
          </motion.div>
        </>
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
          title={frontendMessage(
            workflowDockTool === "execution" ? "workflow.dock.execution" : "workflow.dock.terminal",
          )}
          widthClassName={WORKFLOW_DRAWER_WIDTH}
        >
          {renderWorkflowDockSurface("drawer", workflowDrawer)}
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
