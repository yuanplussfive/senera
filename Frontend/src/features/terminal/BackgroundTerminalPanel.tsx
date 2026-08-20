import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Plus, SquareTerminal } from "lucide-react";
import type { ExecutionResourceSnapshotData } from "../../api/eventTypes";
import type { ExecutionResourceOutputBuffer } from "../../app/useExecutionResourceCommands";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { cn } from "../../lib/util";
import { isTerminalState, supportsTerminalCapability, TerminalXtermTheme } from "./terminalPresentation";
import { TerminalSurfaceStyle } from "./terminalTheme";
import { TerminalSearchOverlay, TerminalStatusBar, TerminalTitlebar } from "./TerminalWorkbenchChrome";

export interface BackgroundTerminalPanelProps {
  resources: ExecutionResourceSnapshotData[];
  outputs: Readonly<Record<string, ExecutionResourceOutputBuffer>>;
  onStartTerminal: (options?: { cwd?: string; columns?: number; rows?: number }) => void;
  onRefresh: () => void;
  onWrite: (resourceId: string, input: string) => void;
  onResize: (resourceId: string, columns: number, rows: number) => void;
  onSignal: (resourceId: string, signal: "interrupt" | "terminate" | "kill") => void;
  onClose: (resourceId: string) => void;
  onStopAll: () => void;
}

interface SearchRequest {
  query: string;
  direction: "next" | "previous";
  nonce: number;
}

export function BackgroundTerminalPanel(props: BackgroundTerminalPanelProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>();
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set());
  const latestResourceIdRef = useRef<string | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRequest, setSearchRequest] = useState<SearchRequest>();
  const orderedResources = useMemo(
    () =>
      props.resources
        .filter((resource) => resource.kind === "terminal" && resource.terminal)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [props.resources],
  );
  const selected = orderedResources.find((resource) => resource.resourceId === selectedId) ?? orderedResources[0];
  const selectedResourceId = selected?.resourceId;
  const mountedResources = orderedResources.filter(
    (resource) => resource.resourceId === selectedResourceId || visitedIds.has(resource.resourceId),
  );

  useEffect(() => {
    const latestId = orderedResources[0]?.resourceId;
    const previousLatestId = latestResourceIdRef.current;
    latestResourceIdRef.current = latestId;
    if (!latestId) {
      if (selectedId) setSelectedId(undefined);
      return;
    }
    const selectedExists = orderedResources.some((resource) => resource.resourceId === selectedId);
    if (!selectedExists || (previousLatestId && previousLatestId !== latestId)) setSelectedId(latestId);
  }, [orderedResources, selectedId]);

  useEffect(() => {
    setVisitedIds((current) => {
      const availableIds = new Set(orderedResources.map((resource) => resource.resourceId));
      const next = new Set([...current].filter((resourceId) => availableIds.has(resourceId)));
      if (selectedResourceId) next.add(selectedResourceId);
      if (setsEqual(current, next)) return current;
      return next;
    });
  }, [orderedResources, selectedResourceId]);

  const runSearch = (direction: SearchRequest["direction"]): void => {
    const query = searchQuery.trim();
    if (!query) return;
    setSearchRequest((current) => ({ query, direction, nonce: (current?.nonce ?? 0) + 1 }));
  };

  const startTerminal = (): void => {
    const terminal = selected?.terminal;
    if (terminal) props.onStartTerminal({ columns: terminal.columns, rows: terminal.rows });
    else props.onStartTerminal();
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--terminal-canvas)]"
      style={TerminalSurfaceStyle}
      role="region"
      aria-label={frontendMessage("terminal.panel.title")}
      data-terminal-panel
      data-terminal-theme="fixed-dark"
      data-terminal-palette="windows"
    >
      <div
        className="h-10 shrink-0 border-b border-[var(--terminal-separator)] bg-[var(--terminal-chrome)] px-1"
        data-terminal-titlebar
      >
        <TerminalTitlebar
          resources={orderedResources}
          selected={selected}
          searchOpen={searchOpen}
          onStartTerminal={startTerminal}
          onSelect={setSelectedId}
          onSearchOpenChange={setSearchOpen}
          onRefresh={props.onRefresh}
          onSignal={props.onSignal}
          onClose={props.onClose}
          onStopAll={props.onStopAll}
        />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {selected ? (
          <>
            {searchOpen ? (
              <TerminalSearchOverlay
                query={searchQuery}
                onQueryChange={setSearchQuery}
                onRunSearch={runSearch}
                onClose={() => setSearchOpen(false)}
              />
            ) : null}
            {mountedResources.map((resource) => {
              const active = resource.resourceId === selected.resourceId;
              return (
                <TerminalViewport
                  key={resource.resourceId}
                  active={active}
                  resource={resource}
                  output={props.outputs[resource.resourceId]}
                  searchRequest={active ? searchRequest : undefined}
                  onWrite={props.onWrite}
                  onResize={props.onResize}
                  onSearchOpen={() => setSearchOpen(true)}
                />
              );
            })}
          </>
        ) : (
          <div className="grid h-full min-h-0 place-items-center px-5 text-center text-[12px] text-[var(--terminal-muted)]">
            <div className="flex flex-col items-center gap-2.5">
              <SquareTerminal className="h-5 w-5 text-[var(--terminal-subtle)]" strokeWidth={1.5} aria-hidden="true" />
              <span className="text-[var(--terminal-foreground)]">{frontendMessage("terminal.empty")}</span>
              <button
                type="button"
                onClick={startTerminal}
                className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-[11px] text-[var(--terminal-muted)] transition-colors hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--terminal-accent)]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {frontendFeatureMessage("terminal.resource.create")}
              </button>
            </div>
          </div>
        )}
      </div>
      {selected ? <TerminalStatusBar resource={selected} /> : null}
    </section>
  );
}

