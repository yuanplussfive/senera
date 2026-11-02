import type { ToolSearchCapabilityManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolSearchMemoryEvidence } from "./AgentToolSearchMemory.js";
import type { AgentToolSearchRerankDocument } from "./AgentToolSearchReranker.js";
import type { AgentToolCapabilityCacheState } from "./AgentToolCapabilitySessionCache.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentMcpServiceDiscoveryEntry } from "../McpPackages/AgentMcpPackageTypes.js";
import type { AgentToolAvailability } from "../ToolRuntime/AgentToolAvailability.js";

export interface AgentToolSearchOptions {
  /** Original user task. Declaration identity and complete examples are
   * compared against this value without discarding supplied resource values. */
  query: string;
  interaction?: AgentInteractionContext;
  plannerTags?: readonly string[];
  loadedToolNames?: readonly string[];
  authorizedToolNames?: readonly string[];
  memoryEvidence?: readonly AgentToolSearchMemoryEvidence[];
}

export interface AgentToolSearchResult {
  availability?: AgentToolAvailability;
  toolName: string;
  title: string;
  ownerName: string;
  sources: AgentToolSearchSource[];
  summary: string;
  whenToUse: string;
  parameterSummary: string;
  permissions: string[];
  score: number;
  /** Raw cosine evidence from the local semantic channel, when that channel
   * participated in this retrieval. This stays internal to the runtime
   * result; the model-facing projection deliberately exposes only ranked
   * confidence. */
  semanticScore?: number;
  ranks: Record<string, number>;
  matchedTerms: string[];
  matchedCapabilities: AgentToolSearchCapabilityMatch[];
  scenarioSignals: AgentToolSearchScenarioSignal[];
  /** Runtime state is explicit so a visible tool is never mistaken for an
   * undiscovered tool, and confirmed arguments can be reused without another
   * search. */
  state?: AgentToolCapabilityCacheState & {
    readonly exposure: "visible" | "discoverable";
  };
}

/**
 * Search execution and model disclosure deliberately have different scopes.
 * Every retrieval channel contributes to the same candidate set; the
 * confidence planner then assigns a query-relative tier. `match` is the
 * strongest evidence band, `maybe` retains independent but uncertain
 * coverage, and `omitted` is available only for compact source-level
 * disclosure.
 */
export interface AgentToolSearchDiscovery {
  readonly services?: readonly AgentMcpServiceDiscoveryEntry[];
  readonly match: readonly AgentToolSearchResult[];
  readonly maybe: readonly AgentToolSearchResult[];
  readonly omitted: readonly AgentToolSearchResult[];
  readonly status?: AgentToolSearchDiscoveryStatus;
  readonly reason?: AgentToolSearchEmptyReason;
  readonly diagnostics?: readonly AgentToolSearchDiagnostic[];
  readonly catalogRevision?: string;
}

export const AgentToolSearchDiscoveryStatuses = {
  Empty: "empty",
  Stale: "stale",
} as const;

export type AgentToolSearchDiscoveryStatus =
  (typeof AgentToolSearchDiscoveryStatuses)[keyof typeof AgentToolSearchDiscoveryStatuses];

export const AgentToolSearchEmptyReasons = {
  NoAvailableTools: "no_available_tools",
  NotAuthorized: "not_authorized",
  NoMatch: "no_match",
  CatalogChanged: "catalog_changed",
} as const;

export type AgentToolSearchEmptyReason = (typeof AgentToolSearchEmptyReasons)[keyof typeof AgentToolSearchEmptyReasons];

export const AgentToolSearchDiagnostics = {
  SemanticUnavailable: "semantic_unavailable",
} as const;

export type AgentToolSearchDiagnostic = (typeof AgentToolSearchDiagnostics)[keyof typeof AgentToolSearchDiagnostics];

export interface AgentToolSearchSource {
  id: string;
  title: string;
  description: string;
}

export interface AgentToolSearchScenarioSignal {
  term: string;
  source: string;
  support: number;
  confidence: number;
  score: number;
}

export interface AgentToolSearchCapabilityMatch {
  id: string;
  title: string;
  score: number;
  matchedFacets: string[];
  risk?: {
    sideEffect?: string;
    permission?: string;
  };
}

export interface ToolSearchDocument extends AgentToolSearchRerankDocument {
  id: string;
  /** Primary producer-declared intent fields used for exact lexical evidence.
   * Supporting use-case narrative stays in coreText for recall and reranking. */
  anchorText: string;
  sourceIds: string[];
  sources: AgentToolSearchSource[];
  capabilities: ToolSearchCapabilityManifest[];
}

export type AgentToolSearchRankerName = "bm25" | "exact" | "example" | "fuzzy" | "semantic" | "structural" | "memory";
export type AgentToolSearchRankMap = Map<string, number>;
export type AgentToolSearchRankedEntry = { toolName: string; score: number };
