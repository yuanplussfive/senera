import type { ISearchResultChangeEvent } from "@xterm/addon-search";
import { type IDockviewHeaderActionsProps, type IDockviewPanelProps } from "dockview-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { AppIcon, Button, MenuSelect, useClipboardCopy } from "../../shared/ui";
import type { BackgroundTerminalPanelProps } from "./BackgroundTerminalPanel";
import type { TerminalRendererState } from "./TerminalRenderer";
import { TerminalConnectionIcon, TerminalSearchOverlay, TerminalToolbar } from "./TerminalWorkbenchChrome";
import { TerminalOverlayStyle, type TerminalTheme } from "./terminalTheme";
import { isTerminalState, supportsTerminalCapability, terminalSelectionOptions } from "./terminalPresentation";
import { createTerminalRuntime, type TerminalRuntime } from "./terminalRuntime";

// A split must leave each terminal enough room for its tabs and actions.
export const TerminalMinimumPaneWidth = 240;
interface PaneControls {
  openSearch: () => void;
}
export function useTerminalDockControls() {
  return useRef(new Map<string, PaneControls>()).current;
}
export const TerminalDockContext = createContext<
  | (BackgroundTerminalPanelProps & {
      controls: Map<string, PaneControls>;
      renderers: Record<string, TerminalRendererState>;
      onRendererChange: (resourceId: string, state: TerminalRendererState) => void;
      theme: TerminalTheme;
    })
  | undefined
>(undefined);
function useTerminalDock() {
  const context = useContext(TerminalDockContext);
  if (!context) throw new Error("Terminal panels require their execution resource provider.");
  return context;
}

export function TerminalDockSelector(props: IDockviewHeaderActionsProps): JSX.Element {
  const dock = useTerminalDock();
  const resources = new Map(dock.resources.map((resource) => [resource.resourceId, resource]));
  const groupIds = new Set(props.panels.map((panel) => panel.id));
  const options = terminalSelectionOptions(dock.resources).filter((option) => groupIds.has(option.value));
  const selected = resources.get(props.activePanel?.id ?? "");
  return (
    <MenuSelect
      value={props.activePanel?.id ?? ""}
      options={options}
      placeholder={frontendMessage("terminal.resource.select")}
      ariaLabel={frontendMessage("terminal.resource.select")}
      leading={selected ? <TerminalConnectionIcon state={selected.state} /> : undefined}
      onChange={(id) => props.containerApi.getPanel(id)?.api.setActive()}
      contentStyle={TerminalOverlayStyle}
      contentClassName="terminal-selector-menu w-80"
      triggerClassName="terminal-selector h-7 w-auto max-w-64 rounded-md border-0 bg-[var(--terminal-hover)] px-2 text-[12px] text-[var(--terminal-foreground)] hover:bg-[var(--terminal-hover)] focus-visible:ring-[var(--terminal-muted)]"
      trailing={<AppIcon icon="chevron-down" size={13} className="shrink-0 text-[var(--terminal-muted)]" />}
      renderOptionIcon={(option) => {
        const resource = resources.get(option.value);
        return resource ? <TerminalConnectionIcon state={resource.state} /> : undefined;
      }}
      getOptionAction={(option) => {
        const resource = resources.get(option.value);
        if (!resource) return undefined;
        return {
          label: frontendFeatureMessage("terminal.resource.closeNamed", { title: option.label }),
          icon: <AppIcon icon="trash" size={14} />,
          destructive: true,
          onSelect: () => dock.onClose(resource.resourceId),
        };
      }}
      renderOption={(option) => {
        const resource = resources.get(option.value);
        return (
          <span className="flex min-w-0 flex-col gap-1 py-0.5">
            <span className="truncate text-[12px]">{option.label}</span>
            <span className="truncate font-mono text-[10px] text-[var(--terminal-subtle)]">{resource?.cwd}</span>
          </span>
        );
      }}
    />
  );
}

export function TerminalDockActions(props: IDockviewHeaderActionsProps): JSX.Element {
  const dock = useTerminalDock();
  const selected = dock.resources.find((resource) => resource.resourceId === props.activePanel?.id);
  const split = props.group.panels.length > 1 && props.group.api.width >= TerminalMinimumPaneWidth * 2;
  return (
    <TerminalToolbar
      {...dock}
      selected={selected}
      onStartTerminal={() =>
        selected?.terminal
          ? dock.onStartTerminal({ columns: selected.terminal.columns, rows: selected.terminal.rows })
          : dock.onStartTerminal()
      }
      onSearchOpen={() => selected && dock.controls.get(selected.resourceId)?.openSearch()}
      onSplit={split ? () => props.activePanel?.api.moveTo({ group: props.group, position: "right" }) : undefined}
      renderer={selected ? dock.renderers[selected.resourceId] : undefined}
      panelActions={props.containerApi.groups.at(-1)?.id === props.group.id ? dock.panelActions : undefined}
    />
  );
}

