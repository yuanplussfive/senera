import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import type { AppIconName } from "../../shared/ui/AppIcon";
import type { SettingsSectionId } from "./settingsSectionContract";

export {
  defaultSettingsSectionId,
  isSettingsSectionId,
  settingsSectionIds,
  type SettingsSectionId,
} from "./settingsSectionContract";

export interface SettingsSectionDefinition {
  id: CanonicalSettingsSectionId;
  label: string;
  icon: AppIconName;
  description: string;
  headerMode: SettingsSectionHeaderMode;
}

export type SettingsSectionHeaderMode = "global" | "local" | "none";

const retiredSectionTargets = {
  "mcp-servers": "system-tools",
  workspace: "storage",
} as const;

type RetiredSettingsSectionId = keyof typeof retiredSectionTargets;

export type CanonicalSettingsSectionId = Exclude<SettingsSectionId, RetiredSettingsSectionId>;

export const settingsSections = [
  defineSettingsSection(
    "model-service",
    "link",
    "settings.section.modelService.label",
    "settings.section.modelService.description",
    "local",
  ),
  defineSettingsSection(
    "model-roles",
    "target",
    "settings.section.modelRoles.label",
    "settings.section.modelRoles.description",
  ),
  defineSettingsSection(
    "runtime",
    "activity",
    "settings.section.runtime.label",
    "settings.section.runtime.description",
    "none",
  ),
  defineSettingsSection(
    "prompt",
    "file-text",
    "settings.section.prompt.label",
    "settings.section.prompt.description",
    "none",
  ),
  defineSettingsSection(
    "planning",
    "route",
    "settings.section.planning.label",
    "settings.section.planning.description",
  ),
  defineSettingsSection(
    "retrieval",
    "search",
    "settings.section.retrieval.label",
    "settings.section.retrieval.description",
  ),
  defineSettingsSection(
    "system-tools",
    "package",
    "settings.section.systemTools.label",
    "settings.section.systemTools.description",
    "none",
  ),
  defineSettingsSection(
    "dependencies",
    "server",
    "settings.section.dependencies.label",
    "settings.section.dependencies.description",
    "none",
  ),
  defineSettingsSection(
    "channels",
    "message",
    "settings.section.channels.label",
    "settings.section.channels.description",
    "local",
  ),
  defineSettingsSection(
    "general",
    "sliders",
    "settings.section.general.label",
    "settings.section.general.description",
    "none",
  ),
  defineSettingsSection(
    "appearance",
    "palette",
    "settings.section.appearance.label",
    "settings.section.appearance.description",
    "none",
  ),
  defineSettingsSection("storage", "folder", "settings.section.storage.label", "settings.section.storage.description"),
  defineSettingsSection("about", "info", "settings.section.about.label", "settings.section.about.description", "none"),
] as const satisfies readonly SettingsSectionDefinition[];

function defineSettingsSection(
  id: CanonicalSettingsSectionId,
  icon: AppIconName,
  labelKey: FrontendMessageKey,
  descriptionKey: FrontendMessageKey,
  headerMode: SettingsSectionHeaderMode = "global",
): SettingsSectionDefinition {
  return {
    id,
    icon,
    get label() {
      return frontendMessage(labelKey);
    },
    get description() {
      return frontendMessage(descriptionKey);
    },
    headerMode,
  };
}

function isRetiredSettingsSectionId(value: SettingsSectionId): value is RetiredSettingsSectionId {
  return value in retiredSectionTargets;
}

export function readSettingsSection(sectionId: SettingsSectionId): SettingsSectionDefinition {
  const canonicalId = isRetiredSettingsSectionId(sectionId) ? retiredSectionTargets[sectionId] : sectionId;
  return settingsSections.find((section) => section.id === canonicalId) ?? settingsSections[0];
}
