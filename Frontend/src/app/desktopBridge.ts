import { defaultSettingsSectionId, type SettingsSectionId } from "../features/settings/types";

export interface OpenDesktopSettingsOptions {
  section?: SettingsSectionId;
}

export interface DesktopWindowState {
  isMaximized: boolean;
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
  onSettingsCloseRequested?: (listener: () => void) => () => void;
  confirmSettingsClose?: () => Promise<void>;
  cancelSettingsClose?: () => Promise<void>;
  openExternalUrl?: (url: string) => Promise<void>;
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
