import { defaultSettingsSectionId, isSettingsSectionId, type SettingsSectionId } from "../features/settings/types";

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

export function resolveSettingsSection(location: Pick<Location, "hash" | "search">): SettingsSectionId {
  const search = new URLSearchParams(location.search);
  const overlaySection = search.get("settings");
  if (isSettingsSectionId(overlaySection)) return overlaySection;

  const querySection = search.get("section");
  if (isSettingsSectionId(querySection)) return querySection;

  const hash = location.hash.replace(/^#\/?/, "");
  const [, hashSection] = hash.split("/");
  if (isSettingsSectionId(hashSection)) return hashSection;

  return defaultSettingsSectionId;
}

export function readWebSettingsSection(location: Pick<Location, "hash" | "search">): SettingsSectionId | null {
  const search = new URLSearchParams(location.search);
  const overlaySection = search.get("settings");
  if (overlaySection !== null) {
    return isSettingsSectionId(overlaySection) ? overlaySection : defaultSettingsSectionId;
  }

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
  if (section) search.set("settings", section);
  else search.delete("settings");

  const query = search.toString();
  return `${location.pathname ?? ""}${query ? `?${query}` : ""}${stripLegacySettingsHash(location.hash)}`;
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
