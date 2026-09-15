import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import { resolveAvailableAgentToolExecutionTargets } from "../ToolRuntime/AgentToolExecutionPlan.js";
import { AgentCapabilityEmbeddingCachePolicy, CurrentSetProjectors } from "./AgentToolSearchRuntimePolicies.js";
import {
  createAgentCapabilityEmbeddingIdentity,
  type AgentCapabilitySearchDocument,
} from "./AgentCapabilitySearchIndex.js";
import type { AgentToolSearchCurrentSetPolicy, LoadedToolsState } from "./AgentToolSearchRuntimeTypes.js";
import type { AgentLruCache } from "../Core/AgentLruCache.js";

export function createAgentToolCatalogIdentity(
  tools: readonly RegisteredTool[],
  runtimeTargets: readonly ToolExecutionTarget[],
): string {
  return sha256HexOfCanonicalJson(
    tools
      .map((tool) => {
        const owner = resolveAgentToolOwner(tool);
        return {
          name: tool.name,
          owner: {
            name: owner.name,
            title: owner.title,
            description: owner.description,
            revision: owner.revision,
          },
          loading: tool.loading,
          sources: tool.sources,
          search: tool.search,
          contractDigest: tool.contract?.digest,
          executionTargets: resolveAvailableAgentToolExecutionTargets(tool, runtimeTargets),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

export function projectCurrentLoadedTools(
  current: LoadedToolsState | undefined,
  policy: AgentToolSearchCurrentSetPolicy,
): string[] {
  return CurrentSetProjectors[policy](current);
}

export function refreshAgentCapabilityEmbeddingCache(
  cache: AgentLruCache<string, readonly number[]>,
  documents: readonly AgentCapabilitySearchDocument[],
  model: string | undefined,
): void {
  const capacity = Math.max(
    AgentCapabilityEmbeddingCachePolicy.MinimumEntries,
    documents.length * AgentCapabilityEmbeddingCachePolicy.CatalogGenerations,
  );
  cache.resize(capacity);
  const activeIdentities = new Set(
    model ? documents.map((document) => createAgentCapabilityEmbeddingIdentity(model, document)) : [],
  );
  cache.retain(activeIdentities);
}

export function createAgentCapabilityCatalogRevision(documents: readonly AgentCapabilitySearchDocument[]): string {
  return sha256HexOfCanonicalJson(
    documents
      .map((document) => ({
        id: document.id,
        kind: document.kind,
        revision: document.revision,
        semanticText: document.semanticText,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

export function readAgentRegistryRevision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function listAgentDiscoverySourceIds(registry: AgentExtensionRegistry): string[] {
  return registry.listDiscoverySources().map((source) => source.id);
}
