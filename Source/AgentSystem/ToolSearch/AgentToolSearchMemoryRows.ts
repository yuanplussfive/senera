import type { AgentToolSearchEpisode } from "./AgentToolSearchMemoryTypes.js";

export interface StoredEpisodeRow {
  query: string;
  query_tokens: string;
  planner_tags: string;
  candidates: string;
  chosen_tools: string;
  learned_keywords: string;
  outcome: AgentToolSearchEpisode["outcome"];
  calls: string;
  final_score: number;
  final_outcome: string;
  project_id: string;
  timestamp: number;
}

export interface StoredTermAggregateRow {
  project_id: string;
  tool_name: string;
  term: string;
  source: string;
  support: number;
  weight: number;
  last_seen_at: number;
}

export interface StoredPatternAggregateRow {
  project_id: string;
  tool_name: string;
  pattern_key: string;
  trigger_terms: string;
  argument_keys: string;
  evidence_kinds: string;
  support: number;
  last_seen_at: number;
}

