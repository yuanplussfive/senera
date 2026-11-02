import type { AgentMemoryRecallSnapshot } from "../../../Source/AgentSystem/Continuity/AgentMemoryRecallContract";

export interface TodoData {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TodoCountsData {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

export interface TodoSnapshotData {
  items: TodoData[];
  counts: TodoCountsData;
}

/** MemOS context actually injected into a turn. */
export type ContinuitySnapshotData = AgentMemoryRecallSnapshot;

export interface ContinuitySelectionCountData {
  available: number;
  matched: number;
  selected: number;
}

/** Three-tier prompt harness composition report for one turn. */
export interface PromptHarnessComposedData {
  profile: "native" | "baml";
  sections: {
    frozen: { bytes: number; tokens: number; revision: string };
    stable: { bytes: number; tokens: number; revision: string };
    volatile: { bytes: number; tokens: number; revision: string };
  };
  merged: { bytes: number; tokens: number };
}

export interface ContinuityRecallLocalMatchData {
  label: string;
  kind?: string;
  score: number;
  direct: boolean;
  matchedBy: Array<"phrase" | "token" | "fuzzy">;
  matchedTerms?: string[];
  matchedLabel?: string;
  anchorEligible?: boolean;
}

export interface ContinuityRecallLocalRelationData {
  relationId: string;
  label: string;
  score: number;
  direct: boolean;
}

/** Deterministic local planning diagnostics, without persistence URIs. */
export interface ContinuityRecallLocalPlanData {
  terms: string[];
  concepts: ContinuityRecallLocalMatchData[];
  entities: ContinuityRecallLocalMatchData[];
  relations: ContinuityRecallLocalRelationData[];
  anchorLabels: string[];
  expanded: boolean;
}

/** Recall observability for one deterministic local planning pass. */
export interface ContinuityRecallQueryData {
  original: string;
  local?: ContinuityRecallLocalPlanData;
}

/** Settled recall summary: what was injected and how it was matched. */
export interface ContinuityRecallSettledData {
  injectedCount: number;
  eventCount: number;
  matchedByCounts: {
    textSimilarity: number;
    lexical: number;
    exactPhrase: number;
    exactReference: number;
    embedding: number;
  };
  directCount: number;
  referenceCount: number;
  nearMissCount: number;
  belowSimilarity: number;
  belowCandidate: number;
  funnelSkipped: number;
  degraded: "none" | "semantic_timeout" | "semantic_unavailable";
  semanticStatus:
    | "short_query"
    | "no_observations"
    | "no_client"
    | "no_embeddings"
    | "model_mismatch"
    | "no_vector"
    | "dimension_mismatch"
    | "request_failed"
    | "completed"
    | "disabled"
    | "unavailable"
    | "timeout";
  semanticIndexedCount: number;
  semanticCompatibleCount: number;
  totalLatencyMs: number;
}
