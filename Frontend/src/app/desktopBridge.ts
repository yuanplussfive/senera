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
