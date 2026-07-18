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
  type ReactElement,
  type ReactNode,
} from "react";
import { IconButton, Sheet, SheetContent } from "../shared/ui";
import { motionTimings, useMotionLevel } from "../shared/motion";
import { useStore } from "../store/sessionStore";
import type { ResponsiveMode } from "../shared/responsive";

const SESSION_PANEL_WIDTH = 246;
const SESSION_PANEL_COLLAPSED_WIDTH = 58;
const WORKFLOW_PANEL_WIDTH = 302;
const WORKFLOW_DOCK_CAPSULE_WIDTH = 40;
const WORKFLOW_DOCK_GUTTER_WIDTH = 46;
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
type WorkflowDockTool = "execution" | "terminal";

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

type WorkflowDockTab = {
  id: WorkflowDockTool;
  label: string;
  active: boolean;
  onSelect: () => void;
};

type WorkflowDockPanelProps = {
  dockTabs?: readonly WorkflowDockTab[];
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

export function readWorkflowPanelWidth(): number {
  return WORKFLOW_PANEL_WIDTH;
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
  const [workflowDockTool, setWorkflowDockTool] = useState<WorkflowDockTool>("execution");
  const renderPlan = readAppShellRenderPlan(responsiveMode);
  const workflowPanelWidth = readWorkflowPanelWidth();
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
  const handleWorkflowDockTool = (tool: WorkflowDockTool): void => {
    setWorkflowDockTool(tool);
    setRightPanelCollapsed(false);
  };

  const workflowDockTabs = WORKFLOW_DOCK_ITEMS.map(({ id, label }) => ({
    id,
    label,
    active: !rightPanelCollapsed && workflowDockTool === id,
    onSelect: () => handleWorkflowDockTool(id),
  }));

  const workflowPanelProps: WorkflowDockPanelProps = {
    dockTabs: workflowDockTabs,
  };

  const renderWorkflowPanel = (): ReactNode => {
    if (!isValidElement(workflowPanel) || typeof workflowPanel.type === "string") return workflowPanel;
    return cloneElement(workflowPanel as ReactElement<WorkflowDockPanelProps>, workflowPanelProps);
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
            className="pointer-events-none absolute inset-y-0 z-50"
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
                  "pointer-events-auto absolute inset-y-0 right-0 w-[302px] overflow-hidden",
                  renderPlan.workflowPanelLayout === "overlay"
                    ? "border-l border-line-subtle bg-surface-panel [box-shadow:var(--theme-overlay-shadow)]"
                    : "border-l border-line-subtle bg-surface-canvas [background-image:var(--theme-bg-image)]",
                )}
                style={{ willChange: "opacity, transform" }}
                data-workflow-panel-surface
                data-workflow-panel-layout={renderPlan.workflowPanelLayout}
              >
                <div
                  className="absolute inset-x-0 top-0 z-20 h-[var(--senera-titlebar-height,0px)]"
                  data-window-drag-region
                  data-workflow-window-controls-cover
                >
                  <IconButton
                    label={frontendMessage("workflow.panel.collapse")}
                    tone="muted"
                    tooltip={frontendMessage("workflow.panel.collapse")}
                    tooltipSide="left"
                    onClick={() => setRightPanelCollapsed(true)}
                    className="pointer-events-auto absolute right-2 top-2"
                    data-workflow-dock-collapse
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </IconButton>
                </div>
                <div className="h-full w-full" data-workflow-dock-content>
                  {workflowDockTool === "execution" ? (
                    renderWorkflowPanel()
                  ) : (
                    <WorkflowDockPlaceholder tool={workflowDockTool} dockTabs={workflowDockTabs} />
                  )}
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
          title={frontendMessage("workflow.panel.title")}
          widthClassName={WORKFLOW_DRAWER_WIDTH}
        >
          {workflowDrawer}
        </ResponsiveDrawer>
      ) : null}
    </div>
  );
}

function WorkflowDockPlaceholder({
  tool,
  dockTabs,
}: {
  tool: WorkflowDockTool;
  dockTabs: readonly WorkflowDockTab[];
}): JSX.Element {
  const item = WORKFLOW_DOCK_ITEMS.find(({ id }) => id === tool) ?? WORKFLOW_DOCK_ITEMS[0];
  const { Icon } = item;
  return (
    <aside className="flex h-full flex-col bg-transparent" data-workflow-dock-placeholder={tool}>
      <div className="flex h-[58px] items-center border-b border-line-subtle px-3 pr-12" data-workflow-dock-tabs>
        <WorkflowDockTabs tabs={dockTabs} />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center text-center" data-workflow-dock-empty-state>
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-line-subtle bg-accent-surface text-accent-content shadow-[var(--theme-node-shadow)]">
            <Icon className="h-4 w-4" />
          </span>
          <p className="mt-3 text-[12.5px] font-medium text-content-primary">{item.label}</p>
          <p className="mt-1 text-[11.5px] text-content-muted">{frontendMessage("workflow.dock.pending")}</p>
        </div>
      </div>
    </aside>
  );
}

function WorkflowDockTabs({ tabs }: { tabs: readonly WorkflowDockTab[] }): JSX.Element {
  return (
    <nav
      className="flex min-w-0 flex-1 items-center gap-0.5 rounded-full border border-line-subtle bg-surface-subtle p-1"
      aria-label={frontendMessage("workflow.dock.tabs")}
      data-workflow-dock-tabs-list
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={cn(
            "min-w-0 flex-1 rounded-full px-1.5 py-1.5 text-[12px] font-medium text-content-muted transition-[background-color,color,box-shadow] duration-150 hover:text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            tab.active && "bg-surface-raised text-content-primary shadow-sm",
            !tab.active && "hover:bg-surface-hover",
          )}
          aria-selected={tab.active}
          role="tab"
          onClick={tab.onSelect}
          data-workflow-dock-tab={tab.id}
        >
          {tab.label}
        </button>
      ))}
    </nav>
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
