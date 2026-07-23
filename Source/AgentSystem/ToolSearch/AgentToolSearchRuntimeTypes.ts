export type LoadedToolsState = string[];

export const AgentToolSearchCurrentSetPolicies = {
  Retain: "retain",
  Replace: "replace",
} as const;

export type AgentToolSearchCurrentSetPolicy =
  (typeof AgentToolSearchCurrentSetPolicies)[keyof typeof AgentToolSearchCurrentSetPolicies];

export const ToolSearchToolName = "ToolSearchTool";

export interface PendingToolSearch {
  query: string;
  queryTokens: string[];
  plannerTags: string[];
  candidates: string[];
  timestamp: number;
}
