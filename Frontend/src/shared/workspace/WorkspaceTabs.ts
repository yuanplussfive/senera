import {
  formatWorkspaceResourceLocation,
  parseWorkspaceResourceLocator,
  type WorkspaceResourceLocator,
} from "./WorkspaceResourceLocator";
import { normalizeWorkspacePath } from "./WorkspaceResourcePath";
import { readWorkspaceWebsiteIcon } from "./workspaceWebsiteIcon";
import type { WorkspacePreviewResource } from "./WorkspacePreviewResource";

/** One navigable location inside a workspace browser tab. */
export type WorkspaceTabEntry =
  | { readonly kind: "blank" }
  | { readonly kind: "workspace"; readonly path: string; readonly line?: number; readonly column?: number }
  | { readonly kind: "preview"; readonly resource: WorkspacePreviewResource }
  | { readonly kind: "web"; readonly url: string };

export interface WorkspaceTab {
  readonly id: string;
  readonly title: string;
  readonly history: readonly WorkspaceTabEntry[];
  readonly historyIndex: number;
  readonly reloadToken: number;
  readonly favicon?: string;
}

export interface WorkspaceTabState {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string;
}

export type WorkspaceAddressTarget =
  | { readonly kind: "blank" }
  | { readonly kind: "workspace"; readonly locator: WorkspaceResourceLocator }
  | { readonly kind: "web"; readonly url: string }
  | { readonly kind: "invalid" };

const WorkspaceTabIdPrefix = "workspace-tab";
const HttpProtocolPattern = /^https?:\/\//iu;
const ProtocolRelativePattern = /^\/\/[^/]/u;
const LocalHostPattern = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/iu;
const HostPortPattern = /^[^\s/:]+:\d+(?:\/|$)/u;
const UriSchemePattern = /^[a-z][a-z0-9+.-]*:/iu;
const WindowsAbsolutePathPattern = /^[a-z]:[\\/]/iu;

export function createWorkspaceTabId(sequence: number): string {
  return `${WorkspaceTabIdPrefix}-${sequence}`;
}

export function createInitialWorkspaceTabState(tabId: string): WorkspaceTabState {
  const tab = createBlankWorkspaceTab(tabId);
  return { tabs: [tab], activeTabId: tab.id };
}

export function createBlankWorkspaceTab(id: string): WorkspaceTab {
  return {
    id,
    title: "",
    history: [{ kind: "blank" }],
    historyIndex: 0,
    reloadToken: 0,
  };
}

export function createWorkspaceTab(id: string, locator: WorkspaceResourceLocator): WorkspaceTab {
  return createTabWithEntry(id, workspaceTabEntryForLocator(locator));
}

export function createWebWorkspaceTab(id: string, url: string): WorkspaceTab {
  return createTabWithEntry(id, { kind: "web", url });
}

export function createPreviewWorkspaceTab(id: string, resource: WorkspacePreviewResource): WorkspaceTab {
  return createTabWithEntry(id, { kind: "preview", resource });
}

export function workspaceTabEntryForLocator(locator: WorkspaceResourceLocator): WorkspaceTabEntry {
  return {
    kind: "workspace",
    path: normalizeWorkspacePath(locator.path),
    ...(locator.line ? { line: locator.line } : {}),
    ...(locator.column ? { column: locator.column } : {}),
  };
}

export function readWorkspaceTabEntry(tab: WorkspaceTab): WorkspaceTabEntry {
  return tab.history[tab.historyIndex] ?? { kind: "blank" };
}

export function readWorkspaceTabLocator(tab: WorkspaceTab): WorkspaceResourceLocator | undefined {
  const entry = readWorkspaceTabEntry(tab);
  if (entry.kind !== "workspace") return undefined;
  return {
    path: entry.path,
    ...(entry.line ? { line: entry.line } : {}),
    ...(entry.column ? { column: entry.column } : {}),
  };
}

export function readWorkspaceTabUrl(tab: WorkspaceTab): string | undefined {
  const entry = readWorkspaceTabEntry(tab);
  return entry.kind === "web" ? entry.url : undefined;
}

export function readWorkspaceTabAddress(tab: WorkspaceTab): string {
  const entry = readWorkspaceTabEntry(tab);
  if (entry.kind === "preview") return entry.resource.name;
  if (entry.kind === "workspace") {
    return formatWorkspaceResourceLocation({
      path: entry.path,
      ...(entry.line ? { line: entry.line } : {}),
      ...(entry.column ? { column: entry.column } : {}),
    });
  }
  return entry.kind === "web" ? entry.url : "";
}

export function navigateWorkspaceTab(tab: WorkspaceTab, entry: WorkspaceTabEntry): WorkspaceTab {
  if (sameWorkspaceTabEntry(readWorkspaceTabEntry(tab), entry)) return tab;
  const current = readWorkspaceTabEntry(tab);
  const base = current.kind === "blank" ? [] : tab.history.slice(0, tab.historyIndex + 1);
  const history = [...base, entry];
  return {
    ...tab,
    title: readWorkspaceTabEntryTitle(entry),
    favicon: undefined,
    history,
    historyIndex: history.length - 1,
  };
}

/** Applies a page-reported title; empty reports keep the navigated fallback. */
export function updateWorkspaceTabTitle(tab: WorkspaceTab, title: string): WorkspaceTab {
  const next = title.trim();
  if (!next || next === tab.title) return tab;
  return { ...tab, title: next };
}