export function TerminalDockEmpty(): JSX.Element {
  const dock = useTerminalDock();
  return (
    <div className="grid h-full place-items-center text-center text-[12px] text-[var(--terminal-muted)]">
      <div className="flex flex-col items-center gap-3">
        <span>{frontendMessage("terminal.empty")}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dock.onStartTerminal()}
          className="h-7 gap-1.5 text-[var(--terminal-muted)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-foreground)]"
        >
          <AppIcon icon="plus" size={14} />
          {frontendFeatureMessage("terminal.resource.create")}
        </Button>
      </div>
    </div>
  );
}

export function TerminalDockPane({ api }: IDockviewPanelProps): JSX.Element | null {
  const dock = useTerminalDock();
  const resource = dock.resources.find((item) => item.resourceId === api.id);
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<TerminalRuntime | undefined>(undefined);
  const callbacks = useRef(dock);
  callbacks.current = dock;
  const [visible, setVisible] = useState(api.isVisible);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ISearchResultChangeEvent>();
  const { copyText } = useClipboardCopy();
  const inputEnabled = Boolean(
    resource && supportsTerminalCapability(resource, "interactive-input") && !isTerminalState(resource.state),
  );
  const resizeEnabled = Boolean(
    resource && supportsTerminalCapability(resource, "resize") && !isTerminalState(resource.state),
  );
  const hasResource = Boolean(resource);
  const active = visible && dock.active !== false;
  const runtimeState = useRef({ resource, inputEnabled, resizeEnabled });
  runtimeState.current = { resource, inputEnabled, resizeEnabled };

  useEffect(() => {
    setVisible(api.isVisible);
    const subscription = api.onDidVisibilityChange((event) => setVisible(event.isVisible));
    const controls: PaneControls = { openSearch: () => setSearchOpen(true) };
    dock.controls.set(api.id, controls);
    return () => {
      subscription.dispose();
      dock.controls.delete(api.id);
    };
  }, [api, dock.controls]);
  useEffect(() => {
    const { resource, inputEnabled, resizeEnabled } = runtimeState.current;
    if (!container.current || !resource) return;
    const active = api.isVisible && callbacks.current.active !== false;
    const terminal = createTerminalRuntime({
      container: container.current,
      resourceId: api.id,
      kind: resource.kind,
      outputStore: dock.outputStore,
      dimensions: resource.terminal,
      theme: callbacks.current.theme,
      activity: {
        active,
        inputEnabled: active && inputEnabled,
        resizeEnabled,
      },
      onWrite: (data) => callbacks.current.onWrite(api.id, data),
      onResize: (columns, rows) => callbacks.current.onResize(api.id, columns, rows),
      onSearchOpen: () => setSearchOpen(true),
      onSearchResult: setResult,
      onRendererChange: (state) => callbacks.current.onRendererChange(api.id, state),
    });
    runtime.current = terminal;
    return () => {
      terminal.dispose();
      runtime.current = undefined;
    };
    // Keep the terminal alive across metadata updates; activity is synchronized below.
  }, [api, dock.outputStore, hasResource]);

  useEffect(() => {
    runtime.current?.setActivity({ active, inputEnabled: active && inputEnabled, resizeEnabled });
  }, [active, inputEnabled, resizeEnabled]);
  useEffect(() => {
    runtime.current?.setTheme(dock.theme);
  }, [dock.theme]);
  useEffect(() => {
    runtime.current?.search(searchOpen ? query : "", "next", true);
  }, [searchOpen, query]);

  if (!resource) return null;
  return (
    <div className="relative flex h-full min-h-0 flex-col" data-terminal-renderer={dock.renderers[api.id]?.kind}>
      <div
        className="min-h-0 flex-1 overflow-hidden px-3 py-2"
        onContextMenuCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const selection = runtime.current?.getSelection();
          if (selection) void copyText(selection);
        }}
      >
        <div
          ref={container}
          className="terminal-viewport h-full w-full overflow-hidden"
          data-terminal-viewport
          data-terminal-active={active}
          data-terminal-input-enabled={active && inputEnabled}
          data-terminal-purpose={resource.presentation?.purpose ?? "unspecified"}
        />
      </div>
      {searchOpen ? (
        <TerminalSearchOverlay
          query={query}
          result={result}
          onQueryChange={setQuery}
          onRunSearch={(direction) => runtime.current?.search(query, direction)}
          onClose={() => {
            setSearchOpen(false);
            runtime.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
