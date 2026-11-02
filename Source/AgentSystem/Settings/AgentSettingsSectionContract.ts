/**
 * Stable identities shared by every settings surface. Presentation layers own labels and layout,
 * while desktop IPC uses this contract to validate requested navigation without duplicating ids.
 */
export const AgentSettingsSectionIds = [
  "model-service",
  "model-roles",
  "runtime",
  "prompt",
  "planning",
  "retrieval",
  "system-tools",
  "dependencies",
  "mcp-servers",
  "channels",
  "general",
  "appearance",
  "storage",
  "workspace",
  "about",
] as const;

export type AgentSettingsSectionId = (typeof AgentSettingsSectionIds)[number];

export function isAgentSettingsSectionId(value: unknown): value is AgentSettingsSectionId {
  return typeof value === "string" && AgentSettingsSectionIds.some((sectionId) => sectionId === value);
}
