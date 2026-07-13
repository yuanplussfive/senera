import { isSettingsSectionId, type SettingsSectionId } from "../features/settings/types";

export type AppSurface = "main" | "settings";

export function resolveAppSurface(location: Pick<Location, "hash" | "search">): AppSurface {
  const search = new URLSearchParams(location.search);
  const surface = search.get("surface") ?? search.get("view");
  if (surface === "settings") return "settings";

  const hash = location.hash.replace(/^#\/?/, "");
  return hash === "settings" || hash.startsWith("settings/") ? "settings" : "main";
}

export function resolveSettingsSection(location: Pick<Location, "hash" | "search">): SettingsSectionId {
  const search = new URLSearchParams(location.search);
  const querySection = search.get("section");
  if (isSettingsSectionId(querySection)) return querySection;

  const hash = location.hash.replace(/^#\/?/, "");
  const [, hashSection] = hash.split("/");
  if (isSettingsSectionId(hashSection)) return hashSection;

  return "general";
}
