import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTreeBatchOperation } from "@pierre/trees";
import { listWorkspaceEntries, type WorkspaceTreeEntry } from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { AppIcon, Button, Input, Spinner } from "../ui";
import { useAppearance } from "../theme/useAppearance";
import { parentWorkspacePath } from "./WorkspaceResourcePath";
import { useWorkspaceFileChanges } from "./useWorkspaceFileChanges";

const treePath = (entry: WorkspaceTreeEntry): string => (entry.kind === "directory" ? `${entry.path}/` : entry.path);

export function WorkspaceFileTree({
  httpBaseUrl,
  activePath,
  entryFilter,
  emptyMessage,
  onSelect,
  onDirectorySelect,
  initialExpansion = "closed",
  revision = 0,
  searchPlaceholder,
  filesLabel,
}: {
  httpBaseUrl: string;
  activePath?: string;
  entryFilter?: (entry: WorkspaceTreeEntry) => boolean;
  emptyMessage?: string;
  onSelect: (path: string) => void;
  onDirectorySelect?: (path: string) => void;
  initialExpansion?: "closed" | "open";
  revision?: number;
  searchPlaceholder?: string;
  filesLabel?: string;
}): JSX.Element {
  const { resolvedTheme } = useAppearance();
  const callbacks = useRef({ onSelect, onDirectorySelect });
  callbacks.current = { onSelect, onDirectorySelect };
  // Pierre reports selection changes; activating the current file is a separate user action.
  const activateCurrentFile = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      if (!activePath) return;
      const row = event.nativeEvent
        .composedPath()
        .find((node) => node instanceof HTMLElement && node.hasAttribute("data-item-path"));
      if (row instanceof HTMLElement && row.dataset.itemPath === activePath) callbacks.current.onSelect(activePath);
    },
    [activePath],
  );
  const syncingSelection = useRef(false);
  const { model } = useFileTree({
    paths: [],
    density: "compact",
    icons: { set: "complete", colored: true },
    initialExpansion,
    flattenEmptyDirectories: false,
    onSelectionChange: (paths) => {
      if (syncingSelection.current) return;
      const path = paths.at(-1);
      if (!path) return;
      const item = model.getItem(path);
      if (item?.isDirectory()) callbacks.current.onDirectorySelect?.(path.slice(0, -1));
      else callbacks.current.onSelect(path);
    },
  });
  const { model: searchModel } = useFileTree({
    paths: [],
    density: "compact",
    icons: { set: "complete", colored: true },
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    onSelectionChange: (paths) => {
      const path = paths.at(-1);
      if (path && !searchModel.getItem(path)?.isDirectory()) callbacks.current.onSelect(path);
    },
  });
  const directories = useRef(new Map<string, readonly WorkspaceTreeEntry[]>());
  const requests = useRef(new Map<string, AbortController>());
  const completions = useRef(new Map<string, Promise<void>>());
  const failed = useRef(new Set<string>());
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [searching, setSearching] = useState(false);
  const [resultCount, setResultCount] = useState<number>();

  const load = useCallback(
    (path: string, refresh = false): Promise<void> => {
      const pending = completions.current.get(path);
      if (pending && !refresh) return pending;
      requests.current.get(path)?.abort();
      const controller = new AbortController();
      requests.current.set(path, controller);
      setLoading(true);
      const completion = (async () => {
        try {
          const next = (await listWorkspaceEntries(httpBaseUrl, path, { signal: controller.signal })).filter(
            (entry) => !entryFilter || entryFilter(entry),
          );
          if (controller.signal.aborted) return;
          const previous = directories.current.get(path) ?? [];
          const nextPaths = new Set(next.map(treePath));
          const operations: FileTreeBatchOperation[] = [];
          for (const entry of previous) {
            if (nextPaths.has(treePath(entry))) continue;
            operations.push({ type: "remove", path: treePath(entry), recursive: entry.kind === "directory" });
            if (entry.kind === "directory") {
              for (const [pendingPath, request] of requests.current)
                if (pendingPath === entry.path || pendingPath.startsWith(`${entry.path}/`)) request.abort();
              for (const cachedPath of directories.current.keys())
                if (cachedPath === entry.path || cachedPath.startsWith(`${entry.path}/`))
                  directories.current.delete(cachedPath);
            }
          }
          directories.current.set(path, next);
          for (const entry of next)
            if (!model.getItem(treePath(entry))) operations.push({ type: "add", path: treePath(entry) });
          failed.current.delete(path);
          setError(undefined);
          if (operations.length) model.batch(operations);
        } catch (reason) {
          if (!controller.signal.aborted) {
            failed.current.add(path);
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        } finally {
          if (requests.current.get(path) === controller) {
            requests.current.delete(path);
            completions.current.delete(path);
          }
          setLoading(requests.current.size > 0);
        }
      })();
      completions.current.set(path, completion);
      return completion;
    },
    [entryFilter, httpBaseUrl, model],
  );

  useEffect(() => {
    const loadExpanded = (): void => {
      for (const row of model.getVisibleRows(0, model.getVisibleCount())) {
        if (row.kind !== "directory" || !row.isExpanded) continue;
        const path = row.path.slice(0, -1);
        if (!directories.current.has(path) && !requests.current.has(path) && !failed.current.has(path)) void load(path);
      }
    };
    const unsubscribe = model.subscribe(loadExpanded);
    loadExpanded();
    return unsubscribe;
  }, [load, model]);
  useEffect(() => {
    for (const path of new Set([".", ...directories.current.keys()])) void load(path, true);
    const pending = requests.current;
    return () => {
      for (const request of pending.values()) request.abort();
      pending.clear();
    };
  }, [load, revision]);
  useEffect(() => {
    if (!activePath) return;
    let active = true;
    void (async () => {
      const parents: string[] = [];
      let parent = parentWorkspacePath(activePath);
      while (parent !== ".") {
        parents.unshift(parent);
        parent = parentWorkspacePath(parent);
      }
      if (!directories.current.has(".")) await load(".");
      for (const path of parents) {
        if (!active) return;
        const item = model.getItem(path);
        if (item && item.isDirectory() && "expand" in item) item.expand();
        if (!directories.current.has(path)) await load(path);
      }
      if (!active) return;
      syncingSelection.current = true;
      for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
      model.getItem(activePath)?.select();
      model.scrollToPath(activePath, { focus: false });
      syncingSelection.current = false;
    })();
    return () => {
      active = false;
    };
  }, [activePath, load, model]);
  useWorkspaceFileChanges(httpBaseUrl, (paths) => {
    setSearchRevision((value) => value + 1);
    const affected = paths.includes(".")
      ? new Set([".", ...directories.current.keys()])
      : new Set(paths.map(parentWorkspacePath));
    for (const path of affected) if (path === "." || directories.current.has(path)) void load(path, true);
  });
  useEffect(() => {
    if (!query.trim()) {
      setSearching(false);
      setResultCount(undefined);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setResultCount(undefined);
    void listWorkspaceEntries(httpBaseUrl, ".", { query: query.trim(), signal: controller.signal }).then(
      (entries) => {
        if (controller.signal.aborted) return;
        const filtered = entries.filter((entry) => !entryFilter || entryFilter(entry));
        searchModel.resetPaths(filtered.map(treePath));
        setResultCount(filtered.length);
        setError(undefined);
        setSearching(false);
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setSearching(false);
      },
    );
    return () => controller.abort();
  }, [entryFilter, httpBaseUrl, query, searchModel, searchRevision]);

  const style = {
    height: "100%",
    colorScheme: resolvedTheme,
    "--trees-font-family-override": "var(--theme-ui-font-family)",
    "--trees-bg-override": "var(--surface-panel)",
    "--trees-fg-override": "var(--content-primary)",
    "--trees-fg-muted-override": "var(--content-muted)",
    "--trees-selected-bg-override": "var(--surface-selected)",
    "--trees-theme-list-hover-bg": "var(--surface-hover)",
    "--trees-border-color-override": "var(--line-subtle)",
    "--trees-focus-ring-color-override": "var(--accent-focus)",
  } as CSSProperties;
  return (
    <div className="flex h-full min-h-0 flex-col" data-workspace-file-tree aria-busy={loading || searching}>
      <div className="relative m-2 shrink-0">
        <AppIcon
          icon="search"
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-content-muted"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder ?? frontendMessage("workspace.searchFiles")}
          aria-label={searchPlaceholder ?? frontendMessage("workspace.searchFiles")}
          className="h-8 pl-8 pr-7 text-xs"
        />
        {loading || searching ? <Spinner size="sm" className="absolute right-2 top-2" /> : null}
      </div>
      {error ? (
        <div role="alert" className="px-3 text-xs text-danger">
          {error}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              for (const path of failed.current) void load(path);
              setSearchRevision((value) => value + 1);
            }}
          >
            {frontendMessage("resource.reload")}
          </Button>
        </div>
      ) : null}
      {resultCount === 0 && !searching ? (
        <p className="p-3 text-xs text-content-muted">{frontendMessage("resource.noFiles")}</p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden" hidden={Boolean(query.trim())}>
        {!loading && !error && model.getVisibleCount() === 0 ? (
          <p className="px-3 py-4 text-xs leading-5 text-content-muted">
            {emptyMessage ?? frontendMessage("resource.noFiles")}
          </p>
        ) : (
          <FileTree
            model={model}
            style={style}
            aria-label={filesLabel ?? frontendMessage("workspace.files")}
            onClick={activateCurrentFile}
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden" hidden={!query.trim() || searching}>
        <FileTree
          model={searchModel}
          style={style}
          aria-label={searchPlaceholder ?? frontendMessage("workspace.searchFiles")}
          onClick={activateCurrentFile}
        />
      </div>
    </div>
  );
}
