import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionResourceSnapshotData } from "../../api/eventTypes";
import type { ExecutionResourceOutputBuffer } from "../../app/useExecutionResourceCommands";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  isTerminalState,
  supportsTerminalCapability,
  TerminalSurfaceStyle,
  TerminalXtermTheme,
} from "./terminalPresentation";
import { TerminalSearchOverlay, TerminalStatusBar, TerminalTitlebar } from "./TerminalWorkbenchChrome";
import { TerminalWindowFrame } from "./TerminalWindowFrame";

export interface BackgroundTerminalPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resources: ExecutionResourceSnapshotData[];
  outputs: Readonly<Record<string, ExecutionResourceOutputBuffer>>;
  onRefresh: () => void;
  onWrite: (resourceId: string, input: string) => void;
  onResize: (resourceId: string, columns: number, rows: number) => void;
  onSignal: (resourceId: string, signal: "interrupt" | "terminate" | "kill") => void;
  onStopAll: () => void;
}

interface SearchRequest {
  query: string;
  direction: "next" | "previous";
  nonce: number;
}

export function BackgroundTerminalPanel(props: BackgroundTerminalPanelProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRequest, setSearchRequest] = useState<SearchRequest>();
  const orderedResources = useMemo(
    () => [...props.resources].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [props.resources],
  );
  const selected = orderedResources.find((resource) => resource.resourceId === selectedId) ?? orderedResources[0];

  useEffect(() => {
    if (!selected || selected.resourceId === selectedId) return;
    setSelectedId(selected.resourceId);
  }, [selected, selectedId]);

  const runSearch = (direction: SearchRequest["direction"]): void => {
    const query = searchQuery.trim();
    if (!query) return;
    setSearchRequest((current) => ({ query, direction, nonce: (current?.nonce ?? 0) + 1 }));
  };

  return (
    <TerminalWindowFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      resourceCount={orderedResources.length}
      titlebarContent={
        <TerminalTitlebar
          resources={orderedResources}
          selected={selected}
          searchOpen={searchOpen}
          onSelect={setSelectedId}
          onSearchOpenChange={setSearchOpen}
          onRefresh={props.onRefresh}
          onSignal={props.onSignal}
          onStopAll={props.onStopAll}
        />
      }
    >
      <div className="flex h-full min-h-0 flex-col bg-[var(--terminal-canvas)]" style={TerminalSurfaceStyle}>
        {selected ? (
          <>
            <div className="relative min-h-0 flex-1 overflow-hidden">
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
            </div>
            <TerminalStatusBar resource={selected} />
          </>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-[13px] text-[var(--terminal-muted)]">
            {frontendMessage("terminal.empty")}
          </div>
        )}
      </div>
    </TerminalWindowFrame>
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
  const lastDimensionsRef = useRef<{ columns: number; rows: number }>();
  onWriteRef.current = onWrite;
  onResizeRef.current = onResize;
  onSearchOpenRef.current = onSearchOpen;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      disableStdin: false,
      fontFamily: "Cascadia Mono, JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.28,
      scrollback: 10_000,
      theme: TerminalXtermTheme,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, "_blank", "noopener,noreferrer")));
    terminal.open(container);
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

    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
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
      className="absolute inset-0 overflow-hidden bg-[var(--terminal-canvas)] p-2.5 [&_.xterm]:h-full [&_.xterm-viewport]:!bg-[var(--terminal-canvas)]"
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

const C0_CONTROL_CHARACTER_LIMIT = 0x1f;
const DELETE_CONTROL_CHARACTER = 0x7f;

function containsTerminalControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= C0_CONTROL_CHARACTER_LIMIT || codeUnit === DELETE_CONTROL_CHARACTER) return true;
  }
  return false;
}
