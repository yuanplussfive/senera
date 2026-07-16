import { defaultSettingsSectionId, type SettingsSectionId } from "../features/settings/types";

export interface OpenDesktopSettingsOptions {
  section?: SettingsSectionId;
}

export interface DesktopTitleBarOverlay {
  color: string;
  symbolColor: string;
}

export interface SeneraDesktopBridge {
  readonly isDesktop: boolean;
  openSettings: (options?: OpenDesktopSettingsOptions) => Promise<void>;
  setTitleBarOverlay?: (overlay: DesktopTitleBarOverlay) => Promise<void>;
  setSettingsDirty?: (dirty: boolean) => Promise<void>;
  onSettingsCloseRequested?: (listener: () => void) => () => void;
  confirmSettingsClose?: () => Promise<void>;
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
