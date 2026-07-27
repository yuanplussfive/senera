import {
  defaultSettingsSectionId,
  isSettingsSectionId,
  type SettingsSectionId,
} from "../features/settings/settingsSectionContract";

export type AppSurface = "main" | "settings";
export const settingsHistoryStateKey = "seneraSettingsOverlay";

export interface SettingsLocationLike {
  hash: string;
  pathname?: string;
  search: string;
}

export function resolveAppSurface(location: Pick<Location, "hash" | "search">, isDesktop = false): AppSurface {
  if (!isDesktop) return "main";
  const search = new URLSearchParams(location.search);
  const surface = search.get("surface") ?? search.get("view");
  if (surface === "settings") return "settings";

  const hash = location.hash.replace(/^#\/?/, "");
  return hash === "settings" || hash.startsWith("settings/") ? "settings" : "main";
}

export function resolveSettingsSection(location: SettingsLocationLike): SettingsSectionId {
  const search = new URLSearchParams(location.search);
  const overlaySection = search.get("settings");
  if (isSettingsSectionId(overlaySection)) return overlaySection;

  const querySection = search.get("section");
  if (isSettingsSectionId(querySection)) return querySection;

  const pathSection = readSettingsPath(location.pathname);
  if (pathSection.matched) return pathSection.section;

  const hash = location.hash.replace(/^#\/?/, "");
  const [, hashSection] = hash.split("/");
  if (isSettingsSectionId(hashSection)) return hashSection;

  return defaultSettingsSectionId;
}

export function readWebSettingsSection(location: SettingsLocationLike): SettingsSectionId | null {
  const search = new URLSearchParams(location.search);
  const overlaySection = search.get("settings");
  if (overlaySection !== null) {
    return isSettingsSectionId(overlaySection) ? overlaySection : defaultSettingsSectionId;
  }

  const pathSection = readSettingsPath(location.pathname);
  if (pathSection.matched) return pathSection.section;

  const legacySurface = search.get("surface") ?? search.get("view");
  const hash = location.hash.replace(/^#\/?/, "");
  if (legacySurface === "settings" || hash === "settings" || hash.startsWith("settings/")) {
    return resolveSettingsSection(location);
  }
  return null;
}

export function buildWebSettingsLocation(location: SettingsLocationLike, section: SettingsSectionId | null): string {
  const search = new URLSearchParams(location.search);
  search.delete("surface");
  search.delete("view");
  search.delete("section");
  const pathSection = readSettingsPath(location.pathname);
  if (pathSection.matched) {
    search.delete("settings");
    return buildLocation(section ? `/settings/${section}` : "/", search, stripLegacySettingsHash(location.hash));
  }

  if (section) {
    search.set("settings", section);
  } else {
    search.delete("settings");
  }

  return buildLocation(location.pathname ?? "", search, stripLegacySettingsHash(location.hash));
}

export function createSettingsHistoryState(current: unknown): Record<string, unknown> {
  const base = current && typeof current === "object" ? (current as Record<string, unknown>) : {};
  return { ...base, [settingsHistoryStateKey]: true };
}

export function isSettingsHistoryState(state: unknown): boolean {
  return Boolean(
    state && typeof state === "object" && (state as Record<string, unknown>)[settingsHistoryStateKey] === true,
  );
}

function stripLegacySettingsHash(hash: string): string {
  const normalized = hash.replace(/^#\/?/, "");
  return normalized === "settings" || normalized.startsWith("settings/") ? "" : hash;
}

function readSettingsPath(pathname: string | undefined): { matched: boolean; section: SettingsSectionId } {
  const segments = (pathname ?? "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (segments[0] !== "settings") return { matched: false, section: defaultSettingsSectionId };
  return {
    matched: true,
    section: isSettingsSectionId(segments[1]) ? segments[1] : defaultSettingsSectionId,
  };
}

function buildLocation(pathname: string, search: URLSearchParams, hash: string): string {
  const query = search.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}