const TerminalViewport = memo(function TerminalViewport({
  active,
  resource,
  output,
  searchRequest,
  onWrite,
  onResize,
  onSearchOpen,
}: {
  active: boolean;
  resource: ExecutionResourceSnapshotData;
  output?: ExecutionResourceOutputBuffer;
  searchRequest?: SearchRequest;
  onWrite: (resourceId: string, input: string) => void;
  onResize: (resourceId: string, columns: number, rows: number) => void;
  onSearchOpen: () => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const searchRef = useRef<SearchAddon | undefined>(undefined);
  const renderedOutputRef = useRef<{ cursor: number; generation: number } | undefined>(undefined);
  const activeRef = useRef(active);
  const inputEnabledRef = useRef(false);
  const resizeEnabledRef = useRef(false);
  const onWriteRef = useRef(onWrite);
  const onResizeRef = useRef(onResize);
  const onSearchOpenRef = useRef(onSearchOpen);
  const initialDimensionsRef = useRef({
    columns: resource.terminal?.columns,
    rows: resource.terminal?.rows,
  });
  const lastDimensionsRef = useRef<{ columns: number; rows: number } | undefined>(undefined);
  onWriteRef.current = onWrite;
  onResizeRef.current = onResize;
  onSearchOpenRef.current = onSearchOpen;
  activeRef.current = active;
  const inputEnabled =
    active && supportsTerminalCapability(resource, "interactive-input") && !isTerminalState(resource.state);
  const resizeEnabled = active && supportsTerminalCapability(resource, "resize") && !isTerminalState(resource.state);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      ...createTerminalOptions(),
      cols: initialDimensionsRef.current.columns,
      rows: initialDimensionsRef.current.rows,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, "_blank", "noopener,noreferrer")));
    terminal.open(container);
    fit.fit();
    terminal.attachCustomKeyEventHandler((event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return true;
      if (event.type === "keydown") onSearchOpenRef.current();
      return false;
    });
    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;

    const input = createTerminalInputScheduler((value) => onWriteRef.current(resource.resourceId, value));
    const inputDisposable = terminal.onData((data) => {
      if (inputEnabledRef.current) input.push(data);
    });
    let resizeTimer: number | undefined;
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (!resizeEnabledRef.current) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const previous = lastDimensionsRef.current;
        if (previous?.columns === cols && previous.rows === rows) return;
        lastDimensionsRef.current = { columns: cols, rows };
        onResizeRef.current(resource.resourceId, cols, rows);
      }, 50);
    });
    let animationFrame = 0;
    const observer = new ResizeObserver(() => {
      if (!activeRef.current) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => fit.fit());
    });
    observer.observe(container);
    const initialFitFrame = requestAnimationFrame(() => fit.fit());

    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(initialFitFrame);
      window.clearTimeout(resizeTimer);
      input.dispose();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = undefined;
      fitRef.current = undefined;
      searchRef.current = undefined;
      renderedOutputRef.current = undefined;
    };
  }, [resource.resourceId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    inputEnabledRef.current = inputEnabled;
    resizeEnabledRef.current = resizeEnabled;
    terminal.options.disableStdin = !inputEnabledRef.current;
    terminal.options.cursorBlink = inputEnabledRef.current;
    if (!active) {
      terminal.blur();
      return;
    }
    fitRef.current?.fit();
    // Opening a terminal is a resource update, not an intent to type into it.
    // xterm handles focus when the user clicks its viewport; lifecycle changes
    // must leave the chat composer (or the current control) untouched.
    if (!inputEnabled) terminal.blur();
  }, [active, inputEnabled, resizeEnabled]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const rendered = renderedOutputRef.current;
    if (!rendered) {
      if (output?.text) terminal.write(output.text);
      renderedOutputRef.current = { cursor: output?.cursor ?? 0, generation: output?.generation ?? 0 };
      return;
    }
    if (!output || output.cursor <= rendered.cursor) return;
    if (output.generation !== rendered.generation) {
      terminal.reset();
      if (output.text) terminal.write(output.text);
    } else {
      const appended = output.chunks
        .filter((chunk) => chunk.cursor > rendered.cursor)
        .map((chunk) => chunk.text)
        .join("");
      if (appended) terminal.write(appended);
    }
    renderedOutputRef.current = { cursor: output.cursor, generation: output.generation };
  }, [output]);

  useEffect(() => {
    if (!searchRequest) return;
    const options = { caseSensitive: false, incremental: true, wholeWord: false };
    if (searchRequest.direction === "next") searchRef.current?.findNext(searchRequest.query, options);
    else searchRef.current?.findPrevious(searchRequest.query, options);
  }, [searchRequest]);

  return (
    <div
      ref={containerRef}
      id={`terminal-panel-${resource.resourceId}`}
      role="tabpanel"
      aria-labelledby={`terminal-tab-${resource.resourceId}`}
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 overflow-hidden bg-[var(--terminal-canvas)] px-3 py-2.5 [&_.xterm]:h-full [&_.xterm-viewport]:!bg-[var(--terminal-canvas)]",
        active ? "visible z-10" : "invisible z-0 pointer-events-none",
      )}
      data-terminal-viewport
      data-terminal-active={active ? "true" : "false"}
      data-terminal-input-enabled={supportsTerminalCapability(resource, "interactive-input") ? "true" : "false"}
      data-terminal-purpose={resource.presentation?.purpose ?? "unspecified"}
    />
  );
});

