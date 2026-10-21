import { AgentToolPresentationIconNames } from "../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";

export const ToolStageIconNames = AgentToolPresentationIconNames;

export type ToolStageIconName = (typeof ToolStageIconNames)[number];

const ToolStageIconNameSet = new Set<string>(ToolStageIconNames);

export function isToolStageIconName(value: unknown): value is ToolStageIconName {
  return typeof value === "string" && ToolStageIconNameSet.has(value);
}
