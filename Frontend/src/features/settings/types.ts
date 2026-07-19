import {
  Boxes,
  FolderCog,
  Gauge,
  Info,
  Palette,
  Route,
  Cable,
  Search,
  SlidersHorizontal,
  Target,
  type LucideIcon,
} from "lucide-react";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";

export type SettingsSectionId =
  | "model-service"
  | "default-model"
  | "runtime"
  | "planning"
  | "retrieval"
  | "skills"
  | "general"
  | "appearance"
  | "storage"
  | "about";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const settingsSections = [
  defineSettingsSection(
    "model-service",
    Cable,
    "settings.section.modelService.label",
    "settings.section.modelService.description",
  ),
  defineSettingsSection(
    "default-model",
    Target,
    "settings.section.defaultModel.label",
    "settings.section.defaultModel.description",
  ),
  defineSettingsSection("runtime", Gauge, "settings.section.runtime.label", "settings.section.runtime.description"),
  defineSettingsSection("planning", Route, "settings.section.planning.label", "settings.section.planning.description"),
  defineSettingsSection(
    "retrieval",
    Search,
    "settings.section.retrieval.label",
    "settings.section.retrieval.description",
  ),
  defineSettingsSection("skills", Boxes, "settings.section.skills.label", "settings.section.skills.description"),
  defineSettingsSection(
    "general",
    SlidersHorizontal,
    "settings.section.general.label",
    "settings.section.general.description",
  ),
  defineSettingsSection(
    "appearance",
    Palette,
    "settings.section.appearance.label",
    "settings.section.appearance.description",
  ),
  defineSettingsSection("storage", FolderCog, "settings.section.storage.label", "settings.section.storage.description"),
  defineSettingsSection("about", Info, "settings.section.about.label", "settings.section.about.description"),
] as const satisfies readonly SettingsSectionDefinition[];

function defineSettingsSection(
  id: SettingsSectionId,
  icon: LucideIcon,
  labelKey: FrontendMessageKey,
  descriptionKey: FrontendMessageKey,
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
  };
}
export const settingsSectionIds = settingsSections.map((section) => section.id) as readonly SettingsSectionId[];
export const defaultSettingsSectionId: SettingsSectionId = settingsSections[0].id;

export function isSettingsSectionId(value: string | null | undefined): value is SettingsSectionId {
  return settingsSectionIds.includes(value as SettingsSectionId);
}

export function readSettingsSection(sectionId: SettingsSectionId): SettingsSectionDefinition {
  return settingsSections.find((section) => section.id === sectionId) ?? settingsSections[0];
}
