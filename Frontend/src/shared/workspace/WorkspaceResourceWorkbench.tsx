import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceFileChanges } from "./useWorkspaceFileChanges";
import { toast } from "sonner";
import {
  createWorkspaceEntry,
  readWorkspaceResource,
  readWorkspaceResourceBlob,
  removeWorkspaceEntry,
  renameWorkspaceEntry,
  saveWorkspaceResource,
  type WorkspaceResourceData,
} from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { motionDurations } from "../../shared/motion";
import { ImageCanvasViewer } from "../media/ImageCanvasViewer";
import {
  AppIcon,
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  MenuSelect,
  StateView,
  Tooltip,
} from "../ui";
import { formatWorkspaceResourceLocation, type WorkspaceResourceLocator } from "./WorkspaceResourceLocator";
import { WorkspaceTextSurface } from "./WorkspaceTextSurface";
import { WorkspaceSourceRuntime } from "./WorkspaceSourceView";
import {
  describeWorkspaceText,
  type WorkspaceTextPresentation,
  type WorkspaceTextView,
} from "./WorkspaceTextPresentation";
import { WorkspaceResourceExplorer, type WorkspaceExplorerAction } from "./WorkspaceResourceExplorer";
import { joinWorkspacePath, parentWorkspacePath } from "./WorkspaceResourcePath";
import type { WorkspaceResourceController } from "./WorkspaceResourceProvider";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly resource: WorkspaceResourceData };

type SaveState = "idle" | "saving" | "saved" | "error";
interface WorkspaceResourceWorkbenchProps {
  readonly controller: WorkspaceResourceController;
  readonly locator: WorkspaceResourceLocator;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

export function WorkspaceResourceWorkbench(props: WorkspaceResourceWorkbenchProps): JSX.Element {
  return (
    <WorkspaceSourceRuntime>
      <WorkspaceResourceWorkbenchContent {...props} />
    </WorkspaceSourceRuntime>
  );
}

function WorkspaceResourceWorkbenchContent({
  controller,
  locator,
  onOpenChange,
  open,
}: WorkspaceResourceWorkbenchProps): JSX.Element {
  const [activePath, setActivePath] = useState(locator.path);
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const [treeRevision, setTreeRevision] = useState(0);
  const [explorerAction, setExplorerAction] = useState<WorkspaceExplorerAction>();
  const [explorerName, setExplorerName] = useState("");
  const [explorerParentPath, setExplorerParentPath] = useState(".");
  const [renameName, setRenameName] = useState("");
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [pendingExitEdit, setPendingExitEdit] = useState(false);
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [mobileExplorer, setMobileExplorer] = useState(false);
  const [selectedView, setSelectedView] = useState<{ path: string; view: WorkspaceTextView }>();

  useEffect(() => {
    setActivePath(locator.path);
  }, [locator.path]);

  const activeLocator =
    activePath === locator.path ? locator : { ...locator, path: activePath, line: undefined, column: undefined };

  useEffect(() => {
    const request = new AbortController();
    if (!activePath || activePath === ".") {
      setLoadState({ status: "empty" });
      return () => {
        request.abort();
      };
    }
    setLoadState({ status: "loading" });
    setEditing(false);
    setSaveState("idle");
    setCloseConfirmationOpen(false);
    void readWorkspaceResource(controller.httpBaseUrl, activePath, { signal: request.signal }).then(
      (resource) => {
        if (request.signal.aborted) return;
        setLoadState({ status: "ready", resource });
        setDraft(resource.content ?? "");
      },
      (error: unknown) => {
        if (!request.signal.aborted) {
          setLoadState({
            status: "error",
            message: error instanceof Error ? error.message : frontendMessage("resource.loadFailed"),
          });
        }
      },
    );
    return () => {
      request.abort();
    };
  }, [activePath, controller.httpBaseUrl, loadRevision]);

  const resource = loadState.status === "ready" ? loadState.resource : undefined;
  const presentation = useMemo(() => describeWorkspaceText(resource), [resource]);
  const view =
    selectedView && resource && selectedView.path === resource.path && presentation.views.includes(selectedView.view)
      ? selectedView.view
      : presentation.defaultView;
  const dirty = resource?.content !== undefined && draft !== resource.content;
  const [externallyChanged, setExternallyChanged] = useState(false);
  const setWorkspaceDirty = controller.setDirty;
  useEffect(() => {
    setWorkspaceDirty(dirty);
    return () => setWorkspaceDirty(false);
  }, [setWorkspaceDirty, dirty]);
  useWorkspaceFileChanges(controller.httpBaseUrl, (paths) => {
    const resourcePath = resource?.path ?? activePath;
    if (!paths.some((path) => path === "." || path === resourcePath || resourcePath.startsWith(`${path}/`))) return;
    if (dirty) setExternallyChanged(true);
    else setLoadRevision((value) => value + 1);
  });
  useEffect(() => {
    setExternallyChanged(false);
  }, [activePath, loadRevision]);

  const requestClose = useCallback((): void => {
    setPendingSelection(undefined);
    setPendingExitEdit(false);
    if (dirty) {
      setCloseConfirmationOpen(true);
      return;
    }
    onOpenChange(false);
  }, [dirty, onOpenChange]);

  const save = useCallback(async (): Promise<void> => {
    if (!resource?.editable || !dirty || saveState === "saving") return;
    setSaveState("saving");
    try {
      const saved = await saveWorkspaceResource(
        controller.httpBaseUrl,
        activePath,
        draft,
        resource.etag,
        controller.csrfToken,
      );
      setLoadState({ status: "ready", resource: saved });
      setDraft(saved.content ?? draft);
      setSaveState("saved");
      setEditing(false);
      setExternallyChanged(false);
      toast.success(frontendMessage("resource.saved"));
    } catch (error) {
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : frontendMessage("resource.saveFailed"));
    }
  }, [activePath, controller.csrfToken, controller.httpBaseUrl, dirty, draft, resource, saveState]);

