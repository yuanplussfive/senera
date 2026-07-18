import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { SettingsSectionDefinition, SettingsSectionId } from "./types";

export type SettingsSectionGroupId = "model" | "capabilities" | "personal" | "system";

export interface SettingsSectionGroupDefinition {
  id: SettingsSectionGroupId;
  label: string;
  sectionIds: readonly SettingsSectionId[];
}

export interface SettingsSectionSearchDetail {
  label: string;
  value: string;
}

export interface SettingsSectionSearchResult {
  section: SettingsSectionDefinition;
  details: SettingsSectionSearchDetail[];
}

export interface GroupedSettingsSectionSearchResult {
  group: SettingsSectionGroupDefinition;
  results: SettingsSectionSearchResult[];
}

export const settingsSectionGroups = [
  defineSettingsSectionGroup("model", "settings.group.model", ["model-service", "default-model"]),
  defineSettingsSectionGroup("capabilities", "settings.group.capabilities", [
    "runtime",
    "planning",
    "retrieval",
    "skills",
  ]),
  defineSettingsSectionGroup("personal", "settings.group.personal", ["general", "appearance"]),
  defineSettingsSectionGroup("system", "settings.group.system", ["system", "storage", "about"]),
] as const satisfies readonly SettingsSectionGroupDefinition[];

function defineSettingsSectionGroup(
  id: SettingsSectionGroupId,
  labelKey: Parameters<typeof frontendMessage>[0],
  sectionIds: readonly SettingsSectionId[],
): SettingsSectionGroupDefinition {
  return {
    id,
    get label() {
      return frontendMessage(labelKey);
    },
    sectionIds,
  };
}

export function searchSettingsSections(
  sections: readonly SettingsSectionDefinition[],
  query: string,
): SettingsSectionDefinition[] {
  return searchSettingsSectionResults(sections, query).map((result) => result.section);
}

export function searchSettingsSectionResults(
  sections: readonly SettingsSectionDefinition[],
  query: string,
): SettingsSectionSearchResult[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return sections.map((section) => ({ section, details: [] }));
  }

  return sections.flatMap((section) => {
    const group = readSettingsSectionGroup(section.id);
    const searchable = [section.label, section.description, section.id, group.label].join(" ").toLocaleLowerCase();
    if (!tokens.every((token) => searchable.includes(token))) return [];

    const details: SettingsSectionSearchDetail[] = [];
    if (tokens.some((token) => section.description.toLocaleLowerCase().includes(token))) {
      details.push({ label: frontendMessage("settings.search.detail"), value: section.description });
    } else if (tokens.some((token) => group.label.toLocaleLowerCase().includes(token))) {
      details.push({ label: frontendMessage("settings.search.groupDetail"), value: group.label });
    }
    return [{ section, details }];
  });
}

export function groupSettingsSectionResults(
  results: readonly SettingsSectionSearchResult[],
): GroupedSettingsSectionSearchResult[] {
  const byId = new Map(results.map((result) => [result.section.id, result]));
  return settingsSectionGroups.flatMap((group) => {
    const groupResults = group.sectionIds.flatMap((sectionId) => {
      const result = byId.get(sectionId);
      return result ? [result] : [];
    });
    return groupResults.length > 0 ? [{ group, results: groupResults }] : [];
  });
}

export function readSettingsSectionGroup(sectionId: SettingsSectionId): SettingsSectionGroupDefinition {
  return (
    settingsSectionGroups.find((group) => (group.sectionIds as readonly SettingsSectionId[]).includes(sectionId)) ??
    settingsSectionGroups[0]
  );
}
