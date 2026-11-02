import type { AgentStateCard } from "../StateCard/AgentStateCardTypes.js";

export interface AgentToolSearchEpisode {
  query: string;
  queryTokens: string[];
  plannerTags: string[];
  candidates: string[];
  chosenTools: string[];
  activeSkills: AgentToolSearchSkillReference[];
  stateCard?: AgentStateCard;
  outcome: "success" | "failure" | "unknown";
  calls: AgentToolSearchEpisodeCall[];
  finalScore: number;
  finalOutcome: AgentToolSearchFinalOutcome;
  projectId: string;
  timestamp: number;
}

export interface AgentToolSearchSkillReference {
  name: string;
  revision: string;
}

export interface AgentToolSearchEpisodeCall {
  toolName: string;
  argumentKeys: string[];
  evidenceKinds: string[];
  status: "success" | "failure" | "empty";
  evidenceUris: string[];
  artifactUris: string[];
  hasArtifact: boolean;
  hasEvidence: boolean;
  hasWorkspaceChanges: boolean;
  errorCode: string;
  error: string;
  failureKind?: string;
  failureSource?: string;
  retryable?: boolean;
  score: number;
}

export interface AgentToolSearchFinalOutcome {
  toolExecutionSucceeded: boolean;
  producedEvidence: boolean;
  producedArtifact: boolean;
  changedWorkspace: boolean;
}

export interface AgentToolSearchMemoryEvidence {
  toolName: string;
  evidence: number;
  confidence: number;
  rankScore: number;
  signals: AgentToolSearchScenarioSignal[];
}

export interface AgentToolSearchScenarioSignal {
  term: string;
  source: string;
  support: number;
  confidence: number;
  score: number;
  lastSeenAt: number;
}
