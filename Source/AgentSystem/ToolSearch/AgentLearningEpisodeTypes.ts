import type { AgentToolSearchEpisodeCall, AgentToolSearchFinalOutcome } from "./AgentToolSearchMemoryTypes.js";

export const AgentLearningDomains = {
  ToolRouting: "tool_routing",
  SkillRouting: "skill_routing",
} as const;

export type AgentLearningDomain = (typeof AgentLearningDomains)[keyof typeof AgentLearningDomains];

export const AgentLearningStates = {
  Observed: "observed",
  Learned: "learned",
  Skipped: "skipped",
  Failed: "failed",
} as const;

export type AgentLearningState = (typeof AgentLearningStates)[keyof typeof AgentLearningStates];

export interface AgentLearningSubject {
  kind: "tool" | "skill";
  name: string;
  revision?: string;
}

export interface AgentLearningEpisodeContext {
  rawUserTurn: string;
  standaloneRequest: string;
  contextMode: string;
  contextBasis: string;
  candidates: string[];
  chosenTools: string[];
  activeSkills: Array<{ name: string; revision: string; matchedTerms: string[] }>;
}

export interface AgentLearningEpisodeOutcome {
  outcome: "success" | "failure" | "unknown";
  score: number;
  calls: AgentToolSearchEpisodeCall[];
  final: AgentToolSearchFinalOutcome;
}

export interface AgentLearningEpisode {
  id: string;
  domain: AgentLearningDomain;
  state: AgentLearningState;
  reason: string;
  error: string;
  attempts: number;
  projectId: string;
  sessionId: string;
  requestId: string;
  query: string;
  subjects: AgentLearningSubject[];
  context: AgentLearningEpisodeContext;
  outcome: AgentLearningEpisodeOutcome;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AgentLearningEpisodeResolution {
  state: Exclude<AgentLearningState, "observed">;
  reason: string;
  error?: string;
  attempts?: number;
  updatedAtMs: number;
}

export interface AgentLearningEpisodeCount {
  domain: AgentLearningDomain;
  state: AgentLearningState;
  count: number;
}

export interface AgentLearningSummary {
  episodeCount: number;
  episodeGroups: AgentLearningEpisodeCount[];
  skillTermCount: number;
}

export interface AgentSkillLearningTermAggregate {
  projectId: string;
  skillName: string;
  skillRevision: string;
  term: string;
  source: string;
  support: number;
  weight: number;
  lastSeenAt: number;
}

export interface AgentSkillLearningEvidence {
  skillName: string;
  skillRevision: string;
  evidence: number;
  confidence: number;
  rankScore: number;
  terms: string[];
}
