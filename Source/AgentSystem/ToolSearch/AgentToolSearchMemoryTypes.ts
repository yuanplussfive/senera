export interface AgentToolSearchEpisode {
  query: string;
  queryTokens: string[];
  plannerTags: string[];
  candidates: string[];
  chosenTools: string[];
  learnedKeywords: AgentToolSearchLearnedKeyword[];
  outcome: "success" | "failure" | "unknown";
  calls: AgentToolSearchEpisodeCall[];
  finalScore: number;
  finalOutcome: AgentToolSearchFinalOutcome;
  projectId: string;
  timestamp: number;
}

export interface AgentToolSearchLearnedKeyword {
  toolName: string;
  value: string;
  source: string;
  weight: number;
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
  signals: AgentToolLearningSignal[];
}

export interface AgentToolLearningSignal {
  term: string;
  source: string;
  support: number;
  confidence: number;
  score: number;
  lastSeenAt: number;
}

export interface AgentToolUsePattern {
  toolName: string;
  triggerSummary: string;
  argumentGuidance: string;
  evidenceGoal: string;
  confidence: number;
  supportCount: number;
  successCount: number;
  failureCount: number;
  lastSeenAt: number;
}

export interface AgentToolUsePatternMatch extends AgentToolUsePattern {
  score: number;
}

export interface AgentToolLearningTermAggregate {
  projectId: string;
  toolName: string;
  term: string;
  source: string;
  support: number;
  weight: number;
  lastSeenAt: number;
}

export interface AgentToolUsePatternAggregate {
  projectId: string;
  toolName: string;
  patternKey: string;
  triggerTerms: AgentToolSearchLearnedKeyword[];
  argumentKeys: string[];
  evidenceKinds: string[];
  support: number;
  lastSeenAt: number;
}

export interface AgentToolLearningProjection {
  terms: AgentToolLearningTermAggregate[];
  patterns: AgentToolUsePatternAggregate[];
}

export interface AgentToolSearchMemoryStore {
  add(episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection): void;
  list(projectId: string, limit: number): AgentToolSearchEpisode[];
  terms(projectId: string): AgentToolLearningTermAggregate[];
  patterns(projectId: string): AgentToolUsePatternAggregate[];
  prune(maxEpisodes: number): void;
  close(): void;
}
