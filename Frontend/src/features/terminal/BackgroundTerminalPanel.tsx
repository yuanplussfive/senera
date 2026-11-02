import { DockviewReact, type DockviewApi, type DockviewReadyEvent } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExecutionResourceSnapshotData } from "../../api/eventTypes";
import type { ExecutionResourceOutputStore } from "../../app/executionResourceOutputStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { createTerminalXtermTheme, TerminalSurfaceStyle } from "./terminalTheme";
import { useAppearance } from "../../shared/theme/useAppearance";
import {
  TerminalDockContext,
  TerminalDockPane,
  TerminalDockSelector,
  TerminalDockActions,
  TerminalDockEmpty,
  TerminalMinimumPaneWidth,
  useTerminalDockControls,
} from "./TerminalDockPane";
import { terminalTabLabel } from "./terminalPresentation";
import "./TerminalWorkbench.css";
import type { TerminalRendererState } from "./TerminalRenderer";

export interface BackgroundTerminalPanelProps {
  active?: boolean;
  panelActions?: ReactNode;
  resources: ExecutionResourceSnapshotData[];
  outputStore: ExecutionResourceOutputStore;
  onStartTerminal: (options?: { cwd?: string; columns?: number; rows?: number }) => void;
  onRefresh: () => void;
  onWrite: (resourceId: string, input: string) => void;
  onResize: (resourceId: string, columns: number, rows: number) => void;
  onSignal: (resourceId: string, signal: "interrupt" | "terminate" | "kill") => void;
  onClose: (resourceId: string) => void;
  onStopAll: () => void;
}

const components = { terminal: TerminalDockPane };
const terminalDockTheme = {
  name: "senera-terminal",
  className: "senera-terminal-dock",
  gap: 1,
};
const noTabContextMenu = () => [];

export function BackgroundTerminalPanel(props: BackgroundTerminalPanelProps): JSX.Element {
  const appearance = useAppearance();
  const theme = useMemo(() => createTerminalXtermTheme(appearance), [appearance]);
  const dockTheme = useMemo(
    () => ({ ...terminalDockTheme, colorScheme: appearance.resolvedTheme }),
    [appearance.resolvedTheme],
  );
  const [api, setApi] = useState<DockviewApi>();
  const container = useRef<HTMLElement>(null);
  const controls = useTerminalDockControls();
  const [renderers, setRenderers] = useState<Record<string, TerminalRendererState>>({});
  const onRendererChange = useCallback((resourceId: string, state: TerminalRendererState) => {
    setRenderers((current) => ({ ...current, [resourceId]: state }));
  }, []);
  const resources = useMemo(
    () =>
      props.resources
        .filter((resource) => Boolean(resource.terminal) || resource.presentation?.purpose === "background-process")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [props.resources],
  );
  const onReady = useCallback((event: DockviewReadyEvent) => setApi(event.api), []);

  useEffect(() => {
    if (!api) return;
    const available = new Set(resources.map((resource) => resource.resourceId));
    for (const panel of api.panels) {
      if (!available.has(panel.id)) api.removePanel(panel);
    }
    for (const resource of resources) {
      const panel = api.getPanel(resource.resourceId);
      const title = terminalTabLabel(resource);
      if (panel) {
        if (panel.title !== title) panel.api.setTitle(title);
      } else {
        api.addPanel({
          id: resource.resourceId,
          title,
          component: "terminal",
          renderer: "always",
          minimumWidth: TerminalMinimumPaneWidth,
          minimumHeight: 100,
          inactive: Boolean(api.activePanel) && resource.presentation?.purpose === "background-process",
        });
      }
    }
    setRenderers((current) =>
      Object.keys(current).some((id) => !available.has(id))
        ? Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id)))
        : current,
    );
  }, [api, resources]);

  useEffect(() => {
    if (!api || !container.current) return;
    const element = container.current;
    const resize = (): void => {
      const compact = element.clientWidth < TerminalMinimumPaneWidth * 2;
      api.updateOptions({ disableDnd: compact });
      if (!compact || api.groups.length < 2) return;
      const active = api.activePanel;
      const group = active?.group ?? api.groups[0];
      for (const panel of api.panels) {
        if (panel.group !== group) panel.api.moveTo({ group, position: "center", skipSetActive: true });
      }
      active?.api.setActive();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [api]);

  return (
    <TerminalDockContext.Provider value={{ ...props, resources, controls, renderers, onRendererChange, theme }}>
      <section
        ref={container}
        className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--terminal-canvas)]"
        style={TerminalSurfaceStyle}
        role="region"
        aria-label={frontendMessage("terminal.panel.title")}
        data-terminal-panel
        data-terminal-theme={appearance.resolvedTheme}
        data-terminal-palette="windows"
      >
        {resources.length === 0 ? (
          <div className="flex h-[34px] shrink-0 items-center justify-between bg-[var(--terminal-chrome)] pl-3">
            <span className="text-[12px] text-[var(--terminal-muted)]">{frontendMessage("terminal.panel.title")}</span>
            {props.panelActions}
          </div>
        ) : null}
        <DockviewReact
          className="min-h-0 flex-1"
          components={components}
          onReady={onReady}
          theme={dockTheme}
          defaultRenderer="always"
          singleTabMode="default"
          prefixHeaderActionsComponent={TerminalDockSelector}
          rightHeaderActionsComponent={TerminalDockActions}
          watermarkComponent={TerminalDockEmpty}
          disableFloatingGroups
          disableTabsOverflowList
          getTabContextMenuItems={noTabContextMenu}
        />
      </section>
    </TerminalDockContext.Provider>
  );
}
