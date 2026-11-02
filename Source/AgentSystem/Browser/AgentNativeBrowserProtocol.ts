import { sha256Hex } from "../Core/AgentHash.js";
import { AgentNativeBrowserCommandError } from "./AgentNativeBrowserCommand.js";
import { AgentBrowserComputerActionTypes, type AgentBrowserComputerAction } from "./AgentBrowserTypes.js";

export function readBrowserCdpUrl(value: unknown): string {
  const cdpUrl = recordValue(value, "cdpUrl");
  if (typeof cdpUrl !== "string" || !cdpUrl.trim()) {
    throw new Error("agent-browser did not return a browser CDP endpoint.");
  }
  return cdpUrl.trim();
}

/**
 * A navigation command can reach the daemon while its response is lost at the
 * CLI transport boundary. The operation must never be repeated automatically:
 * inspect browser state instead.
 */
export function isUncertainBrowserNavigation(error: unknown): boolean {
  return (
    error instanceof AgentNativeBrowserCommandError &&
    (error.commandCode === "outcome_unknown" || error.commandCode === "timeout")
  );
}

export function navigationBudgetError(): AgentNativeBrowserCommandError {
  return new AgentNativeBrowserCommandError(
    "The controlled browser did not confirm the navigation before the operation timeout. Do not repeat it automatically; inspect the current page or wait for a concrete page condition.",
    "navigation_unconfirmed",
  );
}

export function isBrowserTabGoneFailure(error: unknown): boolean {
  return (
    error instanceof AgentNativeBrowserCommandError &&
    (error.commandCode === "tab_gone" || /bound tab is gone/iu.test(error.message))
  );
}

/**
 * The agent-browser CLI reports a daemon that exited mid-command without a
 * protocol response. Serving `close` tears the daemon down, so losing that
 * response is the expected end of the session rather than a failed close.
 */
export function isBrowserDaemonResponseLoss(error: unknown): boolean {
  return (
    error instanceof AgentNativeBrowserCommandError && /no response came back|EOF while parsing/iu.test(error.message)
  );
}

export function isRetryableBrowserWaitFailure(error: unknown): boolean {
  if (!(error instanceof AgentNativeBrowserCommandError)) return false;
  return (
    error.commandCode === "outcome_unknown" || error.commandCode === "timeout" || /Wait timed out/iu.test(error.message)
  );
}

export function isRetryableBrowserReadFailure(error: unknown): boolean {
  return isUncertainBrowserNavigation(error);
}

export function browserNavigationCommitted(
  currentUrl: string,
  targetUrl: string | undefined,
  previousUrl: string,
): boolean {
  if (targetUrl && browserUrlsMatch(currentUrl, targetUrl)) return true;
  return currentUrl !== previousUrl && currentUrl !== "about:blank";
}

function browserUrlsMatch(currentUrl: string, targetUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    const normalize = (url: URL): string => `${url.origin}${url.pathname.replace(/\/$/u, "")}${url.search}`;
    return normalize(current) === normalize(target);
  } catch {
    return currentUrl === targetUrl;
  }
}

export function snapshotArguments(input: Readonly<Record<string, unknown>>): string[] {
  const args: string[] = [];
  if (input.interactive === true) args.push("-i");
  if (input.includeUrls === true) args.push("--urls");
  if (input.compact === true) args.push("-c");
  if (typeof input.depth === "number") args.push("-d", String(input.depth));
  if (typeof input.selector === "string" && input.selector) args.push("-s", input.selector);
  return args;
}

export function clickArguments(input: Readonly<Record<string, unknown>>): string[] {
  const args = ["click", requiredString(input, "selector")];
  if (input.newTab === true) args.push("--new-tab");
  return args;
}

export function agentBrowserRoutePattern(domainPattern: string): string {
  const hostPattern = domainPattern === "*" ? "**" : domainPattern;
  return `**://${hostPattern}/**`;
}

export function pageFromData(value: unknown): { url: string; title: string } | undefined {
  const url = recordValue(value, "url");
  const title = recordValue(value, "title");
  return typeof url === "string" && typeof title === "string" ? { url, title } : undefined;
}

