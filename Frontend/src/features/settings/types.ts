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
  id: SettingsSectionId;
  label: string;
  icon: AppIconName;
  description: string;
  headerMode: SettingsSectionHeaderMode;
}

export type SettingsSectionHeaderMode = "global" | "local" | "none";

export const settingsSections = [
  defineSettingsSection(
    "model-service",
    "link",
    "settings.section.modelService.label",
    "settings.section.modelService.description",
    "local",
  ),
  defineSettingsSection(
    "default-model",
    "target",
    "settings.section.defaultModel.label",
    "settings.section.defaultModel.description",
    "local",
  ),
  defineSettingsSection(
    "runtime",
    "activity",
    "settings.section.runtime.label",
    "settings.section.runtime.description",
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
  ),
  defineSettingsSection(
    "mcp-servers",
    "server",
    "settings.section.mcpServers.label",
    "settings.section.mcpServers.description",
  ),
  defineSettingsSection(
    "channels",
    "message",
    "settings.section.channels.label",
    "settings.section.channels.description",
  ),
  defineSettingsSection("general", "tools", "settings.section.general.label", "settings.section.general.description"),
  defineSettingsSection(
    "appearance",
    "palette",
    "settings.section.appearance.label",
    "settings.section.appearance.description",
  ),
  defineSettingsSection("storage", "folder", "settings.section.storage.label", "settings.section.storage.description"),
  defineSettingsSection(
    "workspace",
    "folder",
    "settings.section.workspace.label",
    "settings.section.workspace.description",
  ),
  defineSettingsSection("about", "info", "settings.section.about.label", "settings.section.about.description"),
] as const satisfies readonly SettingsSectionDefinition[];

function defineSettingsSection(
  id: SettingsSectionId,
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
export function readSettingsSection(sectionId: SettingsSectionId): SettingsSectionDefinition {
  return settingsSections.find((section) => section.id === sectionId) ?? settingsSections[0];
}
