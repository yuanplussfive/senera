import type { ToolSearchCapabilityManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolSearchMemoryEvidence } from "./AgentToolSearchMemory.js";
import type { AgentToolSearchRerankDocument } from "./AgentToolSearchReranker.js";
import type { AgentToolCapabilityCacheState } from "./AgentToolCapabilitySessionCache.js";

export const AgentToolSearchResultModes = {
  Ranked: "ranked",
  Catalog: "catalog",
} as const;

export type AgentToolSearchResultMode = (typeof AgentToolSearchResultModes)[keyof typeof AgentToolSearchResultModes];

export interface AgentToolSearchOptions {
  query: string;
  preferredSourceIds?: readonly string[];
  plannerTags?: readonly string[];
  includeLoaded?: boolean;
  loadedToolNames?: readonly string[];
  authorizedToolNames?: readonly string[];
  memoryEvidence?: readonly AgentToolSearchMemoryEvidence[];
  semanticEvidence?: readonly AgentToolSearchSemanticEvidence[];
  /** Explicit discovery keeps every eligible Dynamic tool visible. */
  resultMode?: AgentToolSearchResultMode;
}

export interface AgentToolSearchSemanticEvidence {
  toolName: string;
  score: number;
}

export interface AgentToolSearchResult {
  toolName: string;
  title: string;
  ownerName: string;
  sources: AgentToolSearchSource[];
  summary: string;
  whenToUse: string;
  parameterSummary: string;
  permissions: string[];
  score: number;
  ranks: Record<string, number>;
  matchedTerms: string[];
  matchedCapabilities: AgentToolSearchCapabilityMatch[];
  learningSignals: AgentToolSearchLearningSignal[];
  /** Runtime state is explicit so a visible tool is never mistaken for an
   * undiscovered tool, and confirmed arguments can be reused without another
   * search. */
  state?: AgentToolCapabilityCacheState & {
    readonly exposure: "visible" | "discoverable";
  };
}

export interface AgentToolSearchSource {
  id: string;
  title: string;
  description: string;
}

export interface AgentToolSearchLearningSignal {
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
  sourceIds: string[];
  sources: AgentToolSearchSource[];
  capabilities: ToolSearchCapabilityManifest[];
}

export type AgentToolSearchRankerName = "bm25" | "exact" | "fuzzy" | "semantic" | "memory" | "priority" | "source";
export type AgentToolSearchRankMap = Map<string, number>;
export type AgentToolSearchRankedEntry = { toolName: string; score: number };
