import { Download, File, FileCode2, Image as ImageIcon, RefreshCw, Save, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  readWorkspaceResource,
  readWorkspaceResourceBlob,
  saveWorkspaceResource,
  type WorkspaceResourceData,
} from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn, formatFileSize } from "../../lib/util";
import { motionDurations } from "../../shared/motion";
import { CodeTextEditor } from "../code/CodeTextEditor";
import { ImageCanvasViewer } from "../media/ImageCanvasViewer";
import { Dialog, DialogContent, Spinner, Tooltip } from "../ui";
import { formatWorkspaceResourceLocation, type WorkspaceResourceLocator } from "./WorkspaceResourceLocator";
import { resolveWorkspaceEditorLanguage } from "./WorkspaceResourceEditorLanguage";
import type { WorkspaceResourceController } from "./WorkspaceResourceProvider";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly resource: WorkspaceResourceData };

type SaveState = "idle" | "saving" | "saved" | "error";

export function WorkspaceResourceWorkbench({
  controller,
  locator,
  onOpenChange,
  open,
}: {
  readonly controller: WorkspaceResourceController;
  readonly locator: WorkspaceResourceLocator;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}): JSX.Element {
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadState({ status: "loading" });
    setSaveState("idle");
    setCloseConfirmationOpen(false);
    void readWorkspaceResource(controller.httpBaseUrl, locator.path).then(
      (resource) => {
        if (!active) return;
        setLoadState({ status: "ready", resource });
        setDraft(resource.content ?? "");
      },
      (error: unknown) => {
        if (active) {
          setLoadState({
            status: "error",
            message: error instanceof Error ? error.message : frontendMessage("resource.loadFailed"),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [controller.httpBaseUrl, loadRevision, locator.path]);

  const resource = loadState.status === "ready" ? loadState.resource : undefined;
  const dirty = resource?.content !== undefined && draft !== resource.content;

  const requestClose = useCallback((): void => {
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
        locator.path,
        draft,
        resource.etag,
        controller.csrfToken,
      );
      setLoadState({ status: "ready", resource: saved });
      setDraft(saved.content ?? draft);
      setSaveState("saved");
      toast.success(frontendMessage("resource.saved"));
    } catch (error) {
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : frontendMessage("resource.saveFailed"));
    }
  }, [controller.csrfToken, controller.httpBaseUrl, dirty, draft, locator.path, resource, saveState]);

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
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent
        title={resource?.name ?? formatWorkspaceResourceLocation(locator)}
        showClose={false}
        showHeader={false}
        className="h-[min(860px,calc(100dvh-24px))] w-[min(1120px,calc(100vw-24px))] rounded-md"
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        <ResourceHeader
          dirty={dirty}
          locator={locator}
          resource={resource}
          saveState={saveState}
          onClose={requestClose}
          onDownload={() => void downloadWorkspaceResource(controller.httpBaseUrl, locator.path, resource?.name)}
          onReload={() => {
            if (!dirty) setLoadRevision((value) => value + 1);
          }}
          onSave={() => void save()}
        />
        <main className="relative min-h-0 flex-1 overflow-hidden bg-[var(--theme-code-editor-bg)]">
          {loadState.status === "loading" ? <ResourceLoading /> : null}
          {loadState.status === "error" ? (
            <ResourceError message={loadState.message} onRetry={() => setLoadRevision((value) => value + 1)} />
          ) : null}
          {resource ? (
            <ResourceBody
              httpBaseUrl={controller.httpBaseUrl}
              locator={locator}
              resource={resource}
              draft={draft}
              onDraftChange={setDraft}
            />
          ) : null}
        </main>
        {closeConfirmationOpen ? (
          <UnsavedChangesBar
            onDiscard={() => onOpenChange(false)}
            onKeepEditing={() => setCloseConfirmationOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ResourceHeader({
  dirty,
  locator,
  onClose,
  onDownload,
  onReload,
  onSave,
  resource,
  saveState,
}: {
  readonly dirty: boolean;
  readonly locator: WorkspaceResourceLocator;
  readonly onClose: () => void;
  readonly onDownload: () => void;
  readonly onReload: () => void;
  readonly onSave: () => void;
  readonly resource?: WorkspaceResourceData;
  readonly saveState: SaveState;
}): JSX.Element {
  const ResourceIcon = resource?.kind === "image" ? ImageIcon : resource?.kind === "text" ? FileCode2 : File;
  const status = readSaveStatus(dirty, saveState, resource?.editable);

  return (
    <header
      className="resource-header relative flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface-panel px-3"
      data-save-phase={saveState}
    >
      <ResourceIcon className="h-4 w-4 shrink-0 text-content-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-content-strong">
            {resource?.name ?? formatWorkspaceResourceLocation(locator)}
          </span>
          {resource?.path && resource.path !== resource.name ? (
            <span className="hidden truncate font-mono text-[11px] text-content-muted sm:block">{resource.path}</span>
          ) : null}
        </div>
      </div>
      {resource ? (
        <span className="hidden shrink-0 text-[11px] text-content-muted md:inline">
          {formatFileSize(resource.size)} · {status}
        </span>
      ) : null}
      <div className="flex shrink-0 items-center gap-0.5">
        <ResourceIconButton label={frontendMessage("resource.reload")} disabled={!resource || dirty} onClick={onReload}>
          <RefreshCw className="h-4 w-4" />
        </ResourceIconButton>
        <ResourceIconButton label={frontendMessage("resource.download")} disabled={!resource} onClick={onDownload}>
          <Download className="h-4 w-4" />
        </ResourceIconButton>
        {resource?.editable ? (
          <ResourceIconButton
            label={frontendMessage("resource.save")}
            disabled={!dirty || saveState === "saving"}
            onClick={onSave}
          >
            <Save className="h-4 w-4" />
          </ResourceIconButton>
        ) : null}
        <ResourceIconButton label={frontendMessage("ui.close")} onClick={onClose}>
          <X className="h-4 w-4" />
        </ResourceIconButton>
      </div>
    </header>
  );
}

function ResourceBody({
  draft,
  httpBaseUrl,
  locator,
  onDraftChange,
  resource,
}: {
  readonly draft: string;
  readonly httpBaseUrl: string;
  readonly locator: WorkspaceResourceLocator;
  readonly onDraftChange: (value: string) => void;
  readonly resource: WorkspaceResourceData;
}): JSX.Element {
  if (resource.kind === "image") {
    return <WorkspaceImageStage httpBaseUrl={httpBaseUrl} path={locator.path} name={resource.name} />;
  }
  if (resource.content !== undefined) {
    const editorLanguage = resolveWorkspaceEditorLanguage(resource.name);
    return (
      <CodeTextEditor
        key={resource.etag}
        ariaLabel={resource.name}
        className="h-full"
        disabled={!resource.editable}
        extraExtensions={editorLanguage.extensions}
        initialColumn={locator.column}
        initialLine={locator.line}
        language={editorLanguage.language}
        value={draft}
        onChange={onDraftChange}
      />
    );
  }
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-md">
        <File className="mx-auto h-7 w-7 text-content-muted" />
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
  return (
    <div className="grid h-full place-items-center" role="status">
      <Spinner size="md" className="text-content-muted" />
    </div>
  );
}

function ResourceError({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }): JSX.Element {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-lg">
        <p className="text-[13px] leading-5 text-content-secondary">{message}</p>
        {onRetry ? (
          <button
            type="button"
            className="mt-3 text-[12px] font-medium text-accent-content hover:text-accent-content-hover"
            onClick={onRetry}
          >
            {frontendMessage("resource.retry")}
          </button>
        ) : null}
      </div>
    </div>
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
      <button
        type="button"
        className="h-8 rounded-md px-3 text-[12px] text-content-secondary hover:bg-surface-hover"
        onClick={onKeepEditing}
      >
        {frontendMessage("resource.keepEditing")}
      </button>
      <button
        type="button"
        className="h-8 rounded-md bg-brick-600 px-3 text-[12px] font-medium text-paper-50 hover:bg-brick-700"
        onClick={onDiscard}
      >
        {frontendMessage("resource.discard")}
      </button>
    </div>
  );
}

function ResourceIconButton({
  children,
  className,
  disabled,
  label,
  onClick,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-md text-content-muted transition-colors",
          "hover:bg-surface-hover hover:text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          "disabled:cursor-not-allowed disabled:opacity-35",
          className,
        )}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function readSaveStatus(dirty: boolean, saveState: SaveState, editable: boolean | undefined): string {
  if (!editable) return frontendMessage("resource.readOnly");
  if (saveState === "saving") return frontendMessage("resource.saving");
  if (saveState === "error") return frontendMessage("resource.saveFailed");
  if (dirty) return frontendMessage("resource.changed");
  return frontendMessage("resource.savedState");
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
