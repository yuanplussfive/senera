import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchResultChangeEvent } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type IDisposable } from "@xterm/xterm";
import type { ExecutionResourceSnapshotData } from "../../api/eventTypes";
import { openExternalUrl } from "../../app/desktopBridge";
import type { ExecutionResourceOutputStore } from "../../app/executionResourceOutputStore";
import { TerminalOutputWriter } from "./TerminalOutputWriter";
import { TerminalRenderer, type TerminalRendererState } from "./TerminalRenderer";
import { createTerminalInputScheduler } from "./terminalInput";
import { TerminalTextOptions, type TerminalTheme } from "./terminalTheme";

export interface TerminalActivity {
  active: boolean;
  inputEnabled: boolean;
  resizeEnabled: boolean;
}

export interface TerminalRuntimeOptions {
  container: HTMLElement;
  resourceId: string;
  kind: ExecutionResourceSnapshotData["kind"];
  outputStore: ExecutionResourceOutputStore;
  dimensions?: { columns: number; rows: number };
  activity: TerminalActivity;
  theme: TerminalTheme;
  onWrite: (data: string) => void;
  onResize: (columns: number, rows: number) => void;
  onSearchOpen: () => void;
  onSearchResult: (result: ISearchResultChangeEvent | undefined) => void;
  onRendererChange: (state: TerminalRendererState) => void;
}

export function createTerminalRuntime(options: TerminalRuntimeOptions) {
  const terminal = new Terminal({
    ...TerminalTextOptions,
    theme: options.theme,
    cols: options.dimensions?.columns,
    rows: options.dimensions?.rows,
    allowProposedApi: true,
    allowTransparency: false,
    convertEol: options.kind === "process",
    cursorStyle: "bar",
    disableStdin: !options.activity.inputEnabled,
    cursorBlink: options.activity.active && options.activity.inputEnabled,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  const writer = new TerminalOutputWriter(terminal);
  const input = createTerminalInputScheduler(options.onWrite);
  const disposables: IDisposable[] = [];
  let activity = options.activity;
  let theme = options.theme;
  let lastDimensions = options.dimensions;
  let renderer: TerminalRenderer | undefined;
  let observer: ResizeObserver | undefined;
  let disposed = false;
  let fitFrame = 0;
  let unsubscribeOutput: (() => void) | undefined;

  const syncDimensions = (): void => {
    if (!activity.active || !activity.resizeEnabled || disposed) return;
    const { cols: columns, rows } = terminal;
    if (lastDimensions?.columns === columns && lastDimensions.rows === rows) return;
    lastDimensions = { columns, rows };
    options.onResize(columns, rows);
  };
  const scheduleFit = (): void => {
    if (!activity.active || disposed || fitFrame) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      if (!activity.active || disposed || options.container.clientWidth === 0 || options.container.clientHeight === 0)
        return;
      fit.fit();
      syncDimensions();
    });
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(fitFrame);
    observer?.disconnect();
    document.fonts?.removeEventListener("loadingdone", scheduleFit);
    unsubscribeOutput?.();
    input.discard();
    writer.dispose();
    for (const disposable of disposables) disposable.dispose();
    renderer?.dispose();
    terminal.dispose();
  };

  try {
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    const unicode = new Unicode11Addon();
    terminal.loadAddon(unicode);
    terminal.unicode.activeVersion = "11";
    terminal.loadAddon(new WebLinksAddon((_event, uri) => void openExternalUrl(uri)));
    terminal.open(options.container);
    renderer = new TerminalRenderer(terminal, options.onRendererChange);
    renderer.setActive(activity.active);
    terminal.attachCustomKeyEventHandler((event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return true;
      if (event.type === "keydown") options.onSearchOpen();
      return false;
    });
    disposables.push(
      terminal.onData((data) => {
        if (activity.inputEnabled) input.push(data);
      }),
      terminal.onResize(syncDimensions),
      search.onDidChangeResults(options.onSearchResult),
    );
    unsubscribeOutput = options.outputStore.subscribe(options.resourceId, (update) => writer.accept(update));
    writer.restore(options.outputStore.read(options.resourceId));
    observer = new ResizeObserver(scheduleFit);
    observer.observe(options.container);
    document.fonts?.addEventListener("loadingdone", scheduleFit);
    void document.fonts?.ready.then(scheduleFit);
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    setTheme(next: TerminalTheme): void {
      theme = next;
      terminal.options.theme = next;
      terminal.refresh(0, terminal.rows - 1);
    },
    setActivity(next: TerminalActivity): void {
      activity = next;
      terminal.options.disableStdin = !next.inputEnabled;
      terminal.options.cursorBlink = next.active && next.inputEnabled;
      if (!next.inputEnabled) input.discard();
      if (!next.active || !next.inputEnabled) terminal.blur();
      renderer?.setActive(next.active);
      scheduleFit();
    },
    search(query: string, direction: "next" | "previous", incremental = false): void {
      if (!query.trim()) {
        search.clearDecorations();
        options.onSearchResult(undefined);
        return;
      }
      const searchOptions = {
        caseSensitive: false,
        incremental,
        wholeWord: false,
        decorations: {
          matchBackground: theme.selectionBackground,
          matchOverviewRuler: theme.selectionBackground,
          activeMatchBackground: theme.selectionBackground,
          activeMatchColorOverviewRuler: theme.foreground,
        },
      };
      if (direction === "next") search.findNext(query, searchOptions);
      else search.findPrevious(query, searchOptions);
    },
    focus(): void {
      if (activity.active && activity.inputEnabled) terminal.focus();
    },
    getSelection(): string {
      return terminal.getSelection();
    },
    dispose,
  };
}

export type TerminalRuntime = ReturnType<typeof createTerminalRuntime>;
