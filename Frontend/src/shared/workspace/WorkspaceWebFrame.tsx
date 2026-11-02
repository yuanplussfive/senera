import { createElement, useLayoutEffect, useRef, useState } from "react";
import { openExternalUrl, supportsNativeWorkspaceWebview } from "../../app/desktopBridge";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Button, StateView } from "../ui";
import type { WorkspaceResourceController } from "./WorkspaceResourceProvider";
import type { WorkspaceTab, WorkspaceTabEntry } from "./WorkspaceTabs";
import { readWorkspaceWebsiteIcon } from "./workspaceWebsiteIcon";

/** Persistent partition keeps browser logins across workspace tabs and restarts. */
export const WorkspaceWebviewPartition = "persist:senera-workspace-browser";
/** Guest hardening that the desktop `will-attach-webview` policy enforces again. */
export const WorkspaceWebviewPreferences = "contextIsolation=yes,sandbox=yes,nodeIntegration=no";

const WebFrameSandbox = "allow-scripts allow-forms allow-modals allow-popups";
const WebFrameReferrerPolicy = "no-referrer";

type WebEntry = Extract<WorkspaceTabEntry, { kind: "web" }>;

interface WorkspaceWebviewElement extends HTMLElement {
  readonly reload?: () => void;
}

type WebLoadState = { readonly status: "loading" | "ready" } | { readonly status: "error"; readonly message: string };
// Chromium uses ERR_ABORTED for navigation replaced by another navigation, not a failed page.
const AbortedNavigationErrorCode = -3;

/**
 * Hosts a web tab: a native `<webview>` in the desktop shell so sites that refuse
 * iframe embedding still render, otherwise a sandboxed iframe with an escape hatch.
 */
export function WorkspaceWebFrame({
  tab,
  entry,
  controller,
  active = true,
}: {
  readonly tab: WorkspaceTab;
  readonly entry: WebEntry;
  readonly controller: WorkspaceResourceController;
  readonly active?: boolean;
}): JSX.Element {
  if (supportsNativeWorkspaceWebview()) {
    return <NativeWorkspaceWebFrame tab={tab} entry={entry} controller={controller} active={active} />;
  }
  return <SandboxedWorkspaceWebFrame tab={tab} entry={entry} />;
}

