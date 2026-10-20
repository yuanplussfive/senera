import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { DEFAULT_VIRTUAL_FILE_METRICS, VirtualizedFile, type FileContents, type ThemesType } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import {
  EditProvider,
  File,
  Virtualizer,
  WorkerPoolContext,
  useVirtualizer,
  useWorkerPool,
  type EditorFactory,
} from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import HighlightWorker from "@pierre/diffs/worker/worker.js?worker";
import scrollbarStyles from "../../styles/scrollbar.css?inline";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useAppearance } from "../theme/useAppearance";
import { StateView } from "../ui";

const themes: ThemesType = { light: "github-light", dark: "github-dark-dimmed" };
const poolOptions = {
  workerFactory: () => {
    const worker = new HighlightWorker();
    // The pool reports failures to the document surface; avoid a second uncaught window error.
    worker.addEventListener("error", (event) => event.preventDefault());
    return worker;
  },
  // Two workers share a cache for the current and previous document.
  poolSize: 2,
  totalASTLRUCacheSize: 2,
};
const highlighterOptions = { theme: themes, useTokenTransformer: true };
const createEditor: EditorFactory<undefined, undefined> = (type, options, key) => new Editor(type, options, key);
const metrics = { ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight: 22 };
type HighlightState =
  { status: "loading" } | { status: "ready"; pool: WorkerPoolManager } | { status: "error"; error: string };
const HighlightRuntimeContext = createContext<
  | {
      state: HighlightState;
      retry: () => void;
    }
  | undefined
>(undefined);

interface WorkspaceSourceProps {
  file: FileContents;
  editing: boolean;
  line?: number;
  column?: number;
  onChange: (value: string) => void;
}

export function WorkspaceSourceRuntime({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<HighlightState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let pool: WorkerPoolManager;
    setState({ status: "loading" });
    // Create resources only after React commits the preview, including suspended file-tree assets.
    try {
      pool = new WorkerPoolManager(poolOptions, highlighterOptions);
    } catch (error: unknown) {
      if (active) setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      return () => {
        active = false;
      };
    }
    void pool.initialize().then(
      () => {
        if (active) setState({ status: "ready", pool });
      },
      (error: unknown) => {
        if (active) setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      active = false;
      pool.terminate();
    };
  }, [revision]);
  return (
    <WorkerPoolContext.Provider value={state.status === "ready" ? state.pool : undefined}>
      <HighlightRuntimeContext.Provider value={{ state, retry: () => setRevision((value) => value + 1) }}>
        {children}
      </HighlightRuntimeContext.Provider>
    </WorkerPoolContext.Provider>
  );
}

export function WorkspaceSourceView(props: WorkspaceSourceProps): JSX.Element {
  const runtime = useContext(HighlightRuntimeContext);
  if (!runtime) throw new Error("WorkspaceSourceView requires WorkspaceSourceRuntime.");
  if (runtime.state.status === "loading") return <StateView status="loading" />;
  if (runtime.state.status === "error")
    return (
      <StateView
        status="error"
        title={frontendMessage("resource.loadFailed")}
        description={runtime.state.error}
        onRetry={runtime.retry}
      />
    );
  return <PreparedSource {...props} onRetry={runtime.retry} />;
}

function PreparedSource(props: WorkspaceSourceProps & { onRetry: () => void }): JSX.Element {
  const pool = useWorkerPool();
  const [preparation, setPreparation] = useState<{ file: FileContents; error?: string }>();
  useEffect(() => {
    let active = true;
    setPreparation(undefined);
    void (async () => {
      if (!pool) throw new Error("The file highlighter is not available.");
      await pool.primeFileHighlightCache(props.file);
      if (!pool.isWorkingPool()) throw new Error("The file highlighter worker could not start.");
    })().then(
      () => {
        if (active) setPreparation({ file: props.file });
      },
      (error: unknown) => {
        if (active) setPreparation({ file: props.file, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [pool, props.file]);

  if (preparation?.file !== props.file) return <StateView status="loading" />;
  if (preparation.error !== undefined)
    return (
      <StateView
        status="error"
        title={frontendMessage("resource.loadFailed")}
        description={preparation.error}
        onRetry={props.onRetry}
      />
    );

  return (
    <Virtualizer
      className="workspace-source-viewport min-h-0 min-w-0 flex-1 overflow-auto"
      contentClassName="min-w-full py-3"
    >
      <EditProvider createEditor={createEditor}>
        <WorkspaceCodeDocument {...props} />
      </EditProvider>
    </Virtualizer>
  );
}

function WorkspaceCodeDocument({ file, editing, line, column, onChange }: WorkspaceSourceProps): JSX.Element {
  const { resolvedTheme } = useAppearance();
  const virtualizer = useVirtualizer();
  const located = useRef<{ file: FileContents; line: number } | undefined>(undefined);
  const editorOptions = useMemo(() => {
    const position = { line: Math.max(0, (line ?? 1) - 1), character: Math.max(0, (column ?? 1) - 1) };
    return {
      ownsVerticalViewport: true,
      initialState: {
        type: "file" as const,
        editor: { selections: [{ start: position, end: position, direction: 0 as const }] },
      },
    };
  }, [line, column]);
  return (
    <File
      file={file}
      edit={editing}
      metrics={metrics}
      editorOptions={editorOptions}
      onEditChange={(event) => onChange(event.file.contents)}
      onEditComplete={() => "accept"}
      selectedLines={line ? { start: line, end: line } : undefined}
      options={{
        theme: themes,
        themeType: resolvedTheme,
        disableFileHeader: true,
        overflow: "scroll",
        useTokenTransformer: true,
        unsafeCSS: scrollbarStyles,
        onPostRender: (node, instance, phase) => {
          if (
            phase === "unmount" ||
            (located.current?.file === file && located.current.line === line) ||
            !line ||
            !virtualizer ||
            !(instance instanceof VirtualizedFile)
          )
            return;
          const position = instance.getLinePosition(line);
          if (!position) return;
          virtualizer.scrollTo({ top: virtualizer.getOffsetInScrollContainer(node) + position.top });
          located.current = { file, line };
        },
      }}
      style={
        {
          "--diffs-font-family": "var(--theme-mono-font-family)",
          "--diffs-font-size": "13px",
          "--diffs-line-height": `${metrics.lineHeight}px`,
          "--diffs-light-bg": "transparent",
          "--diffs-dark-bg": "transparent",
          "--diffs-light": "var(--content-primary)",
          "--diffs-dark": "var(--content-primary)",
        } as CSSProperties
      }
    />
  );
}
