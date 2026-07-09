export const AgentToolResultSummaryType = "senera.tool_result_summary.v1";

export type AgentToolResultSummaryStatus = "success" | "failure" | "empty";

export interface AgentToolResultSummary {
  type: typeof AgentToolResultSummaryType;
  version: 1;
  toolName: string;
  callId: string;
  status: AgentToolResultSummaryStatus;
  artifactUri: string;
  headline: string;
  summary: string;
  facts: AgentToolResultSummaryFact[];
  changes: AgentToolResultSummaryChange[];
  limitations: string[];
  retrieval: AgentToolResultSummaryRetrieval;
  stats: AgentToolResultSummaryStats;
}

export interface AgentToolResultSummaryFact {
  name: string;
  value: string;
  evidenceUri?: string;
  kind?: string;
  confidence?: number;
  artifactRefs: string[];
}

export interface AgentToolResultSummaryChange {
  kind: string;
  status: string;
  key: string;
  summary: string;
}

export interface AgentToolResultSummaryRetrieval {
  artifactUri: string;
  refs: string[];
}

export interface AgentToolResultSummaryStats {
  summaryTokens: number;
  summaryTokenLimit: number;
  summaryTruncated: boolean;
  factCount: number;
  omittedFacts: number;
  changeCount: number;
  omittedChanges: number;
}
