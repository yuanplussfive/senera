import type { AgentToolAssessmentStatus, AgentToolFailure } from "../ToolRuntime/AgentToolResultOutcome.js";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";

export const AgentToolResultSummaryProtocol = defineSeneraProtocol("tool_result_summary", 1);

export type AgentToolResultSummaryStatus = AgentToolAssessmentStatus;

export interface AgentToolResultSummary {
  type: typeof AgentToolResultSummaryProtocol.type;
  version: typeof AgentToolResultSummaryProtocol.version;
  toolName: string;
  callId: string;
  status: AgentToolResultSummaryStatus;
  failure?: AgentToolFailure;
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
