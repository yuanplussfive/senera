import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
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
import { useWorkspaceResourceController } from "./WorkspaceResourceProvider";
import { WorkspaceMenuContext } from "./WorkspaceMenuContext";
import { DirectoryFailureSchema, DirectoryListingSchema, type DirectoryListing } from "./WorkspaceDirectoryListing";
import type { WorkspaceMenuDialogs as WorkspaceMenuDialogsComponent } from "./WorkspaceMenuDialogs";

// Single-flight: the lazy dialogs chunk is loaded at most once per session, so
// prefetching on user intent and the `lazy()` first mount share one import.
type DialogsModule = { WorkspaceMenuDialogs: typeof WorkspaceMenuDialogsComponent };
let dialogsModulePromise: Promise<DialogsModule> | undefined;
const loadDialogsModule = (): Promise<DialogsModule> => {
  dialogsModulePromise ??= import("./WorkspaceMenuDialogs");
  return dialogsModulePromise;
};

const WorkspaceMenuDialogs = lazy(() =>
  loadDialogsModule().then((module) => ({ default: module.WorkspaceMenuDialogs })),
);

/**
 * Warm the lazy dialogs chunk once a user gesture makes a dialog plausible
 * (e.g. the workspace popover opened) — never on first paint.
 */
export function prefetchWorkspaceMenuDialogs(): void {
  void loadDialogsModule();
}

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
  // Latch: once any dialog has been requested, keep the lazy dialog module
  // mounted so later opens (and Radix exit animations) stay synchronous.
  const [dialogsMounted, setDialogsMounted] = useState(false);
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
        return DirectoryListingSchema.parse(body);
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
  useEffect(() => {
    if (browsing || forgetTarget !== undefined || pendingRoot !== undefined) setDialogsMounted(true);
  }, [browsing, forgetTarget, pendingRoot]);
  const select = (root: string): void => {
    if (root === snapshot?.workspaceRoot) return;
    if (resources?.dirty) {
      setBrowsing(false);
      setPendingRoot(root);
      return;
    }
    if (workspace.switchWorkspace(root)) opening.current = true;
  };
  const confirmPendingRoot = (): void => {
    if (pendingRoot && workspace.switchWorkspace(pendingRoot)) {
      opening.current = true;
      setPendingRoot(undefined);
      setBrowsing(false);
    }
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
      {dialogsMounted ? (
        <Suspense fallback={null}>
          <WorkspaceMenuDialogs
            workspace={workspace}
            browsing={browsing}
            setBrowsing={setBrowsing}
            input={input}
            setInput={setInput}
            listing={listing}
            error={error}
            navigate={navigate}
            select={select}
            forgetTarget={forgetTarget}
            setForgetTarget={setForgetTarget}
            forgetting={forgetting}
            setForgetting={setForgetting}
            forgetWorkspace={forgetWorkspace}
            pendingRoot={pendingRoot}
            setPendingRoot={setPendingRoot}
            confirmPendingRoot={confirmPendingRoot}
          />
        </Suspense>
      ) : null}
    </WorkspaceMenuContext.Provider>
  );
}
