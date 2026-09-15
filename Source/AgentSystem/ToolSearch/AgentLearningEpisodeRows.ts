import type { AgentLearningDomain, AgentLearningState } from "./AgentLearningEpisodeTypes.js";

export interface StoredLearningEpisodeRow {
  id: string;
  domain: AgentLearningDomain;
  state: AgentLearningState;
  reason: string;
  error: string;
  attempts: number;
  project_id: string;
  session_id: string;
  request_id: string;
  query: string;
  subjects_json: string;
  context_json: string;
  outcome_json: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface StoredSkillLearningTermRow {
  project_id: string;
  skill_name: string;
  skill_revision: string;
  term: string;
  source: string;
  support: number;
  weight: number;
  last_seen_at: number;
}

export interface StoredLearningEpisodeCountRow {
  domain: AgentLearningDomain;
  state: AgentLearningState;
  count: number;
}

export interface StoredCountRow {
  count: number;
}
