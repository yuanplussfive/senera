import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
import { useResponsiveMode } from "../responsive";
import {
  AppIcon,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Input,
  Spinner,
  StateView,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
  ScrollArea,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../ui";
import { useWorkspaceResourceController } from "./WorkspaceResourceProvider";

const DirectorySchema = z.object({
  path: z.string(),
  parent: z.nullable(z.string()),
  directories: z.array(z.object({ path: z.string(), name: z.string() })),
});
type DirectoryListing = z.infer<typeof DirectorySchema>;
const DirectoryFailureSchema = z.object({ error: z.object({ message: z.string() }) });

const WorkspaceFileTree = lazy(() =>
  import("./WorkspaceFileTree").then((module) => ({ default: module.WorkspaceFileTree })),
);
const WorkspaceMenuContext = createContext<{
  workspace: WorkspaceControllerHandle;
  select: (root: string) => void;
  forgetWorkspace: (workspaceId: AgentWorkspaceId) => Promise<void>;
  openFolder: () => Promise<void>;
  openPanel: () => void;
  error?: string;
} | null>(null);

/** Keep folder selection and dirty-edit dialogs alive after the command menu closes. */
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
  const [panelOpen, setPanelOpen] = useState(false);
  const [directory, setDirectory] = useState<{ path: string }>();
  const [input, setInput] = useState("");
  const [listing, setListing] = useState<DirectoryListing>();
  const [error, setError] = useState<string>();
  const [pendingRoot, setPendingRoot] = useState<string>();
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
        openFolder,
        openPanel: () => setPanelOpen(true),
        error: workspace.error?.message ?? error,
      }}
    >
      {children}
      <Dialog modal={false} open={panelOpen} onOpenChange={setPanelOpen}>
        <DialogContent
          title={frontendMessage("resource.workspace")}
          showHeader={false}
          className="h-[min(26rem,calc(100dvh-2rem))] w-[min(20rem,calc(100vw-2rem))]"
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
          onFocusOutside={(event) => event.preventDefault()}
        >
          {panelOpen ? <WorkspaceMenuPanel onClose={() => setPanelOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
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
              <p role="alert" className="px-2 py-3 text-xs text-danger">
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
      <Dialog
        open={pendingRoot !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingRoot(undefined);
        }}
      >
        <DialogContent
          title={frontendMessage("workspace.unsavedTitle")}
          description={frontendMessage("workspace.unsavedDescription")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPendingRoot(undefined)}>
                {frontendMessage("ui.cancel")}
              </Button>
              <Button
                onClick={() => {
                  if (pendingRoot && workspace.switchWorkspace(pendingRoot)) {
                    opening.current = true;
                    setPendingRoot(undefined);
                    setBrowsing(false);
                  }
                }}
              >
                {frontendMessage("workspace.discardAndOpen")}
              </Button>
            </>
          }
        />
      </Dialog>
    </WorkspaceMenuContext.Provider>
  );
}

