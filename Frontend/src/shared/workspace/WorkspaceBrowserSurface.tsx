import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import { openExternalUrl } from "../../app/desktopBridge";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon, IconButton, Input, Spinner } from "../ui";
import type { WorkspaceResourceController } from "./WorkspaceResourceProvider";
import { WorkspaceResourceExplorer } from "./WorkspaceResourceExplorer";
import { WorkspaceWebFrame } from "./WorkspaceWebFrame";
import { WorkspaceFileIcon, WorkspaceFileIconScope } from "./WorkspaceFileIcon";
import { workspaceWebsiteIconUrl } from "./workspaceWebsiteIcon";
import {
  parseWorkspaceAddress,
  readWorkspaceTabAddress,
  readWorkspaceTabEntry,
  readWorkspaceTabLocator,
  readWorkspaceTabUrl,
  workspaceTabEntryForLocator,
  type WorkspaceAddressTarget,
  type WorkspaceTab,
  type WorkspaceTabEntry,
} from "./WorkspaceTabs";

const LazyWorkspaceResourceWorkbench = lazy(() =>
  import("./WorkspaceResourceWorkbench").then((module) => ({ default: module.WorkspaceResourceWorkbench })),
);
const LazyWorkspacePreviewSurface = lazy(() => import("./WorkspacePreviewSurface"));

