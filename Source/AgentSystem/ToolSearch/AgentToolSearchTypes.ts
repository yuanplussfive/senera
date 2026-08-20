import type { ToolSearchCapabilityManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolSearchMemoryEvidence } from "./AgentToolSearchMemory.js";
import type { AgentToolSearchRerankDocument } from "./AgentToolSearchReranker.js";

export interface AgentToolSearchOptions {
  query: string;
  preferredSourceIds?: readonly string[];
  plannerTags?: readonly string[];
  includeLoaded?: boolean;
  loadedToolNames?: readonly string[];
  memoryEvidence?: readonly AgentToolSearchMemoryEvidence[];
  semanticEvidence?: readonly AgentToolSearchSemanticEvidence[];
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

export type AgentToolSearchRankerName = "bm25" | "exact" | "semantic" | "memory" | "priority" | "source";
export type AgentToolSearchRankMap = Map<string, number>;
export type AgentToolSearchRankedEntry = { toolName: string; score: number };
