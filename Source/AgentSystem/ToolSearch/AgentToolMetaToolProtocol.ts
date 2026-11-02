import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";

export const AgentToolDiscoveryProtocol = defineSeneraProtocol("tool_discovery", 5);
export const AgentToolDescriptionProtocol = defineSeneraProtocol("tool_description", 2);
export const AgentToolPreparationProtocol = defineSeneraProtocol("tool_preparation", 1);

export const AgentToolCatalogStatuses = {
  Current: "current",
  Stale: "stale",
} as const;

export type AgentToolCatalogStatus = (typeof AgentToolCatalogStatuses)[keyof typeof AgentToolCatalogStatuses];

export interface ToolSearchArguments {
  readonly query: string;
}

export interface ToolDescribeArguments {
  readonly tools: readonly string[];
}

export interface ToolCatalogMutationArguments {
  readonly tools: readonly string[];
  readonly catalogRevision?: string;
}
