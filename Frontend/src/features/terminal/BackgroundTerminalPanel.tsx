import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Plus, SquareTerminal } from "lucide-react";
import type { ExecutionResourceSnapshotData } from "../../api/eventTypes";
import type { ExecutionResourceOutputBuffer } from "../../app/useExecutionResourceCommands";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  isTerminalState,
  readTerminalXtermTheme,
  supportsTerminalCapability,
  TerminalSurfaceStyle,
} from "./terminalPresentation";
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
  const terminalSizingHostRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const latestResourceIdRef = useRef<string>();
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

  const runSearch = (direction: SearchRequest["direction"]): void => {
    const query = searchQuery.trim();
    if (!query) return;
    setSearchRequest((current) => ({ query, direction, nonce: (current?.nonce ?? 0) + 1 }));
  };

  const startTerminal = (): void => {
    const dimensions = measureTerminalDimensions(terminalSizingHostRef.current);
    if (dimensions) props.onStartTerminal(dimensions);
    else props.onStartTerminal();
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--terminal-canvas)]"
      style={TerminalSurfaceStyle}
      role="region"
      aria-label={frontendMessage("terminal.panel.title")}
      data-terminal-panel
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
      <div ref={terminalSizingHostRef} className="relative min-h-0 flex-1 overflow-hidden">
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
            <TerminalViewport
              key={selected.resourceId}
              resource={selected}
              output={props.outputs[selected.resourceId]?.text ?? ""}
              searchRequest={searchRequest}
              onWrite={props.onWrite}
              onResize={props.onResize}
              onSearchOpen={() => setSearchOpen(true)}
            />
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
                {frontendMessage("terminal.resource.create")}
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
  resource,
  output,
  searchRequest,
  onWrite,
  onResize,
  onSearchOpen,
}: {
  resource: ExecutionResourceSnapshotData;
  output: string;
  searchRequest?: SearchRequest;
  onWrite: (resourceId: string, input: string) => void;
  onResize: (resourceId: string, columns: number, rows: number) => void;
  onSearchOpen: () => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal>();
  const searchRef = useRef<SearchAddon>();
  const outputRef = useRef("");
  const inputEnabledRef = useRef(false);
  const resizeEnabledRef = useRef(false);
  const onWriteRef = useRef(onWrite);
  const onResizeRef = useRef(onResize);
  const onSearchOpenRef = useRef(onSearchOpen);
  const initialDimensionsRef = useRef({
    columns: resource.terminal?.columns,
    rows: resource.terminal?.rows,
  });
  const lastDimensionsRef = useRef<{ columns: number; rows: number }>();
  onWriteRef.current = onWrite;
  onResizeRef.current = onResize;
  onSearchOpenRef.current = onSearchOpen;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      ...createTerminalOptions(container),
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
    if ("WebGL2RenderingContext" in window) {
      let webgl: WebglAddon | undefined;
      try {
        webgl = new WebglAddon();
        terminal.loadAddon(webgl);
        const activeWebgl = webgl;
        activeWebgl.onContextLoss(() => activeWebgl.dispose());
      } catch {
        webgl?.dispose();
        // Canvas renderer remains active when WebGL initialization fails.
      }
    }
    terminalRef.current = terminal;
    searchRef.current = search;

    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = readTerminalXtermTheme(container);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-color-scheme", "data-accent-color"],
    });

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
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => fit.fit());
    });
    observer.observe(container);
    const initialFitFrame = requestAnimationFrame(() => fit.fit());

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(initialFitFrame);
      window.clearTimeout(resizeTimer);
      input.dispose();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = undefined;
      searchRef.current = undefined;
      outputRef.current = "";
    };
  }, [resource.resourceId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    inputEnabledRef.current =
      supportsTerminalCapability(resource, "interactive-input") && !isTerminalState(resource.state);
    resizeEnabledRef.current = supportsTerminalCapability(resource, "resize") && !isTerminalState(resource.state);
    terminal.options.disableStdin = !inputEnabledRef.current;
    terminal.options.cursorBlink = inputEnabledRef.current;
    if (inputEnabledRef.current) terminal.focus();
    else terminal.blur();
  }, [resource, resource.state]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const previous = outputRef.current;
    if (output.startsWith(previous)) terminal.write(output.slice(previous.length));
    else {
      terminal.reset();
      terminal.write(output);
    }
    outputRef.current = output;
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
      className="absolute inset-0 overflow-hidden bg-[var(--terminal-canvas)] px-3 py-2.5 [&_.xterm]:h-full [&_.xterm-viewport]:!bg-[var(--terminal-canvas)]"
      data-terminal-viewport
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
    dispose: flush,
  };
}

function createTerminalOptions(container: HTMLElement): ConstructorParameters<typeof Terminal>[0] {
  return {
    allowProposedApi: true,
    allowTransparency: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "bar",
    disableStdin: false,
    fontFamily: "Cascadia Mono, JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12.5,
    lineHeight: 1.34,
    scrollback: 10_000,
    theme: readTerminalXtermTheme(container),
  };
}

function measureTerminalDimensions(host: HTMLDivElement | null): { columns: number; rows: number } | undefined {
  if (!host || host.clientWidth <= 0 || host.clientHeight <= 0) return undefined;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;inset:0;visibility:hidden;pointer-events:none;padding:10px 12px;overflow:hidden";
  host.append(probe);
  const terminal = new Terminal({ ...createTerminalOptions(probe), disableStdin: true, cursorBlink: false });
  const fit = new FitAddon();
  try {
    terminal.loadAddon(fit);
    terminal.open(probe);
    const dimensions = fit.proposeDimensions();
    return dimensions ? { columns: dimensions.cols, rows: dimensions.rows } : undefined;
  } finally {
    terminal.dispose();
    probe.remove();
  }
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
