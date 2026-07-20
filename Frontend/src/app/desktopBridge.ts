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
  openExternalUrl: (url: string) => Promise<void>;
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
  if (bridge?.isDesktop) {
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
