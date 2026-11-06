import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod/mini";
import { toast } from "sonner";
import type { WorkspaceControllerHandle } from "../../app/useWorkspaceController";
import { readDesktopBridge } from "../../app/desktopBridge";
import { buildHttpApiUrl } from "../../api/httpApiUrl";
import { forgetWorkspace as forgetWorkspaceRequest } from "../../api/workspaceCatalogClient";
import type {
  AgentWorkspaceDescriptor,
  AgentWorkspaceId,
} from "../../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalogContract";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import {
  AppIcon,
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  IconButton,
  Input,
  Spinner,
  StateView,
  ScrollArea,
} from "../ui";
import { useWorkspaceResourceController } from "./WorkspaceResourceProvider";
import { WorkspaceMenuContext } from "./WorkspaceMenuContext";

const DirectorySchema = z.object({
  path: z.string(),
  parent: z.nullable(z.string()),
  directories: z.array(z.object({ path: z.string(), name: z.string() })),
});
type DirectoryListing = z.infer<typeof DirectorySchema>;
const DirectoryFailureSchema = z.object({ error: z.object({ message: z.string() }) });

/** Keep the folder browser and confirmation dialogs alive after the switcher popover closes. */
export function WorkspaceMenuProvider({
  workspace,
  httpBaseUrl,
  children,
}: {
  workspace: WorkspaceControllerHandle;
  httpBaseUrl: string;
  children: ReactNode;
}): JSX.Element {
  const [browsing, setBrowsing] = useState(false);
  const [directory, setDirectory] = useState<{ path: string }>();
  const [input, setInput] = useState("");
  const [listing, setListing] = useState<DirectoryListing>();
  const [error, setError] = useState<string>();
  const [pendingRoot, setPendingRoot] = useState<string>();
  const [forgetTarget, setForgetTarget] = useState<AgentWorkspaceDescriptor>();
  const [forgetting, setForgetting] = useState(false);
  const opening = useRef(false);
  const resources = useWorkspaceResourceController();
  const snapshot = workspace.snapshot;
  const navigate = (root: string): void => {
    setListing(undefined);
    setError(undefined);
    setDirectory({ path: root });
  };
  useEffect(() => {
    if (!browsing || !directory) return;
    const controller = new AbortController();
    setListing(undefined);
    setError(undefined);
    setInput(directory.path);
    const url = new URL(buildHttpApiUrl(httpBaseUrl, "/api/workspace-directories"));
    url.searchParams.set("path", directory.path);
    void fetch(url, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(DirectoryFailureSchema.parse(body).error.message);
        return DirectorySchema.parse(body);
      })
      .then(
        (value) => {
          if (!controller.signal.aborted) {
            setListing(value);
            setInput(value.path);
          }
        },
        (reason: unknown) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
        },
      );
    return () => controller.abort();
  }, [browsing, directory, httpBaseUrl]);
  useEffect(() => {
    if (!opening.current || workspace.phase === "switching") return;
    if (workspace.phase === "succeeded") setBrowsing(false);
    if (workspace.phase === "succeeded" || workspace.phase === "failed") opening.current = false;
  }, [workspace.phase]);
  const select = (root: string): void => {
    if (root === snapshot?.workspaceRoot) return;
    if (resources?.dirty) {
      setBrowsing(false);
      setPendingRoot(root);
      return;
    }
    if (workspace.switchWorkspace(root)) opening.current = true;
  };
  const openFolder = async (): Promise<void> => {
    try {
      const choose = readDesktopBridge()?.chooseWorkspaceFolder;
      if (choose) {
        const selected = await choose();
        if (selected) select(selected);
      } else if (snapshot?.capabilities.browseDirectories) {
        workspace.resetError();
        navigate(snapshot.workspaceRoot);
        setBrowsing(true);
      }
    } catch (reason) {
      const detail = (reason instanceof Error ? reason.message : String(reason)).trim();
      const message = frontendMessage("workspace.folderPickerFailed");
      setError(detail ? `${message}: ${detail}` : message);
      toast.error(message, detail ? { description: detail } : undefined);
    }
  };
  const forgetWorkspace = async (workspaceId: AgentWorkspaceId): Promise<void> => {
    if (!resources) return;
    await forgetWorkspaceRequest(resources.httpBaseUrl, workspaceId, resources.csrfToken);
    workspace.refresh();
    toast.success(frontendMessage("workspace.forgotten"));
  };
  const folderRequest = useRef(openFolder);
  folderRequest.current = openFolder;
  useEffect(() => readDesktopBridge()?.onWorkspaceFolderRequested?.(() => void folderRequest.current()), []);
  return (
    <WorkspaceMenuContext.Provider
      value={{
        workspace,
        select,
        forgetWorkspace,
        requestForget: setForgetTarget,
        openFolder,
        error: workspace.error?.message ?? error,
      }}
    >
      {children}
      <Dialog open={browsing} onOpenChange={setBrowsing}>
        <DialogContent
          title={frontendMessage("workspace.select")}
          className="h-[min(520px,calc(100dvh-32px))] w-[min(560px,calc(100vw-32px))]"
          bodyClassName="flex min-h-0 flex-1 flex-col px-4 pb-2"
          footerClassName="px-4"
          footer={
            <div className="flex justify-end">
              <Button
                size="sm"
                loading={workspace.phase === "switching"}
                disabled={!listing || input.trim() !== listing.path || !workspace.connected}
                onClick={() => {
                  if (listing) select(listing.path);
                }}
              >
                {frontendMessage("workspace.openThisFolder")}
              </Button>
            </div>
          }
        >
          <form
            className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (input.trim()) navigate(input.trim());
            }}
          >
            <IconButton
              type="button"
              label={frontendMessage("workspace.parentFolder")}
              tooltip={frontendMessage("workspace.parentFolder")}
              disabled={!listing?.parent || workspace.phase === "switching"}
              onClick={() => {
                if (listing?.parent) navigate(listing.parent);
              }}
            >
              <AppIcon icon="arrow-left" size={15} />
            </IconButton>
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-label={frontendMessage("settings.workspace.pathLabel")}
              className="min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-xs shadow-none"
              disabled={workspace.phase === "switching"}
            />
            <IconButton
              type="submit"
              label={frontendMessage("workspace.browse")}
              tooltip={frontendMessage("workspace.browse")}
              loading={!listing && !error}
              disabled={!input.trim() || workspace.phase === "switching"}
            >
              <AppIcon icon="arrow-right" size={15} />
            </IconButton>
          </form>
          <ScrollArea className="mt-2 min-h-0 flex-1" viewportClassName="overflow-x-hidden">
            {workspace.error || error ? (
              <p role="alert" className="px-2 py-3 text-xs text-brick-600">
                {workspace.error?.message ?? error}
              </p>
            ) : null}
            {!listing && !error ? <StateView status="loading" /> : null}
            {listing?.directories.map((entry) => (
              <Button
                key={entry.path}
                variant="ghost"
                className="w-full min-w-0 justify-start"
                disabled={workspace.phase === "switching"}
                onClick={() => navigate(entry.path)}
              >
                <AppIcon icon="folder" size={15} />
                <span className="min-w-0 flex-1 truncate text-left" title={entry.path}>
                  {entry.name}
                </span>
                <AppIcon icon="chevron-right" size={13} className="text-content-muted" />
              </Button>
            ))}
          </ScrollArea>
        </DialogContent>
      </Dialog>
      {/* Owned here: the switcher lives inside portalled menus and popovers that
          unmount on the click that opens this confirmation. */}
      <Dialog
        open={forgetTarget !== undefined}
        onOpenChange={(open) => {
          if (!open && !forgetting) setForgetTarget(undefined);
        }}
      >
        <DialogContent
          title={frontendMessage("workspace.forgetTitle")}
          description={
            <>
              {frontendMessage("workspace.forgetDescriptionPrefix")}{" "}
              <code className="rounded-md border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[12px] leading-5 text-content-primary [overflow-wrap:anywhere]">
                {forgetTarget?.root}
              </code>{" "}
              {frontendMessage("workspace.forgetDescriptionSuffix")}
            </>
          }
          className="w-[min(380px,calc(100vw-28px))]"
          bodyClassName="px-6 pb-1 pt-1"
          footerClassName="px-6 pb-5"
          footer={
            <DialogActions>
              <DialogActionButton close disabled={forgetting} onClick={() => setForgetTarget(undefined)}>
                {frontendMessage("ui.cancel")}
              </DialogActionButton>
              <DialogActionButton
                variant="danger"
                loading={forgetting}
                onClick={() => {
                  const target = forgetTarget;
                  if (!target) return;
                  setForgetting(true);
                  void forgetWorkspace(target.id)
                    .then(() => setForgetTarget(undefined))
                    .catch((reason: unknown) => {
                      toast.error(reason instanceof Error ? reason.message : frontendMessage("workspace.forgetFailed"));
                    })
                    .finally(() => setForgetting(false));
                }}
              >
                {frontendMessage("workspace.forgetConfirm")}
              </DialogActionButton>
            </DialogActions>
          }
        />
      </Dialog>
      <Dialog
        open={pendingRoot !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingRoot(undefined);
        }}
      >
        <DialogContent
          title={frontendMessage("workspace.unsavedTitle")}
          description={frontendMessage("workspace.unsavedDescription")}
          className="w-[min(380px,calc(100vw-28px))]"
          bodyClassName="px-6 pb-1 pt-1"
          footerClassName="px-6 pb-5"
          footer={
            <DialogActions>
              <DialogActionButton
                close
                disabled={workspace.phase === "switching"}
                onClick={() => setPendingRoot(undefined)}
              >
                {frontendMessage("ui.cancel")}
              </DialogActionButton>
              <DialogActionButton
                variant="danger"
                disabled={workspace.phase === "switching"}
                onClick={() => {
                  if (pendingRoot && workspace.switchWorkspace(pendingRoot)) {
                    opening.current = true;
                    setPendingRoot(undefined);
                    setBrowsing(false);
                  }
                }}
              >
                {frontendMessage("workspace.discardAndOpen")}
              </DialogActionButton>
            </DialogActions>
          }
        >
          <p className="rounded-lg border border-line bg-surface-muted px-3 py-2 font-mono text-[12px] leading-5 text-content-secondary [overflow-wrap:anywhere]">
            {pendingRoot}
          </p>
        </DialogContent>
      </Dialog>
    </WorkspaceMenuContext.Provider>
  );
}

