export const ToolStageIconNames = [
  "tools",
  "search",
  "blocks",
  "file-text",
  "pencil",
  "terminal",
  "clock",
  "activity",
  "git-branch",
  "users",
  "brain",
  "calendar-clock",
  "image",
  "message-question",
  "globe",
] as const;

export type ToolStageIconName = (typeof ToolStageIconNames)[number];

const ToolStageIconNameSet = new Set<string>(ToolStageIconNames);

export function isToolStageIconName(value: unknown): value is ToolStageIconName {
  return typeof value === "string" && ToolStageIconNameSet.has(value);
}
