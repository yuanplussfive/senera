import {
  AgentToolSearchCurrentSetPolicies,
  type AgentToolSearchCurrentSetPolicy,
  type LoadedToolsState,
} from "./AgentToolSearchRuntimeTypes.js";

export const AgentCapabilityEmbeddingCachePolicy = {
  MinimumEntries: 32,
  CatalogGenerations: 2,
} as const;

export const ReusableCapabilityMatchPolicy = Object.freeze({
  minimumOverlap: 2,
  minimumCoverage: 0.75,
  minimumJaccard: 0.5,
});

export const CurrentSetProjectors = {
  [AgentToolSearchCurrentSetPolicies.Retain]: (current: LoadedToolsState | undefined) => [...(current ?? [])],
  [AgentToolSearchCurrentSetPolicies.Replace]: () => [],
} satisfies Record<AgentToolSearchCurrentSetPolicy, (current: LoadedToolsState | undefined) => string[]>;
