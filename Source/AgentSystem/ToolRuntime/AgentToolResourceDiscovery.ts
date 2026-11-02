/**
 * Resource syntax that can be recognized before a tool contract is loaded.
 * Resource capabilities, rather than ToolSearch, own these declarations so a
 * new resource type does not need a tool-name or capability-ID convention.
 */
export const AgentToolResourceQueryShapes = {
  Path: "path",
  Url: "url",
} as const;

export type AgentToolResourceQueryShape =
  (typeof AgentToolResourceQueryShapes)[keyof typeof AgentToolResourceQueryShapes];

export interface AgentToolResourceDiscovery {
  readonly queryShapes?: readonly AgentToolResourceQueryShape[];
}

export interface AgentToolResourceDiscoveryReader {
  getDiscovery(capabilityId: string): AgentToolResourceDiscovery | undefined;
}