function NativeWorkspaceWebFrame({
  tab,
  entry,
  controller,
  active,
}: {
  readonly tab: WorkspaceTab;
  readonly entry: WebEntry;
  readonly controller: WorkspaceResourceController;
  readonly active: boolean;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ tab, entry, controller, active });
  const synchronizeRef = useRef<(() => void) | undefined>(undefined);
  const [loadState, setLoadState] = useState<WebLoadState>({ status: "loading" });

  useLayoutEffect(() => {
    latest.current = { tab, entry, controller, active };
    synchronizeRef.current?.();
  }, [tab, entry, controller, active]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const element = host?.querySelector<WorkspaceWebviewElement>("webview");
    if (!host || !element) return;
    let requestedUrl = element.getAttribute("src") ?? "";
    let reloadToken = latest.current.tab.reloadToken;
    let attached = false;

    const synchronize = (): void => {
      const current = latest.current;
      // Initial zero-size guests can start sites before their responsive layout is usable.
      if (!requestedUrl) {
        const bounds = host.getBoundingClientRect();
        if (!current.active || bounds.width <= 0 || bounds.height <= 0) return;
      }
      if (current.entry.url !== requestedUrl) {
        requestedUrl = current.entry.url;
        reloadToken = current.tab.reloadToken;
        setLoadState({ status: "loading" });
        // The native src attribute queues navigation through attachment. Calling loadURL
        // before a guest exists can throw synchronously; dom-ready cannot recover that load.
        element.setAttribute("src", requestedUrl);
      } else if (current.tab.reloadToken !== reloadToken && attached) {
        reloadToken = current.tab.reloadToken;
        setLoadState({ status: "loading" });
        try {
          element.reload?.();
        } catch (error) {
          setLoadState({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    const syncNavigatedUrl = (event: Event): void => {
      if (readWebviewEvent(event).isMainFrame === false) return;
      const url = readWebviewEventUrl(event);
      if (!url || url === requestedUrl) return;
      requestedUrl = url;
      const current = latest.current;
      current.controller.navigateTab(current.tab.id, { kind: "web", url });
    };
    const syncPageTitle = (event: Event): void => {
      const title = readWebviewEvent(event).title;
      const current = latest.current;
      if (typeof title === "string" && title.trim()) current.controller.setTabTitle(current.tab.id, title);
    };
    const syncFavicon = (event: Event): void => {
      const favicons = readWebviewEvent(event).favicons;
      if (!Array.isArray(favicons)) return;
      const icon = favicons
        .flatMap((value) => (typeof value === "string" ? [readWorkspaceWebsiteIcon(value, requestedUrl)] : []))
        .find(Boolean);
      const current = latest.current;
      if (icon) current.controller.setTabFavicon(current.tab.id, requestedUrl, icon);
    };
    const finishLoading = (): void => {
      setLoadState((current) => (current.status === "loading" ? { status: "ready" } : current));
    };
    const startNavigation = (event: Event): void => {
      const detail = readWebviewEvent(event);
      if (detail.isMainFrame !== false && !detail.isInPlace) setLoadState({ status: "loading" });
    };
    const failLoading = (event: Event): void => {
      const detail = readWebviewEvent(event);
      if (detail.isMainFrame === false || detail.errorCode === AbortedNavigationErrorCode) return;
      setLoadState({
        status: "error",
        message:
          typeof detail.errorDescription === "string"
            ? detail.errorDescription
            : frontendMessage("workspace.browser.loadFailed"),
      });
    };
    const attachedGuest = (): void => {
      attached = true;
      synchronize();
    };
    const listeners: readonly (readonly [string, EventListener])[] = [
      ["did-attach", attachedGuest],
      ["dom-ready", finishLoading],
      ["did-stop-loading", finishLoading],
      ["did-start-navigation", startNavigation],
      ["did-navigate", syncNavigatedUrl],
      ["did-navigate-in-page", syncNavigatedUrl],
      ["page-title-updated", syncPageTitle],
      ["page-favicon-updated", syncFavicon],
      ["did-fail-load", failLoading],
      [
        "render-process-gone",
        () => setLoadState({ status: "error", message: frontendMessage("workspace.browser.rendererStopped") }),
      ],
    ];
    for (const [name, listener] of listeners) element.addEventListener(name, listener);
    const observer = new ResizeObserver(synchronize);
    observer.observe(host);
    synchronizeRef.current = synchronize;
    synchronize();
    return () => {
      synchronizeRef.current = undefined;
      observer.disconnect();
      for (const [name, listener] of listeners) element.removeEventListener(name, listener);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative flex h-full min-h-0 flex-col"
      data-workspace-web-tab
      data-workspace-native-web-view
    >
      {createElement("webview", {
        partition: WorkspaceWebviewPartition,
        webpreferences: WorkspaceWebviewPreferences,
        className: cn(
          "flex min-h-0 w-full flex-1 border-0 bg-surface-panel",
          loadState.status === "error" && "invisible",
        ),
        "data-workspace-web-frame": "",
      })}
      {loadState.status !== "ready" ? (
        <div className="absolute inset-0 bg-surface-panel">
          <StateView
            status={loadState.status}
            title={loadState.status === "error" ? frontendMessage("workspace.browser.loadFailed") : undefined}
            description={loadState.status === "error" ? loadState.message : undefined}
            onRetry={loadState.status === "error" ? () => controller.reloadActiveTab() : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}

function SandboxedWorkspaceWebFrame({
  tab,
  entry,
}: {
  readonly tab: WorkspaceTab;
  readonly entry: WebEntry;
}): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col" data-workspace-web-tab>
      <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-xs text-content-muted">
        <span className="min-w-0 flex-1">{frontendMessage("workspace.browser.embedHint")}</span>
        <Button variant="ghost" size="sm" onClick={() => void openExternalUrl(entry.url)}>
          {frontendMessage("workspace.browser.openExternal")}
        </Button>
      </div>
      <iframe
        key={`${tab.id}:${tab.reloadToken}`}
        src={entry.url}
        title={tab.title || frontendMessage("workspace.browser.newTab")}
        sandbox={WebFrameSandbox}
        referrerPolicy={WebFrameReferrerPolicy}
        className="min-h-0 w-full flex-1 border-0 bg-surface-panel"
        data-workspace-web-frame
      />
    </div>
  );
}

function readWebviewEventUrl(event: Event): string | undefined {
  const url = readWebviewEvent(event).url;
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function readWebviewEvent(event: Event): Event & {
  readonly url?: unknown;
  readonly title?: unknown;
  readonly favicons?: unknown;
  readonly isMainFrame?: unknown;
  readonly isInPlace?: unknown;
  readonly errorCode?: unknown;
  readonly errorDescription?: unknown;
} {
  return event;
}
