import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
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
import { resolveAgentToolSearchSources } from "./AgentToolSearchDocumentBuilder.js";

export function createAgentToolCatalogIdentity(
  tools: readonly RegisteredTool[],
  runtimeTargets: readonly ToolExecutionTarget[],
): string {
  return sha256HexOfCanonicalJson({
    runtimeTargets: [...new Set(runtimeTargets)].sort(),
    tools: tools
      .map((tool) => ({
        // RegisteredTool is a declarative data contract. Hashing the full
        // snapshot prevents policy-only replacements from reusing an index
        // built from an older execution or content boundary.
        tool: {
          ...tool,
          sources: resolveAgentToolSearchSources(tool),
        },
        executionTargets: resolveAvailableAgentToolExecutionTargets(tool, runtimeTargets),
      }))
      .sort((left, right) => left.tool.name.localeCompare(right.tool.name)),
  });
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
  const semanticInputCount = documents.reduce(
    (total, document) => total + Math.max(1, document.semanticInputs.length),
    0,
  );
  const capacity = Math.max(
    AgentCapabilityEmbeddingCachePolicy.MinimumEntries,
    semanticInputCount * AgentCapabilityEmbeddingCachePolicy.CatalogGenerations,
  );
  cache.resize(capacity);
  const activeIdentities = new Set(
    model
      ? documents.flatMap((document) =>
          (document.semanticInputs.length > 0
            ? document.semanticInputs
            : [{ id: "full", text: document.semanticText }]
          ).map((input) => createAgentCapabilityEmbeddingIdentity(model, document, input.id)),
        )
      : [],
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
        semanticInputs: document.semanticInputs,
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