/** Browser-style surface hosted by the workspace tool dock. */
export function WorkspaceBrowserSurface({
  controller,
}: {
  readonly controller: WorkspaceResourceController;
}): JSX.Element | null {
  const activeTab = controller.tabs.find((tab) => tab.id === controller.activeTabId) ?? controller.tabs[0];
  if (!activeTab) return null;

  return (
    <WorkspaceFileIconScope>
      <div className="flex h-full min-h-0 flex-col bg-surface-panel" data-workspace-browser>
        <WorkspaceAddressBar key={activeTab.id} controller={controller} tab={activeTab} />
        <WorkspaceTabStrip controller={controller} activeTabId={activeTab.id} />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {controller.tabs.map((tab) => {
            const entry = readWorkspaceTabEntry(tab);
            const active = tab.id === activeTab.id;
            return (
              <div
                key={tab.id}
                id={panelElementId(tab)}
                role="tabpanel"
                aria-labelledby={tabElementId(tab)}
                hidden={!active && entry.kind !== "web"}
                aria-hidden={!active || undefined}
                inert={!active}
                className={cn("absolute inset-0 h-full min-h-0", !active && "invisible pointer-events-none")}
              >
                {entry.kind === "workspace" ? (
                  <WorkspaceTabWorkbench tab={tab} controller={controller} active={active} />
                ) : entry.kind === "blank" ? (
                  <WorkspaceBlankTabSurface tab={tab} controller={controller} />
                ) : entry.kind === "preview" ? (
                  <Suspense fallback={<WorkspaceBrowserLoading />}>
                    <LazyWorkspacePreviewSurface key={tab.reloadToken} resource={entry.resource} />
                  </Suspense>
                ) : (
                  <WorkspaceWebFrame tab={tab} entry={entry} controller={controller} active={active} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceFileIconScope>
  );
}

function WorkspaceAddressBar({
  controller,
  tab,
}: {
  readonly controller: WorkspaceResourceController;
  readonly tab: WorkspaceTab;
}): JSX.Element {
  const address = readWorkspaceTabAddress(tab);
  const [draft, setDraft] = useState(address);
  const [invalid, setInvalid] = useState(false);
  const canGoBack = tab.historyIndex > 0;
  const canGoForward = tab.historyIndex < tab.history.length - 1;
  const url = readWorkspaceTabUrl(tab);

  useEffect(() => {
    setDraft(address);
    setInvalid(false);
  }, [address]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const target = parseWorkspaceAddress(draft);
    if (target.kind === "invalid") {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const nextEntry = entryForAddressTarget(target);
    if (nextEntry) controller.navigateActiveTab(nextEntry);
  };

  return (
    <div className="shrink-0 border-b border-line-subtle" data-workspace-browser-address>
      <div className="flex h-9 items-center gap-1 px-1.5">
        <IconButton
          label={frontendMessage("workspace.browser.back")}
          size="sm"
          disabled={!canGoBack}
          onClick={controller.goBack}
        >
          <AppIcon icon="arrow-left" size={14} />
        </IconButton>
        <IconButton
          label={frontendMessage("workspace.browser.forward")}
          size="sm"
          disabled={!canGoForward}
          onClick={controller.goForward}
        >
          <AppIcon icon="arrow-right" size={14} />
        </IconButton>
        <form className="min-w-0 flex-1" onSubmit={submit}>
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={frontendMessage("workspace.browser.address")}
            aria-invalid={invalid || undefined}
            placeholder={frontendMessage("workspace.browser.addressPlaceholder")}
            spellCheck={false}
            autoComplete="off"
            className="h-7 text-xs"
            data-workspace-browser-address-input
          />
        </form>
        <IconButton
          label={frontendMessage("workspace.browser.reload")}
          size="sm"
          disabled={controller.dirty}
          onClick={controller.reloadActiveTab}
        >
          <AppIcon icon="refresh" size={14} />
        </IconButton>
        <IconButton
          label={frontendMessage("workspace.browser.openExternal")}
          size="sm"
          disabled={!url}
          onClick={() => {
            if (!url) return;
            void openExternalUrl(url).then((result) => {
              if (result === "blocked") toast.error(frontendMessage("workspace.browser.openExternalFailed"));
            });
          }}
        >
          <AppIcon icon="external-link" size={14} />
        </IconButton>
      </div>
      {invalid ? (
        <p role="alert" className="px-3 pb-1.5 text-xs text-brick-600">
          {frontendMessage("workspace.browser.invalidAddress")}
        </p>
      ) : null}
    </div>
  );
}

function WorkspaceTabStrip({
  controller,
  activeTabId,
}: {
  readonly controller: WorkspaceResourceController;
  readonly activeTabId: string;
}): JSX.Element {
  const stripRef = useRef<HTMLDivElement>(null);
  const activateAdjacentTab = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const offset = event.key === "ArrowLeft" ? -1 : 1;
    const nextIndex = (index + offset + controller.tabs.length) % controller.tabs.length;
    const next = controller.tabs[nextIndex];
    if (!next) return;
    event.preventDefault();
    controller.activateTab(next.id);
    stripRef.current?.querySelector<HTMLElement>(`[data-workspace-tab="${next.id}"] [role="tab"]`)?.focus();
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={frontendMessage("workspace.browser.tabs")}
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line-subtle px-1.5 py-1"
      data-workspace-tab-strip
    >
      {controller.tabs.map((tab, index) => {
        const active = tab.id === activeTabId;
        const entry = readWorkspaceTabEntry(tab);
        return (
          <div
            key={tab.id}
            className={cn(
              "flex h-8 max-w-48 shrink-0 items-center rounded-md border",
              active ? "border-line bg-surface-panel" : "border-transparent hover:bg-surface-hover",
            )}
            data-workspace-tab={tab.id}
          >
            <button
              type="button"
              role="tab"
              id={tabElementId(tab)}
              aria-selected={active}
              aria-controls={panelElementId(tab)}
              onClick={() => controller.activateTab(tab.id)}
              onKeyDown={(event) => activateAdjacentTab(event, index)}
              className={cn(
                "flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-xs",
                active ? "text-content-strong" : "text-content-secondary",
              )}
            >
              <WorkspaceTabIcon tab={tab} entry={entry} />
              <span className="truncate">{readTabTitle(tab)}</span>
            </button>
            <IconButton
              label={frontendMessage("workspace.browser.closeTab")}
              size="sm"
              className="mr-0.5 h-6 w-6"
              onClick={() => controller.requestCloseTab(tab.id)}
            >
              <AppIcon icon="close" size={12} />
            </IconButton>
          </div>
        );
      })}
      <IconButton label={frontendMessage("workspace.browser.newTab")} size="sm" onClick={controller.newBlankTab}>
        <AppIcon icon="plus" size={14} />
      </IconButton>
    </div>
  );
}

function WorkspaceTabWorkbench({
  tab,
  controller,
  active,
}: {
  readonly tab: WorkspaceTab;
  readonly controller: WorkspaceResourceController;
  readonly active: boolean;
}): JSX.Element | null {
  const locator = readWorkspaceTabLocator(tab);
  const setTabDirty = controller.setTabDirty;
  const setDirty = useCallback((dirty: boolean) => setTabDirty(tab.id, dirty), [setTabDirty, tab.id]);
  const tabController = useMemo<WorkspaceResourceController>(
    () => ({
      ...controller,
      setDirty,
    }),
    [controller, setDirty],
  );
  if (!locator) return null;

  return (
    <Suspense fallback={<WorkspaceBrowserLoading />}>
      <LazyWorkspaceResourceWorkbench
        controller={tabController}
        locator={locator}
        open={active}
        presentation="dock"
        reloadToken={tab.reloadToken}
        onOpenChange={(open) => {
          if (!open) controller.closeTab(tab.id);
        }}
        onPathChange={(path) => controller.syncTabPath(tab.id, path)}
      />
    </Suspense>
  );
}

function WorkspaceBlankTabSurface({
  controller,
  tab,
}: {
  readonly controller: WorkspaceResourceController;
  readonly tab: WorkspaceTab;
}): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col" data-workspace-blank-tab>
      <WorkspaceResourceExplorer
        activePath=""
        httpBaseUrl={controller.httpBaseUrl}
        layout="panel"
        showHeader={false}
        revision={tab.reloadToken}
        onRefresh={controller.reloadActiveTab}
        onSelect={(path) => controller.openResource({ path })}
      />
    </div>
  );
}

function WorkspaceBrowserLoading(): JSX.Element {
  return (
    <div className="grid h-full place-items-center" aria-busy="true" data-workspace-browser-loading>
      <Spinner size="sm" className="text-content-secondary" />
    </div>
  );
}

function entryForAddressTarget(target: WorkspaceAddressTarget): WorkspaceTabEntry | undefined {
  if (target.kind === "workspace") return workspaceTabEntryForLocator(target.locator);
  if (target.kind === "web") return { kind: "web", url: target.url };
  return undefined;
}

function readTabTitle(tab: WorkspaceTab): string {
  return tab.title || frontendMessage("workspace.browser.newTab");
}

function WorkspaceTabIcon({
  tab,
  entry,
}: {
  readonly tab: WorkspaceTab;
  readonly entry: WorkspaceTabEntry;
}): JSX.Element {
  const [failedSource, setFailedSource] = useState<string>();
  if (entry.kind === "workspace") return <WorkspaceFileIcon path={entry.path} size={14} />;
  if (entry.kind === "preview") return <WorkspaceFileIcon path={entry.resource.name} size={14} />;
  if (entry.kind === "blank") return <AppIcon icon="browser" size={13} />;
  const source = tab.favicon ?? workspaceWebsiteIconUrl(entry.url);
  return source && failedSource !== source ? (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      className="h-3.5 w-3.5 shrink-0 object-contain"
      onError={() => setFailedSource(source)}
      data-workspace-site-icon
    />
  ) : (
    <AppIcon icon="globe" size={13} />
  );
}

function tabElementId(tab: WorkspaceTab): string {
  return `workspace-browser-tab-${tab.id}`;
}

function panelElementId(tab: WorkspaceTab): string {
  return `workspace-browser-panel-${tab.id}`;
}