  const refreshExplorer = useCallback((): void => {
    setTreeRevision((value) => value + 1);
  }, []);

  const selectResource = useCallback(
    (path: string): void => {
      if (path === activePath) return;
      if (dirty) {
        setPendingExitEdit(false);
        setPendingSelection(path);
        setCloseConfirmationOpen(true);
        return;
      }
      setRenameName("");
      setDeleteConfirmationOpen(false);
      setActivePath(path);
    },
    [activePath, dirty],
  );

  const submitExplorerAction = useCallback(async (): Promise<void> => {
    const name = explorerName.trim();
    const path = name ? joinWorkspacePath(explorerParentPath, name) : "";
    if (!path) return;
    try {
      const entry = await createWorkspaceEntry(
        controller.httpBaseUrl,
        path,
        explorerAction ?? "file",
        "",
        controller.csrfToken,
      );
      setExplorerAction(undefined);
      setExplorerName("");
      refreshExplorer();
      if (entry.kind !== "directory") selectResource(entry.path);
      toast.success(frontendMessage("resource.created"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : frontendMessage("resource.createFailed"));
    }
  }, [
    controller.csrfToken,
    controller.httpBaseUrl,
    explorerAction,
    explorerName,
    explorerParentPath,
    refreshExplorer,
    selectResource,
  ]);

  const beginExplorerAction = useCallback((action: WorkspaceExplorerAction, parentPath: string): void => {
    setExplorerAction(action);
    setExplorerParentPath(parentPath || ".");
    setExplorerName("");
  }, []);

  const submitRename = useCallback(async (): Promise<void> => {
    const nextName = renameName.trim();
    if (!activePath || activePath === "." || !nextName) return;
    const destination = nextName.includes("/")
      ? nextName
      : joinWorkspacePath(parentWorkspacePath(activePath), nextName);
    try {
      const entry = await renameWorkspaceEntry(controller.httpBaseUrl, activePath, destination, controller.csrfToken);
      setRenameName("");
      refreshExplorer();
      setActivePath(entry.path);
      toast.success(frontendMessage("resource.renamed"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : frontendMessage("resource.renameFailed"));
    }
  }, [activePath, controller.csrfToken, controller.httpBaseUrl, refreshExplorer, renameName]);

  const removeActiveResource = useCallback(async (): Promise<void> => {
    if (!activePath || activePath === ".") return;
    try {
      await removeWorkspaceEntry(controller.httpBaseUrl, activePath, false, controller.csrfToken);
      setDeleteConfirmationOpen(false);
      setActivePath("");
      setLoadState({ status: "empty" });
      refreshExplorer();
      toast.success(frontendMessage("resource.deleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : frontendMessage("resource.deleteFailed"));
    }
  }, [activePath, controller.csrfToken, controller.httpBaseUrl, refreshExplorer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!open || event.key.toLowerCase() !== "s" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      void save();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, save]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = window.setTimeout(() => setSaveState("idle"), motionDurations.saveStatusMs);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  return (
    <Dialog
      // The workbench contains Pierre's Shadow DOM scrollports. A modal
      // remove-scroll layer retargets their wheel events and blocks scrolling.
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent
        title={resource?.name ?? formatWorkspaceResourceLocation(activeLocator)}
        showClose={false}
        showHeader={false}
        contentInitial={false}
        className="h-[min(880px,calc(100dvh-24px))] w-[min(1280px,calc(100vw-24px))]"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        onFocusOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <ResourceHeader
          dirty={dirty}
          loading={loadState.status === "loading"}
          locator={activeLocator}
          resource={resource}
          saveState={saveState}
          presentation={presentation}
          view={view}
          onViewChange={(next) => {
            if (resource) setSelectedView({ path: resource.path, view: next });
          }}
          editing={editing}
          onEdit={() => setEditing(true)}
          onCancelEdit={() => {
            if (dirty) {
              setPendingExitEdit(true);
              setPendingSelection(undefined);
              setCloseConfirmationOpen(true);
            } else setEditing(false);
          }}
          onToggleExplorer={() => {
            setExplorerVisible((value) => !value);
            setMobileExplorer((value) => !value);
          }}
          canMutate={Boolean(activePath && activePath !== ".")}
          onClose={requestClose}
          onDelete={() => setDeleteConfirmationOpen(true)}
          onDownload={() => void downloadWorkspaceResource(controller.httpBaseUrl, activePath, resource?.name)}
          onReload={() => {
            if (!dirty) setLoadRevision((value) => value + 1);
          }}
          onRename={() => setRenameName(resource?.name ?? "")}
          onSave={() => void save()}
          onReference={() =>
            void controller.referenceResource(activePath).then(
              () => {
                if (!dirty) onOpenChange(false);
              },
              (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
            )
          }
        />
        {externallyChanged ? (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-content-secondary"
          >
            <span className="min-w-0 flex-1">{frontendMessage("workspace.fileChanged")}</span>
            <Button size="sm" variant="ghost" onClick={() => setLoadRevision((value) => value + 1)}>
              {frontendMessage("workspace.discardAndReload")}
            </Button>
          </div>
        ) : null}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "absolute inset-0 z-10 flex bg-surface-panel sm:static sm:z-auto",
              mobileExplorer ? "flex" : "hidden",
              explorerVisible ? "sm:flex" : "sm:hidden",
            )}
          >
            <WorkspaceResourceExplorer
              activePath={resource?.path ?? ""}
              httpBaseUrl={controller.httpBaseUrl}
              revision={treeRevision}
              onCreateEntry={beginExplorerAction}
              onSelect={(path) => {
                selectResource(path);
                setMobileExplorer(false);
              }}
              onRefresh={refreshExplorer}
            />
          </div>
          <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--theme-code-editor-bg)]">
            {loadState.status === "loading" ? <ResourceLoading /> : null}
            {loadState.status === "empty" ? <EmptyResourceSelection /> : null}
            {loadState.status === "error" ? (
              <ResourceError message={loadState.message} onRetry={() => setLoadRevision((value) => value + 1)} />
            ) : null}
            {resource ? (
              <ResourceBody
                httpBaseUrl={controller.httpBaseUrl}
                locator={activeLocator}
                resource={resource}
                editing={editing}
                view={view}
                onDraftChange={setDraft}
              />
            ) : null}
          </main>
        </div>
        {explorerAction ? (
          <ExplorerInputBar
            action={explorerAction}
            value={explorerName}
            onCancel={() => setExplorerAction(undefined)}
            onChange={setExplorerName}
            onSubmit={() => void submitExplorerAction()}
          />
        ) : null}
        {renameName ? (
          <ExplorerInputBar
            action="file"
            value={renameName}
            rename
            onCancel={() => setRenameName("")}
            onChange={setRenameName}
            onSubmit={() => void submitRename()}
          />
        ) : null}
        {closeConfirmationOpen ? (
          <UnsavedChangesBar
            onDiscard={() => {
              if (pendingExitEdit) {
                setDraft(resource?.content ?? "");
                setEditing(false);
                setPendingExitEdit(false);
                setCloseConfirmationOpen(false);
                setLoadRevision((value) => value + 1);
                return;
              }
              const nextPath = pendingSelection;
              setPendingSelection(undefined);
              setCloseConfirmationOpen(false);
              if (nextPath) {
                setRenameName("");
                setDeleteConfirmationOpen(false);
                setActivePath(nextPath);
                return;
              }
              onOpenChange(false);
            }}
            onKeepEditing={() => {
              setPendingSelection(undefined);
              setCloseConfirmationOpen(false);
            }}
          />
        ) : null}
        {deleteConfirmationOpen ? (
          <DeleteResourceBar
            onCancel={() => setDeleteConfirmationOpen(false)}
            onDelete={() => void removeActiveResource()}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ResourceHeader({
  canMutate,
  dirty,
  loading,
  locator,
  onClose,
  onDelete,
  onDownload,
  onReload,
  onRename,
  onSave,
  onReference,
  resource,
  saveState,
  editing,
  onEdit,
  onCancelEdit,
  onToggleExplorer,
  presentation,
  view,
  onViewChange,
}: {
  readonly canMutate: boolean;
  readonly dirty: boolean;
  readonly loading: boolean;
  readonly locator: WorkspaceResourceLocator;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly onDownload: () => void;
  readonly onReload: () => void;
  readonly onRename: () => void;
  readonly onSave: () => void;
  readonly onReference: () => void;
  readonly resource?: WorkspaceResourceData;
  readonly saveState: SaveState;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onToggleExplorer: () => void;
  readonly presentation: WorkspaceTextPresentation;
  readonly view: WorkspaceTextView;
  readonly onViewChange: (view: WorkspaceTextView) => void;
}): JSX.Element {
  return (
    <header
      className="resource-header relative flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4"
      data-save-phase={saveState}
    >
      <IconButton
        label={frontendMessage("resource.toggleExplorer")}
        tooltip={frontendMessage("resource.toggleExplorer")}
        size="md"
        onClick={onToggleExplorer}
      >
        <AppIcon icon="folder" size={17} />
      </IconButton>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-content-strong" title={resource?.path}>
            {resource?.name ?? locator.path.split("/").at(-1)}
          </span>
          {dirty ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-solid"
              role="status"
              aria-label={frontendMessage("resource.changed")}
            />
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <div className="h-8 w-8 shrink-0">
          {presentation.views.length > 1 ? (
            <Tooltip content={frontendMessage("resource.preview")}>
              <span className="inline-flex h-8 w-8">
                <MenuSelect
                  value={view}
                  placeholder={frontendMessage("resource.preview")}
                  ariaLabel={frontendMessage("resource.preview")}
                  disabled={editing}
                  options={presentation.views.map((mode) => ({
                    value: mode,
                    label: frontendMessage(`resource.${mode}`),
                  }))}
                  renderValue={() => (
                    <AppIcon
                      icon={view === "preview" ? "eye" : view === "structure" ? "file-json" : "file-code"}
                      size={16}
                    />
                  )}
                  trailing={<span className="hidden" />}
                  triggerClassName="h-8 w-8 justify-center border-0 bg-transparent p-2 hover:bg-surface-hover"
                  contentClassName="min-w-32"
                  onChange={(next) => {
                    const mode = presentation.views.find((candidate) => candidate === next);
                    if (mode) onViewChange(mode);
                  }}
                />
              </span>
            </Tooltip>
          ) : null}
        </div>
        <IconButton
          size="md"
          label={frontendMessage(editing ? "ui.cancel" : "resource.edit")}
          tooltip={frontendMessage(editing ? "ui.cancel" : "resource.edit")}
          disabled={!resource?.editable || saveState === "saving"}
          onClick={editing ? onCancelEdit : onEdit}
        >
          <AppIcon icon={editing ? "undo" : "pencil"} size={16} />
        </IconButton>
        <IconButton
          size="md"
          label={frontendMessage(editing ? "resource.save" : "workspace.referenceFile")}
          tooltip={frontendMessage(editing ? "resource.save" : "workspace.referenceFile")}
          tooltipShortcut={editing ? "Ctrl / ⌘ S" : undefined}
          loading={saveState === "saving"}
          disabled={editing ? !dirty : !resource || dirty}
          onClick={editing ? onSave : onReference}
        >
          <AppIcon icon={editing ? "checkmark" : "plus"} size={16} />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={frontendMessage("resource.actions")}
              tooltip={frontendMessage("resource.actions")}
              size="md"
            >
              <AppIcon icon="more" size={17} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!resource || dirty || loading}
              onSelect={onReload}
              icon={<AppIcon icon="refresh" size={15} />}
            >
              {frontendMessage("resource.reload")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!resource} onSelect={onDownload} icon={<AppIcon icon="download" size={15} />}>
              {frontendMessage("resource.download")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!resource || !canMutate || dirty}
              onSelect={onRename}
              icon={<AppIcon icon="pencil" size={15} />}
            >
              {frontendMessage("resource.rename")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              disabled={!resource || !canMutate || dirty}
              onSelect={onDelete}
              icon={<AppIcon icon="trash" size={15} />}
            >
              {frontendMessage("resource.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          label={frontendMessage("ui.close")}
          tooltip={frontendMessage("ui.close")}
          size="md"
          onClick={onClose}
          disabled={saveState === "saving"}
        >
          <AppIcon icon="close" size={16} />
        </IconButton>
      </div>
    </header>
  );
}

function ExplorerInputBar({
  action,
  onCancel,
  onChange,
  onSubmit,
  rename = false,
  value,
}: {
  readonly action: WorkspaceExplorerAction;
  readonly onCancel: () => void;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly rename?: boolean;
  readonly value: string;
}): JSX.Element {
  return (
    <form
      className="flex shrink-0 items-center gap-2 border-t border-line bg-surface-panel px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <span className="min-w-0 flex-1">
        <Input
          autoFocus
          className="h-8 text-xs"
          aria-label={frontendMessage(
            rename ? "resource.renamePath" : action === "directory" ? "resource.directoryPath" : "resource.filePath",
          )}
          placeholder={frontendMessage(
            rename ? "resource.renamePath" : action === "directory" ? "resource.directoryPath" : "resource.filePath",
          )}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      <Button type="submit" size="sm">
        {frontendMessage(rename ? "resource.rename" : "resource.create")}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        {frontendMessage("ui.cancel")}
      </Button>
    </form>
  );
}

function DeleteResourceBar({
  onCancel,
  onDelete,
}: {
  readonly onCancel: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-danger/30 bg-danger/5 px-4 py-3">
      <span className="min-w-0 flex-1 text-[12px] text-content-secondary">
        {frontendMessage("resource.confirmDelete")}
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        {frontendMessage("ui.cancel")}
      </Button>
      <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
        {frontendMessage("resource.delete")}
      </Button>
    </div>
  );
}

function EmptyResourceSelection(): JSX.Element {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        <AppIcon icon="file-code" size={28} className="mx-auto text-content-muted" />
        <p className="mt-3 text-[12px] leading-5 text-content-muted">{frontendMessage("resource.selectFile")}</p>
      </div>
    </div>
  );
}

function ResourceBody({
  editing,
  view,
  httpBaseUrl,
  locator,
  onDraftChange,
  resource,
}: {
  readonly editing: boolean;
  readonly view: WorkspaceTextView;
  readonly httpBaseUrl: string;
  readonly locator: WorkspaceResourceLocator;
  readonly onDraftChange: (value: string) => void;
  readonly resource: WorkspaceResourceData;
}): JSX.Element {
  if (resource.kind === "image") {
    return <WorkspaceImageStage httpBaseUrl={httpBaseUrl} path={locator.path} name={resource.name} />;
  }
  if (resource.content !== undefined) {
    return (
      <WorkspaceTextSurface
        key={resource.etag}
        name={resource.name}
        cacheKey={`${resource.path}:${resource.etag}`}
        editing={editing}
        view={view}
        column={locator.column}
        line={locator.line}
        content={resource.content}
        onChange={onDraftChange}
      />
    );
  }
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-md">
        <AppIcon icon="file-text" size={28} className="mx-auto text-content-muted" />
        <h3 className="mt-3 text-[14px] font-medium text-content-strong">
          {resource.kind === "text"
            ? frontendMessage("resource.textTooLarge")
            : frontendMessage("resource.binaryTitle")}
        </h3>
        <p className="mt-1 text-[12px] leading-5 text-content-muted">
          {frontendMessage("resource.downloadDescription")}
        </p>
      </div>
    </div>
  );
}

function WorkspaceImageStage({
  httpBaseUrl,
  path,
  name,
}: {
  readonly httpBaseUrl: string;
  readonly path: string;
  readonly name: string;
}): JSX.Element {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setSource(undefined);
    setError(undefined);
    void readWorkspaceResourceBlob(httpBaseUrl, path).then(
      (blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      },
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : frontendMessage("resource.loadFailed"));
      },
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [httpBaseUrl, path]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-surface-muted">
      {source ? (
        <ImageCanvasViewer
          alt={name}
          labels={{
            actualSize: frontendMessage("resource.actualSize"),
            fit: frontendMessage("resource.fit"),
            zoomIn: frontendMessage("resource.zoomIn"),
            zoomOut: frontendMessage("resource.zoomOut"),
          }}
          source={source}
        />
      ) : error ? (
        <ResourceError message={error} />
      ) : (
        <ResourceLoading />
      )}
    </div>
  );
}

function ResourceLoading(): JSX.Element {
  return <StateView status="loading" className="h-full" />;
}

function ResourceError({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }): JSX.Element {
  return (
    <StateView
      status="error"
      className="h-full"
      description={message}
      onRetry={onRetry}
      retryLabel={frontendMessage("resource.retry")}
    />
  );
}

function UnsavedChangesBar({
  onDiscard,
  onKeepEditing,
}: {
  readonly onDiscard: () => void;
  readonly onKeepEditing: () => void;
}): JSX.Element {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-surface-panel px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-content-strong">{frontendMessage("resource.unsavedTitle")}</p>
        <p className="text-[11px] text-content-muted">{frontendMessage("resource.unsavedDescription")}</p>
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={onKeepEditing}>
        {frontendMessage("resource.keepEditing")}
      </Button>
      <Button type="button" size="sm" variant="destructive" onClick={onDiscard}>
        {frontendMessage("resource.discard")}
      </Button>
    </div>
  );
}

async function downloadWorkspaceResource(httpBaseUrl: string, path: string, name?: string): Promise<void> {
  try {
    const blob = await readWorkspaceResourceBlob(httpBaseUrl, path);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = name ?? path.split(/[\\/]/u).pop() ?? "resource";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : frontendMessage("resource.downloadFailed"));
  }
}