export function pageDescription(value: unknown): string {
  const page = pageFromData(value);
  return page ? `${page.title}\n${page.url}` : "Opened browser page.";
}

export interface AgentBrowserTab {
  readonly targetId: string;
  readonly tabId?: string;
  readonly label?: string;
  readonly active: boolean;
  readonly title?: string;
  readonly url?: string;
}

export function browserTargetId(value: unknown): string | undefined {
  const targetId = recordValue(value, "targetId");
  return typeof targetId === "string" && targetId ? targetId : undefined;
}

export function browserTabs(value: unknown): readonly AgentBrowserTab[] {
  const entries = recordValue(value, "tabs");
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const targetId = browserTargetId(entry);
    if (!targetId) return [];
    const record = asRecord(entry);
    return [
      {
        targetId,
        ...(typeof record.tabId === "string" && record.tabId ? { tabId: record.tabId } : {}),
        ...(typeof record.label === "string" && record.label ? { label: record.label } : {}),
        active: record.active === true,
        ...(typeof record.title === "string" ? { title: record.title } : {}),
        ...(typeof record.url === "string" ? { url: record.url } : {}),
      },
    ];
  });
}

export function onlyNewBrowserTabTarget(
  previousTargetIds: ReadonlySet<string>,
  tabs: readonly AgentBrowserTab[],
): string | undefined {
  const candidates = tabs.filter((tab) => !previousTargetIds.has(tab.targetId));
  return candidates.length === 1 ? candidates[0]!.targetId : undefined;
}

export function browserTabMatches(tab: AgentBrowserTab, reference: string): boolean {
  return reference === tab.targetId || reference === tab.tabId || reference === tab.label;
}

export function tabListContent(value: unknown): string {
  const tabs = recordValue(value, "tabs");
  if (!Array.isArray(tabs)) return "No controlled browser tabs are open.";
  return tabs
    .map((tab) => {
      const entry = asRecord(tab);
      const active = entry.active === true ? "* " : "";
      return `${active}${String(entry.tabId ?? entry.targetId ?? "tab")}: ${String(entry.title ?? "")} ${String(entry.url ?? "")}`.trim();
    })
    .join("\n");
}

export function validateComputerAction(value: unknown): AgentBrowserComputerAction {
  if (!value || typeof value !== "object") throw new Error("Computer action must be an object.");
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !AgentBrowserComputerActionTypes.includes(type as never)) {
    throw new Error(`Unsupported browser computer action: ${String(type)}.`);
  }
  return value as AgentBrowserComputerAction;
}

export function assertNoModifiers(action: { readonly modifiers?: readonly string[] }): void {
  if (action.modifiers?.length)
    throw new Error("agent-browser mouse actions do not support modifier keys in this operation.");
}

export function requiredString(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(`Browser operation requires ${key}.`);
  return value;
}

export function requiredPositiveNumber(input: Readonly<Record<string, unknown>>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Browser operation requires ${key} as a positive number.`);
  }
  return value;
}

export function requiredPositiveInteger(input: Readonly<Record<string, unknown>>, key: string): number {
  const value = requiredPositiveNumber(input, key);
  if (!Number.isInteger(value)) throw new Error(`Browser operation requires ${key} as a positive integer.`);
  return value;
}

export function requiredStringArray(input: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`Browser operation requires ${key} as strings.`);
  return value as string[];
}

export function optionalString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value ? value : undefined;
}

export function optionalBoolean(input: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  return typeof input[key] === "boolean" ? (input[key] as boolean) : undefined;
}

export function optionalNumber(input: Readonly<Record<string, unknown>>, key: string): number | undefined {
  return typeof input[key] === "number" && Number.isFinite(input[key]) ? (input[key] as number) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function recordValue(value: unknown, key: string): unknown {
  return asRecord(value)[key];
}

export function stringValue(value: unknown, key: string): string {
  const candidate = recordValue(value, key);
  if (typeof candidate === "string") return candidate;
  if (candidate !== undefined) return JSON.stringify(candidate);
  if (typeof value === "string") return value;
  return "Browser operation completed.";
}

export function renderedHtmlSignature(value: string): string {
  return sha256Hex(value.replace(/\s+/gu, " ").trim());
}
