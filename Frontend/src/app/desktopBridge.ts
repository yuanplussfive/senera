import { defaultSettingsSectionId, type SettingsSectionId } from "../features/settings/types";

const migratedSettingsSections = [
  "model-service",
  "default-model",
  "system",
  "runtime",
  "planning",
  "retrieval",
  "storage",
  "general",
  "appearance",
  "skills",
  "about",
] as const satisfies readonly SettingsSectionId[];

export type MigratedSettingsSectionId = (typeof migratedSettingsSections)[number];

export interface OpenDesktopSettingsOptions {
  section?: SettingsSectionId;
}

export interface SeneraDesktopBridge {
  readonly isDesktop: boolean;
  openSettings: (options?: OpenDesktopSettingsOptions) => Promise<void>;
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

export function isMigratedSettingsSection(
  section: SettingsSectionId | undefined,
): section is MigratedSettingsSectionId {
  return migratedSettingsSections.includes(section as MigratedSettingsSectionId);
}

export interface OpenSettingsSurfaceOptions {
  bridge?: Pick<SeneraDesktopBridge, "isDesktop" | "openSettings">;
  fallback: () => void;
  section?: SettingsSectionId;
  location?: Pick<Location, "assign">;
}

export async function openSettingsSurface({
  bridge = readDesktopBridge(),
  fallback,
  section = defaultSettingsSectionId,
  location = typeof window === "undefined" ? undefined : window.location,
}: OpenSettingsSurfaceOptions): Promise<"desktop" | "web" | "fallback"> {
  if (!isMigratedSettingsSection(section)) {
    fallback();
    return "fallback";
  }

  if (bridge?.isDesktop) {
    try {
      await bridge.openSettings({ section });
      return "desktop";
    } catch {
      fallback();
      return "fallback";
    }
  }

  if (location) {
    location.assign(`?surface=settings&section=${encodeURIComponent(section)}`);
    return "web";
  }

  fallback();
  return "fallback";
}

export async function openDesktopSettingsOrFallback(
  options: OpenSettingsSurfaceOptions,
): Promise<"desktop" | "web" | "fallback"> {
  return openSettingsSurface(options);
}