/** A late event from the previous document must not change the current site's identity. */
export function updateWorkspaceTabFavicon(tab: WorkspaceTab, pageUrl: string, value: string): WorkspaceTab {
  if (readWorkspaceTabUrl(tab) !== pageUrl) return tab;
  const favicon = readWorkspaceWebsiteIcon(value, pageUrl);
  return !favicon || favicon === tab.favicon ? tab : { ...tab, favicon };
}

export function syncWorkspaceTabPath(tab: WorkspaceTab, path: string): WorkspaceTab {
  const normalized = normalizeWorkspacePath(path);
  const entry = readWorkspaceTabEntry(tab);
  if (entry.kind === "workspace" && normalizeWorkspacePath(entry.path) === normalized) return tab;
  return navigateWorkspaceTab(tab, { kind: "workspace", path: normalized });
}

export function stepWorkspaceTabHistory(tab: WorkspaceTab, delta: number): WorkspaceTab {
  const index = Math.min(tab.history.length - 1, Math.max(0, tab.historyIndex + delta));
  return index === tab.historyIndex ? tab : { ...tab, historyIndex: index, favicon: undefined };
}

export function reloadWorkspaceTab(tab: WorkspaceTab): WorkspaceTab {
  return { ...tab, reloadToken: tab.reloadToken + 1 };
}

export function openWorkspaceTabInTabs(
  tabs: readonly WorkspaceTab[],
  activeTabId: string,
  tab: WorkspaceTab,
): { readonly tabs: readonly WorkspaceTab[]; readonly activeTabId: string } {
  const key = readWorkspaceTabResourceKey(readWorkspaceTabEntry(tab));
  const existing = key
    ? tabs.find((candidate) => readWorkspaceTabResourceKey(readWorkspaceTabEntry(candidate)) === key)
    : undefined;
  if (existing) return { tabs, activeTabId: existing.id };
  const activeTab = key ? tabs.find((candidate) => candidate.id === activeTabId) : undefined;
  if (activeTab && readWorkspaceTabEntry(activeTab).kind === "blank") {
    return {
      tabs: tabs.map((candidate) =>
        candidate.id === activeTab.id ? navigateWorkspaceTab(candidate, readWorkspaceTabEntry(tab)) : candidate,
      ),
      activeTabId: activeTab.id,
    };
  }
  return { tabs: [...tabs, tab], activeTabId: tab.id };
}

export function closeWorkspaceTab(
  tabs: readonly WorkspaceTab[],
  activeTabId: string,
  closingTabId: string,
): { readonly tabs: readonly WorkspaceTab[]; readonly activeTabId: string } {
  const index = tabs.findIndex((tab) => tab.id === closingTabId);
  if (index < 0) return { tabs, activeTabId };
  const remaining = tabs.filter((tab) => tab.id !== closingTabId);
  if (remaining.length === 0) return { tabs: remaining, activeTabId: "" };
  if (activeTabId !== closingTabId) return { tabs: remaining, activeTabId };
  return { tabs: remaining, activeTabId: remaining[Math.min(index, remaining.length - 1)]!.id };
}

export function parseWorkspaceAddress(value: string): WorkspaceAddressTarget {
  const source = value.trim();
  if (!source) return { kind: "blank" };
  const url = readWebUrl(source);
  if (url) return { kind: "web", url };
  if (HttpProtocolPattern.test(source) || ProtocolRelativePattern.test(source)) return { kind: "invalid" };
  if (UriSchemePattern.test(source) && !WindowsAbsolutePathPattern.test(source)) return { kind: "invalid" };
  const locator = parseWorkspaceResourceLocator(source) ?? { path: normalizeWorkspacePath(source) };
  return {
    kind: "workspace",
    locator: {
      ...locator,
      path: normalizeWorkspacePath(locator.path.replace(/^\/+/u, "")),
    },
  };
}

function createTabWithEntry(id: string, entry: WorkspaceTabEntry): WorkspaceTab {
  return {
    id,
    title: readWorkspaceTabEntryTitle(entry),
    history: [entry],
    historyIndex: 0,
    reloadToken: 0,
  };
}

function readWorkspaceTabEntryTitle(entry: WorkspaceTabEntry): string {
  if (entry.kind === "preview") return entry.resource.name;
  if (entry.kind === "workspace") return entry.path.split("/").at(-1) ?? entry.path;
  if (entry.kind === "web") {
    try {
      return new URL(entry.url).hostname || entry.url;
    } catch {
      return entry.url;
    }
  }
  return "";
}

function readWorkspaceTabResourceKey(entry: WorkspaceTabEntry): string | File | undefined {
  if (entry.kind === "preview")
    return entry.resource.file ?? (entry.resource.source ? `preview:${entry.resource.source}` : undefined);
  if (entry.kind === "workspace") return `workspace:${normalizeWorkspacePath(entry.path)}`;
  if (entry.kind === "web") return `web:${entry.url}`;
  return undefined;
}

function sameWorkspaceTabEntry(left: WorkspaceTabEntry, right: WorkspaceTabEntry): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "workspace" && right.kind === "workspace") {
    return left.path === right.path && left.line === right.line && left.column === right.column;
  }
  if (left.kind === "web" && right.kind === "web") return left.url === right.url;
  if (left.kind === "preview" && right.kind === "preview") return left.resource === right.resource;
  return true;
}

function readWebUrl(source: string): string | undefined {
  const candidate = HttpProtocolPattern.test(source)
    ? source
    : LocalHostPattern.test(source) || HostPortPattern.test(source)
      ? `http://${source}`
      : undefined;
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