/**
 * The one workspace switcher. Recent workspaces come first because switching
 * between them is the common action; choosing a folder from disk is the rare
 * one and sits last, exactly as desktop editors order it.
 *
 * This component only *requests* a confirmation via `requestForget`; the dialog
 * belongs to `WorkspaceMenuProvider`. The switcher's container is a portal
 * (popover) that unmounts on the very click that opens the dialog, so the dialog
 * must live outside it to survive that gesture.
 */
export function WorkspaceSwitcher({
  onClose,
  className,
}: {
  onClose?: () => void;
  className?: string;
}): JSX.Element | null {
  const menu = useContext(WorkspaceMenuContext);
  const [query, setQuery] = useState("");
  const catalog = menu?.workspace.snapshot?.workspaces;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  // Filtering is deliberately local: recents are a short, already-loaded list,
  // and a remote search would add latency to a keystroke-level interaction.
  const visibleWorkspaces = useMemo(() => {
    const entries = catalog ?? [];
    if (!normalizedQuery) return entries;
    return entries.filter((entry) => `${entry.name}\n${entry.root}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [catalog, normalizedQuery]);
  if (!menu) return null;
  const { workspace, select, requestForget, openFolder, error } = menu;
  const snapshot = workspace.snapshot;
  const locked = !snapshot || !workspace.connected || workspace.phase === "switching";
  const chooseWorkspaceFolder = readDesktopBridge()?.chooseWorkspaceFolder;
  const folderLabel = chooseWorkspaceFolder
    ? frontendMessage("workspace.chooseLocalFolder")
    : frontendMessage("workspace.browseServerFolder");
  const folderDisabled = locked || (!chooseWorkspaceFolder && !snapshot?.capabilities.browseDirectories);
  const clearSearchLabel = frontendMessage("workspace.searchClear");
  return (
    <div className={cn("flex min-w-0 flex-col px-1 pb-1", className)} data-workspace-switcher>
      <label className="relative mx-1 flex min-w-0 items-center">
        <span className="sr-only">{frontendMessage("workspace.searchFolders")}</span>
        <AppIcon
          icon="search"
          size={15}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={frontendMessage("workspace.searchFolders")}
          className="h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent pl-9 pr-8 text-[13px] text-content-primary outline-none transition-colors duration-150 placeholder:text-content-muted"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-content-muted transition-colors duration-150 hover:bg-surface-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
            aria-label={clearSearchLabel}
          >
            <AppIcon icon="close" size={13} aria-hidden="true" />
          </button>
        ) : null}
      </label>
      <div className="mt-1.5 max-h-[min(17rem,calc(100dvh-16rem))] overflow-y-auto" data-workspace-list>
        {visibleWorkspaces.map((entry) => {
          const isActive = entry.id === snapshot?.workspaceId;
          const protectedEntry = isActive || entry.id === snapshot?.defaultWorkspaceId;
          return (
            <div
              key={entry.id}
              className="group flex min-w-0 items-center rounded-md transition-colors hover:bg-surface-hover"
              data-workspace-entry={entry.id}
            >
              <button
                type="button"
                disabled={locked}
                aria-current={isActive ? "true" : undefined}
                onClick={() => {
                  select(entry.root);
                  if (!locked) onClose?.();
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-55"
              >
                <AppIcon icon="folder" size={16} className="shrink-0 text-content-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-5 text-content-primary">
                    {entry.name}
                  </span>
                  <span className="mt-[1px] block truncate text-[12px] leading-4 text-content-secondary" title={entry.root}>
                    {entry.root}
                  </span>
                </span>
                {isActive ? (
                  <AppIcon icon="checkmark" size={15} className="shrink-0 text-accent-content" aria-hidden="true" />
                ) : null}
              </button>
              {protectedEntry ? null : (
                <IconButton
                  label={frontendMessage("workspace.forget")}
                  tooltip={frontendMessage("workspace.forget")}
                  tone="danger"
                  size="sm"
                  disabled={locked}
                  className="mr-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    // The dialog is owned by the provider, so closing this container in
                    // the same gesture cannot take it down; doing it synchronously also
                    // stops the popover from reclaiming focus from the open dialog.
                    requestForget(entry);
                    onClose?.();
                  }}
                >
                  <AppIcon icon="trash" size={14} />
                </IconButton>
              )}
            </div>
          );
        })}
        {normalizedQuery && visibleWorkspaces.length === 0 ? (
          <p className="px-3 py-5 text-center text-[12px] leading-5 text-content-muted" data-workspace-search-empty>
            {frontendMessage("workspace.searchEmpty")}
          </p>
        ) : null}
      </div>
      {workspace.phase === "switching" ? (
        <p role="status" className="flex items-center gap-2 px-3 py-1.5 text-xs text-content-muted">
          <Spinner size="xs" />
          {frontendMessage("workspace.opening")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-3 py-1.5 text-xs text-brick-600">
          {error}
        </p>
      ) : null}
      <div className="mx-2 my-1.5 h-px bg-line-subtle/60" aria-hidden="true" />
      <div>
        <button
          type="button"
          disabled={folderDisabled}
          data-workspace-folder-action
          onClick={() => {
            void openFolder();
            onClose?.();
          }}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-content-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-45"
        >
          <AppIcon icon="folder" size={16} className="shrink-0 text-content-muted" aria-hidden="true" />
          {folderLabel}
        </button>
      </div>
    </div>
  );
}
