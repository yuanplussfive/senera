import { toast } from "sonner";
import type { WorkspaceControllerHandle } from "../../app/useWorkspaceController";
import type {
  AgentWorkspaceDescriptor,
  AgentWorkspaceId,
} from "../../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalogContract";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  AppIcon,
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  IconButton,
  Input,
  StateView,
  ScrollArea,
} from "../ui";
import type { DirectoryListing } from "./WorkspaceDirectoryListing";

/**
 * The folder browser and the workspace switch confirmation dialogs owned by
 * `WorkspaceMenuProvider`. All state stays in the provider; this component only
 * renders what the user has explicitly opened, so the provider mounts it behind
 * `React.lazy` on first use instead of shipping it with the first paint.
 */
export function WorkspaceMenuDialogs({
  workspace,
  browsing,
  setBrowsing,
  input,
  setInput,
  listing,
  error,
  navigate,
  select,
  forgetTarget,
  setForgetTarget,
  forgetting,
  setForgetting,
  forgetWorkspace,
  pendingRoot,
  setPendingRoot,
  confirmPendingRoot,
}: {
  workspace: WorkspaceControllerHandle;
  browsing: boolean;
  setBrowsing: (open: boolean) => void;
  input: string;
  setInput: (value: string) => void;
  listing?: DirectoryListing;
  error?: string;
  navigate: (root: string) => void;
  select: (root: string) => void;
  forgetTarget?: AgentWorkspaceDescriptor;
  setForgetTarget: (target: AgentWorkspaceDescriptor | undefined) => void;
  forgetting: boolean;
  setForgetting: (value: boolean) => void;
  forgetWorkspace: (workspaceId: AgentWorkspaceId) => Promise<void>;
  pendingRoot?: string;
  setPendingRoot: (root: string | undefined) => void;
  confirmPendingRoot: () => void;
}): JSX.Element {
  return (
    <>
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
      {/* Owned by the provider: the switcher lives inside portalled menus and
          popovers that unmount on the click that opens this confirmation. */}
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
                onClick={confirmPendingRoot}
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
    </>
  );
}
