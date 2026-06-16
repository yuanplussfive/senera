export type LoadedToolsState = "all" | string[];

export const ToolSearchToolName = "ToolSearchTool";

export interface PendingToolSearch {
  query: string;
  queryTokens: string[];
  plannerTags: string[];
  candidates: string[];
  timestamp: number;
}
