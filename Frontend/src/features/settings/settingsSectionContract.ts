export const settingsSectionIds = [
  "model-service",
  "default-model",
  "runtime",
  "planning",
  "retrieval",
  "system-tools",
  "mcp-servers",
  "general",
  "appearance",
  "storage",
  "about",
] as const;

export type SettingsSectionId = (typeof settingsSectionIds)[number];

export const defaultSettingsSectionId: SettingsSectionId = settingsSectionIds[0];

export function isSettingsSectionId(value: string | null | undefined): value is SettingsSectionId {
  return settingsSectionIds.some((sectionId) => sectionId === value);
}
