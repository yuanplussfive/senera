import { defaultSettingsSectionId, type SettingsSectionId } from "../features/settings/types";

export interface OpenDesktopSettingsOptions {
  section?: SettingsSectionId;
}

export interface DesktopWindowState {
  isMaximized: boolean;
}

export interface DesktopUpdateSnapshot {
  state: "unsupported" | "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string;
  releaseDate?: string;
  percent?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface DesktopExternalOpenResult {
  readonly ok: boolean;
  readonly code?: "blocked" | "invalid-payload" | "write-failed" | "open-failed";
}

export interface SeneraDesktopBridge {
  readonly isDesktop: boolean;
  readonly windowControls?: "custom" | "native";
  openSettings: (options?: OpenDesktopSettingsOptions) => Promise<void>;
  minimizeWindow?: () => Promise<void>;
  toggleMaximizeWindow?: () => Promise<DesktopWindowState | undefined>;
  closeWindow?: () => Promise<void>;
  getWindowState?: () => Promise<DesktopWindowState | undefined>;
  onWindowStateChanged?: (listener: (state: DesktopWindowState) => void) => () => void;
  setSettingsDirty?: (dirty: boolean) => Promise<void>;
  notifySettingsSurfaceReady?: () => Promise<void>;
  onSettingsNavigationRequested?: (listener: (section: SettingsSectionId) => void) => () => void;
  onSettingsCloseRequested?: (listener: () => void) => () => void;
  confirmSettingsClose?: () => Promise<void>;
  cancelSettingsClose?: () => Promise<void>;
  openExternalUrl?: (url: string) => Promise<void>;
  openFileExternally?: (payload: { name: string; bytes: Uint8Array }) => Promise<DesktopExternalOpenResult | undefined>;
  chooseWorkspaceFolder?: () => Promise<string | null>;
  onWorkspaceFolderRequested?: (listener: () => void) => () => void;
  getUpdateState?: () => Promise<DesktopUpdateSnapshot | undefined>;
  checkForUpdates?: () => Promise<DesktopUpdateSnapshot | undefined>;
  downloadUpdate?: () => Promise<DesktopUpdateSnapshot | undefined>;
  installUpdate?: () => Promise<DesktopUpdateSnapshot | undefined>;
  onUpdateStateChanged?: (listener: (state: DesktopUpdateSnapshot) => void) => () => void;
}

export interface OpenExternalUrlOptions {
  bridge?: Pick<SeneraDesktopBridge, "isDesktop" | "openExternalUrl">;
  openWindow?: (url: string) => Window | null;
}

export async function openExternalUrl(
  url: string,
  {
    bridge = readDesktopBridge(),
    openWindow = (target) => window.open(target, "_blank", "noopener,noreferrer"),
  }: OpenExternalUrlOptions = {},
): Promise<"desktop" | "web" | "blocked"> {
  if (!isSafeExternalUrl(url)) return "blocked";
  if (bridge?.isDesktop && bridge.openExternalUrl) {
    try {
      await bridge.openExternalUrl(url);
      return "desktop";
    } catch {
      return "blocked";
    }
  }
  return openWindow(url) ? "web" : "blocked";
}

/**
 * Opens a rendered resource in the operating system's default application. The
 * bytes are fetched through the page's authenticated session, so the desktop main
 * process never needs the resource URL, a workspace path, or network access.
 *
 * Returns `unsupported` outside the desktop app, where the download path stays the
 * only way to hand a file to a local application.
 */
export async function openFileWithDefaultApp(
  input: { name: string; source: string },
  {
    bridge = readDesktopBridge(),
    fetchBytes = readSourceBytes,
  }: {
    bridge?: Pick<SeneraDesktopBridge, "isDesktop" | "openFileExternally">;
    fetchBytes?: (source: string) => Promise<Uint8Array>;
  } = {},
): Promise<"desktop" | "unsupported" | "failed"> {
  if (!bridge?.isDesktop || !bridge.openFileExternally) return "unsupported";
  let bytes: Uint8Array;
  try {
    bytes = await fetchBytes(input.source);
  } catch {
    return "failed";
  }
  try {
    const result = await bridge.openFileExternally({ name: input.name, bytes });
    return result?.ok ? "desktop" : "failed";
  } catch {
    return "failed";
  }
}

async function readSourceBytes(source: string): Promise<Uint8Array> {
  const response = await fetch(source, { credentials: "include" });
  if (!response.ok) throw new Error(`External open source failed with status ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

function isSafeExternalUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1" || /^127\./.test(hostname);
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    seneraDesktop?: SeneraDesktopBridge;
  }
}

export function readDesktopBridge(): SeneraDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.seneraDesktop;
}

export async function openDesktopSettings({
  bridge = readDesktopBridge(),
  section = defaultSettingsSectionId,
}: {
  bridge?: Pick<SeneraDesktopBridge, "isDesktop" | "openSettings">;
  section?: SettingsSectionId;
} = {}): Promise<boolean> {
  if (!bridge?.isDesktop) return false;
  await bridge.openSettings({ section });
  return true;
}
