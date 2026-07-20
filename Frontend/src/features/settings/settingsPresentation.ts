import type { ConfigFormSectionData, PluginConfigItem } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { isSettingsSectionId, type SettingsSectionDefinition, type SettingsSectionId } from "./types";

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

export type SettingsSearchEntryKind = "field" | "skill" | "tool";

export interface SettingsSearchEntry {
  sectionId: SettingsSectionId;
  kind: SettingsSearchEntryKind;
  label: string;
  searchText?: string;
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
  defineSettingsSectionGroup("system", "settings.group.system", ["storage", "about"]),
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
  entries: readonly SettingsSearchEntry[] = [],
): SettingsSectionSearchResult[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return sections.map((section) => ({ section, details: [] }));
  }

  return sections.flatMap((section) => {
    const group = readSettingsSectionGroup(section.id);
    const sectionEntries = entries.filter((entry) => entry.sectionId === section.id);
    const searchable = [
      section.label,
      section.description,
      section.id,
      group.label,
      ...sectionEntries.flatMap((entry) => [entry.label, entry.searchText ?? ""]),
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (!tokens.every((token) => searchable.includes(token))) return [];

    const details: SettingsSectionSearchDetail[] = [];
    const matchingEntry = sectionEntries.find((entry) =>
      tokens.every((token) => [entry.label, entry.searchText ?? ""].join(" ").toLocaleLowerCase().includes(token)),
    );
    if (matchingEntry) {
      details.push({
        label: frontendMessage(readSettingsSearchEntryLabelKey(matchingEntry.kind)),
        value: matchingEntry.label,
      });
    } else if (tokens.some((token) => section.description.toLocaleLowerCase().includes(token))) {
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

export function createSettingsSearchEntries(
  configSections: readonly ConfigFormSectionData[] = [],
  plugins: readonly PluginConfigItem[] = [],
): SettingsSearchEntry[] {
  const entries: SettingsSearchEntry[] = [];

  for (const section of configSections) {
    const sectionId =
      section.name === "models" ? "model-service" : isSettingsSectionId(section.name) ? section.name : null;
    if (!sectionId) continue;
    for (const field of section.fields) {
      entries.push({
        sectionId,
        kind: "field",
        label: field.label,
        searchText: [field.key, field.path.join(" "), field.description ?? ""].join(" "),
      });
    }
  }

  for (const plugin of plugins) {
    const pluginSearchText = [plugin.name, plugin.title, plugin.description ?? ""].join(" ");
    entries.push({
      sectionId: "skills",
      kind: "skill",
      label: plugin.title || plugin.name,
      searchText: pluginSearchText,
    });
    for (const section of plugin.sections) {
      for (const field of section.fields) {
        entries.push({
          sectionId: "skills",
          kind: "field",
          label: field.label,
          searchText: [pluginSearchText, field.key, field.path.join(" "), field.description ?? ""].join(" "),
        });
      }
    }
    for (const tool of plugin.tools) {
      entries.push({
        sectionId: "skills",
        kind: "tool",
        label: tool.name,
        searchText: [pluginSearchText, tool.name, tool.summary ?? ""].join(" "),
      });
    }
  }

  return entries;
}

function readSettingsSearchEntryLabelKey(
  kind: SettingsSearchEntryKind,
): "settings.search.field" | "settings.search.skill" | "settings.search.tool" {
  if (kind === "field") return "settings.search.field";
  if (kind === "skill") return "settings.search.skill";
  return "settings.search.tool";
}
