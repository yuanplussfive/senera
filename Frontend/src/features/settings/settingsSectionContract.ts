import {
  AgentSettingsSectionIds,
  isAgentSettingsSectionId,
  type AgentSettingsSectionId,
} from "../../../../Source/AgentSystem/Settings/AgentSettingsSectionContract";

export const settingsSectionIds = AgentSettingsSectionIds;

export type SettingsSectionId = AgentSettingsSectionId;

export const defaultSettingsSectionId: SettingsSectionId = settingsSectionIds[0];

export function isSettingsSectionId(value: string | null | undefined): value is SettingsSectionId {
  return isAgentSettingsSectionId(value);
}
