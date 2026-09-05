export type LoadedToolsState = string[];

export const AgentToolSearchCurrentSetPolicies = {
  Retain: "retain",
  Replace: "replace",
} as const;

export type AgentToolSearchCurrentSetPolicy =
  (typeof AgentToolSearchCurrentSetPolicies)[keyof typeof AgentToolSearchCurrentSetPolicies];

export const AgentToolMetaToolNames = {
  Search: "ToolSearch",
  Describe: "ToolDescribe",
  Load: "ToolLoad",
  Unload: "ToolUnload",
} as const;

export const AgentToolExposureMutationMetaToolNames = Object.freeze([
  AgentToolMetaToolNames.Load,
  AgentToolMetaToolNames.Unload,
] as const);

export type AgentToolMetaToolName = (typeof AgentToolMetaToolNames)[keyof typeof AgentToolMetaToolNames];

export function isAgentToolMetaToolName(toolName: string): toolName is AgentToolMetaToolName {
  return Object.values(AgentToolMetaToolNames).includes(toolName as AgentToolMetaToolName);
}

export function isAgentToolExposureMutationMetaToolName(toolName: string): boolean {
  return AgentToolExposureMutationMetaToolNames.some((name) => name === toolName);
}

export interface PendingToolSearch {
  query: string;
  queryTokens: string[];
  plannerTags: string[];
  candidates: string[];
  timestamp: number;
}
