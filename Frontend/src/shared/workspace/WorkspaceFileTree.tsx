import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTreeBatchOperation } from "@pierre/trees";
import {
  listWorkspaceEntries,
  WorkspaceResourceClientError,
  type WorkspaceTreeEntry,
} from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { AppIcon, Button, Input, Spinner } from "../ui";
import { useAppearance } from "../theme/useAppearance";
import {
  isWorkspacePathWithin,
  joinWorkspacePath,
  normalizeWorkspacePath,
  parentWorkspacePath,
  relativeWorkspacePath,
} from "./WorkspaceResourcePath";
import { useWorkspaceFileChanges } from "./useWorkspaceFileChanges";

function treePath(entry: WorkspaceTreeEntry, rootPath: string): string {
  const relative = relativeWorkspacePath(rootPath, entry.path);
  if (relative === undefined) throw new Error(`Workspace tree entry escaped its declared root: ${entry.path}`);
  return entry.kind === "directory" ? `${relative}/` : relative;
}

function workspacePathFromTreePath(rootPath: string, treePath: string): string {
  const normalized = treePath.replace(/\/$/u, "");
  return normalized ? joinWorkspacePath(rootPath, normalized) : rootPath;
}

export function WorkspaceFileTree({
  httpBaseUrl,
  rootPath = ".",
  missingRootBehavior = "error",
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
  /** Directory exposed as the root of this tree; resource paths remain workspace-relative. */
  rootPath?: string;
  /** Whether an absent root is an error or the empty state for a directory that can be created later. */
  missingRootBehavior?: "error" | "empty";
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
  const resourceRoot = normalizeWorkspacePath(rootPath);
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
      if (row instanceof HTMLElement && activePath) {
        const selectedPath = workspacePathFromTreePath(resourceRoot, row.dataset.itemPath ?? "");
        if (selectedPath === activePath) callbacks.current.onSelect(activePath);
      }
    },
    [activePath, resourceRoot],
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
      const resourcePath = workspacePathFromTreePath(resourceRoot, path);
      if (item?.isDirectory()) callbacks.current.onDirectorySelect?.(resourcePath);
      else callbacks.current.onSelect(resourcePath);
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
      if (path && !searchModel.getItem(path)?.isDirectory()) {
        callbacks.current.onSelect(workspacePathFromTreePath(resourceRoot, path));
      }
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
  const [rootMissing, setRootMissing] = useState(false);

  const synchronizeDirectory = useCallback(
    (path: string, next: readonly WorkspaceTreeEntry[]): void => {
      const previous = directories.current.get(path) ?? [];
      const nextPaths = new Set(next.map((entry) => treePath(entry, resourceRoot)));
      const operations: FileTreeBatchOperation[] = [];
      for (const entry of previous) {
        if (nextPaths.has(treePath(entry, resourceRoot))) continue;
        operations.push({ type: "remove", path: treePath(entry, resourceRoot), recursive: entry.kind === "directory" });
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
        if (!model.getItem(treePath(entry, resourceRoot)))
          operations.push({ type: "add", path: treePath(entry, resourceRoot) });
      if (operations.length) model.batch(operations);
    },
    [model, resourceRoot],
  );

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
          synchronizeDirectory(path, next);
          failed.current.delete(path);
          if (path === resourceRoot) setRootMissing(false);
          setError(undefined);
        } catch (reason) {
          if (
            !controller.signal.aborted &&
            path === resourceRoot &&
            missingRootBehavior === "empty" &&
            reason instanceof WorkspaceResourceClientError &&
            reason.status === 404
          ) {
            synchronizeDirectory(path, []);
            failed.current.delete(path);
            setRootMissing(true);
            setError(undefined);
            return;
          }
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
    [entryFilter, httpBaseUrl, missingRootBehavior, resourceRoot, synchronizeDirectory],
  );

  useEffect(() => {
    setRootMissing(false);
  }, [resourceRoot]);

  useEffect(() => {
    // A resource endpoint is a complete workspace boundary. Its cached paths, in-flight requests,
    // and tree model cannot be carried into another endpoint even when directory names overlap.
    for (const request of requests.current.values()) request.abort();
    requests.current.clear();
    completions.current.clear();
    directories.current.clear();
    failed.current.clear();
    model.resetPaths([]);
    searchModel.resetPaths([]);
    setError(undefined);
    setLoading(false);
    setSearching(false);
    setResultCount(undefined);
  }, [httpBaseUrl, model, searchModel]);

  useEffect(() => {
    const loadExpanded = (): void => {
      for (const row of model.getVisibleRows(0, model.getVisibleCount())) {
        if (row.kind !== "directory" || !row.isExpanded) continue;
        const path = workspacePathFromTreePath(resourceRoot, row.path);
        if (!directories.current.has(path) && !requests.current.has(path) && !failed.current.has(path)) void load(path);
      }
    };
    const unsubscribe = model.subscribe(loadExpanded);
    loadExpanded();
    return unsubscribe;
  }, [load, model, resourceRoot]);
  useEffect(() => {
    for (const path of new Set([resourceRoot, ...directories.current.keys()])) void load(path, true);
    const pending = requests.current;
    return () => {
      for (const request of pending.values()) request.abort();
      pending.clear();
    };
  }, [load, resourceRoot, revision]);
  useEffect(() => {
    if (!activePath || !isWorkspacePathWithin(resourceRoot, activePath)) return;
    let active = true;
    void (async () => {
      const parents: string[] = [];
      let parent = parentWorkspacePath(activePath);
      while (parent !== resourceRoot && isWorkspacePathWithin(resourceRoot, parent)) {
        parents.unshift(parent);
        parent = parentWorkspacePath(parent);
      }
      if (!directories.current.has(resourceRoot)) await load(resourceRoot);
      for (const path of parents) {
        if (!active) return;
        const item = model.getItem(`${relativeWorkspacePath(resourceRoot, path)}/`);
        if (item && item.isDirectory() && "expand" in item) item.expand();
        if (!directories.current.has(path)) await load(path);
      }
      if (!active) return;
      syncingSelection.current = true;
      for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
      const treeActivePath = relativeWorkspacePath(resourceRoot, activePath);
      if (treeActivePath) {
        model.getItem(treeActivePath)?.select();
        model.scrollToPath(treeActivePath, { focus: false });
      }
      syncingSelection.current = false;
    })();
    return () => {
      active = false;
    };
  }, [activePath, load, model, resourceRoot]);
  useWorkspaceFileChanges(
    httpBaseUrl,
    (paths) => {
      setSearchRevision((value) => value + 1);
      const affected = paths.includes(resourceRoot)
        ? new Set([resourceRoot, ...directories.current.keys()])
        : new Set(paths.map(parentWorkspacePath).filter((path) => isWorkspacePathWithin(resourceRoot, path)));
      for (const path of affected) if (path === resourceRoot || directories.current.has(path)) void load(path, true);
    },
    resourceRoot,
    !rootMissing,
  );
  useEffect(() => {
    if (!query.trim()) {
      setSearching(false);
      setResultCount(undefined);
      return;
    }
    if (rootMissing) {
      searchModel.resetPaths([]);
      setSearching(false);
      setResultCount(0);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setResultCount(undefined);
    void listWorkspaceEntries(httpBaseUrl, resourceRoot, { query: query.trim(), signal: controller.signal }).then(
      (entries) => {
        if (controller.signal.aborted) return;
        const filtered = entries.filter((entry) => !entryFilter || entryFilter(entry));
        searchModel.resetPaths(filtered.map((entry) => treePath(entry, resourceRoot)));
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
  }, [entryFilter, httpBaseUrl, query, resourceRoot, rootMissing, searchModel, searchRevision]);

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