function createTerminalInputScheduler(send: (input: string) => void): { push(input: string): void; dispose(): void } {
  let buffered = "";
  let animationFrame = 0;
  const flush = (): void => {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (!buffered) return;
    const value = buffered;
    buffered = "";
    send(value);
  };
  return {
    push: (input) => {
      if (containsTerminalControlCharacter(input)) {
        flush();
        send(input);
        return;
      }
      buffered += input;
      if (!animationFrame) animationFrame = requestAnimationFrame(flush);
    },
    dispose: () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      buffered = "";
    },
  };
}

function createTerminalOptions(): ConstructorParameters<typeof Terminal>[0] {
  return {
    allowProposedApi: true,
    allowTransparency: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "bar",
    disableStdin: false,
    fontFamily:
      '"Cascadia Mono", "JetBrains Mono", "Segoe UI Emoji", "Noto Color Emoji", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12.5,
    lineHeight: 1.34,
    scrollback: 10_000,
    theme: TerminalXtermTheme,
  };
}

const C0_CONTROL_CHARACTER_LIMIT = 0x1f;
const DELETE_CONTROL_CHARACTER = 0x7f;

function containsTerminalControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= C0_CONTROL_CHARACTER_LIMIT || codeUnit === DELETE_CONTROL_CHARACTER) return true;
  }
  return false;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}