export function WorkspaceMenu({ onClose }: { onClose: () => void }): JSX.Element | null {
  const menu = useContext(WorkspaceMenuContext);
  const resources = useWorkspaceResourceController();
  const { viewport } = useResponsiveMode();
  const [open, setOpen] = useState(false);
  if (!menu || !resources) return null;
  const { workspace } = menu;
  const snapshot = workspace.snapshot;
  const active = snapshot?.workspaces.find((entry) => entry.id === snapshot.workspaceId);
  const label = frontendMessage("workspace.menu", { name: active?.name ?? frontendMessage("resource.workspace") });
  if (viewport === "mobile") {
    return (
      <DropdownMenuItem
        icon={<AppIcon icon="folder" size={15} />}
        data-workspace-menu-trigger
        onSelect={() => {
          menu.openPanel();
          onClose();
        }}
      >
        {label}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger icon={<AppIcon icon="folder" size={15} />} data-workspace-menu-trigger>
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="h-[min(26rem,calc(100dvh-6rem))] w-80 max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        onFocusOutside={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") event.stopPropagation();
        }}
      >
        {open ? (
          <WorkspaceMenuPanel
            onClose={() => {
              setOpen(false);
              onClose();
            }}
          />
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function WorkspaceMenuPanel({ onClose }: { onClose: () => void }): JSX.Element | null {
  const menu = useContext(WorkspaceMenuContext);
  const resources = useWorkspaceResourceController();
  const [forgetTarget, setForgetTarget] = useState<AgentWorkspaceDescriptor>();
  const [forgetting, setForgetting] = useState(false);
  if (!menu || !resources) return null;
  const { workspace, select, forgetWorkspace, openFolder, error } = menu;
  const snapshot = workspace.snapshot;
  const locked = !snapshot || !workspace.connected || workspace.phase === "switching";
  const chooseWorkspaceFolder = readDesktopBridge()?.chooseWorkspaceFolder;
  const folderLabel = chooseWorkspaceFolder
    ? frontendMessage("workspace.chooseLocalFolder")
    : frontendMessage("workspace.browseServerFolder");
  return (
    <>
      <Tabs defaultValue="files" className="flex h-full min-h-0 flex-col" data-workspace-menu>
        <div className="shrink-0 border-b border-line-subtle p-2">
          <TabsList className="w-full" aria-label={frontendMessage("resource.workspace")}>
            <TabsTrigger value="files">{frontendMessage("workspace.menuFiles")}</TabsTrigger>
            <TabsTrigger value="switch">{frontendMessage("workspace.menuSwitch")}</TabsTrigger>
          </TabsList>
          <p className="mt-2 truncate px-1 font-mono text-[11px] text-content-muted" title={snapshot?.workspaceRoot}>
            {snapshot?.workspaceRoot}
          </p>
        </div>
        <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<StateView status="loading" />}>
            <WorkspaceFileTree
              httpBaseUrl={resources.httpBaseUrl}
              onSelect={(path) => {
                onClose();
                resources.openResource({ path });
              }}
            />
          </Suspense>
        </TabsContent>
        <TabsContent value="switch" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <ScrollArea className="min-h-0 flex-1 p-1">
            {snapshot?.workspaces.map((entry) => {
              const active = entry.id === snapshot.workspaceId;
              const protectedEntry = active || entry.id === snapshot.defaultWorkspaceId;
              return (
                <div
                  key={entry.id}
                  className="group flex min-w-0 items-center rounded-md hover:bg-surface-hover"
                  data-workspace-entry={entry.id}
                >
                  <Button
                    variant="ghost"
                    disabled={locked}
                    aria-current={active ? "true" : undefined}
                    className="h-auto min-w-0 flex-1 justify-start py-2 text-left"
                    onClick={() => select(entry.root)}
                  >
                    <AppIcon icon="folder" size={15} className="shrink-0 text-content-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{entry.name}</span>
                      <span className="block truncate text-[11px] font-normal text-content-muted" title={entry.root}>
                        {entry.root}
                      </span>
                    </span>
                    {active ? <AppIcon icon="check" size={15} className="shrink-0" /> : null}
                  </Button>
                  <IconButton
                    label={frontendMessage("workspace.forget")}
                    tooltip={
                      active || entry.id === snapshot.defaultWorkspaceId
                        ? frontendMessage(active ? "workspace.forgetActive" : "workspace.forgetDefault")
                        : frontendMessage("workspace.forget")
                    }
                    tone="danger"
                    size="sm"
                    disabled={locked || protectedEntry}
                    className="mr-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setForgetTarget(entry);
                    }}
                  >
                    <AppIcon icon="trash" size={14} />
                  </IconButton>
                </div>
              );
            })}
          </ScrollArea>
          {workspace.phase === "switching" ? (
            <p role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-content-muted">
              <Spinner size="xs" />
              {frontendMessage("workspace.opening")}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="shrink-0 border-t border-line-subtle p-2">
            <Button
              variant="ghost"
              className="w-full justify-start"
              disabled={locked || (!chooseWorkspaceFolder && !snapshot?.capabilities.browseDirectories)}
              onClick={() => {
                void openFolder();
                onClose();
              }}
            >
              <AppIcon icon="folder" size={15} />
              {folderLabel}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
      <Dialog
        open={forgetTarget !== undefined}
        onOpenChange={(open) => {
          if (!open && !forgetting) setForgetTarget(undefined);
        }}
      >
        <DialogContent
          title={frontendMessage("workspace.forgetTitle")}
          description={frontendMessage("workspace.forgetDescription")}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={forgetting} onClick={() => setForgetTarget(undefined)}>
                {frontendMessage("ui.cancel")}
              </Button>
              <Button
                variant="destructive"
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
              </Button>
            </div>
          }
        >
          <p className="text-sm text-content-secondary">{forgetTarget?.root}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
