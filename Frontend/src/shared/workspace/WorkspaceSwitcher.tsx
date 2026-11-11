import { useContext, useMemo, useState, type ReactNode } from "react";
import { readDesktopBridge } from "../../app/desktopBridge";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon, IconButton, Spinner } from "../ui";
import { WorkspaceMenuContext } from "./WorkspaceMenuContext";

export const workspaceActionClassName =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-content-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-45";

/**
 * The one workspace switcher. Recent workspaces come first because switching
 * between them is the common action; choosing a folder from disk is the rare
 * one and sits last, exactly as desktop editors order it.
 *
 * This component only *requests* a confirmation via `requestForget`; the dialog
 * belongs to `WorkspaceMenuProvider`. The switcher's container is a portal
 * (popover) that unmounts on the very click that opens the dialog, so the dialog
 * must live outside it to survive that gesture.
 *
 * Lives in its own module (not `WorkspaceMenu`) so that only surfaces which
 * render the switcher — the execution context chip inside the chat panel —
 * pull this UI into their chunk.
 */
export function WorkspaceSwitcher({
  onClose,
  footer,
  className,
}: {
  onClose?: () => void;
  footer?: ReactNode;
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
                  <span
                    className="mt-[1px] block truncate text-[12px] leading-4 text-content-secondary"
                    title={entry.root}
                  >
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
          className={workspaceActionClassName}
        >
          <AppIcon icon="folder" size={16} className="shrink-0 text-content-muted" aria-hidden="true" />
          {folderLabel}
        </button>
      </div>
      {footer}
    </div>
  );
}
