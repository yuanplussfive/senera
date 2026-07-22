import type { ToolSearchCapabilityManifest } from "../Types/PluginManifestTypes.js";
import type { AgentToolSearchMemoryEvidence } from "./AgentToolSearchMemory.js";
import type { AgentToolSearchRerankDocument } from "./AgentToolSearchReranker.js";

export interface AgentToolSearchOptions {
  query: string;
  preferredSourceIds?: readonly string[];
  plannerTags?: readonly string[];
  includeLoaded?: boolean;
  loadedToolNames?: readonly string[];
  memoryEvidence?: readonly AgentToolSearchMemoryEvidence[];
}

export interface AgentToolSearchResult {
  toolName: string;
  title: string;
  pluginName: string;
  sources: AgentToolSearchSource[];
  summary: string;
  whenToUse: string;
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

export type AgentToolSearchRankerName = "bm25" | "exact" | "memory" | "priority" | "source";
export type AgentToolSearchRankMap = Map<string, number>;
export type AgentToolSearchRankedEntry = { toolName: string; score: number };
