import type { MemoryType } from "@mem-os/sdk";

export interface AgentContinuityScoreBreakdown {
  readonly keyword?: number;
  readonly semantic?: number;
  readonly hybrid?: number;
}

export interface AgentContinuityEventCandidate {
  readonly id: string;
  readonly uri: string;
  readonly revision: string;
  readonly type: MemoryType;
  readonly summary: string;
  readonly occurredAt: string;
  readonly score: number;
  readonly matchedBy: readonly string[];
  /** Native MemOS retrieval channels, when the SDK returned a hybrid score. */
  readonly scores?: AgentContinuityScoreBreakdown;
  /** Host-only coverage receipts for the native near-duplicate snapshot. */
  readonly deliveryKeys?: readonly string[];
}

export interface AgentContinuityDigestPromptEntry {
  readonly id: string;
  readonly uri: string;
  readonly revision: string;
  readonly granularity: "day" | "month";
  readonly periodStart: string;
  /** Exclusive calendar boundary in Asia/Shanghai. */
  readonly periodEnd: string;
  readonly summary: string;
  readonly score: number;
  readonly matchedBy: readonly string[];
  /** Native MemOS retrieval channels, when the SDK returned a hybrid score. */
  readonly scores?: AgentContinuityScoreBreakdown;
  readonly deliveryKeys?: readonly string[];
}

export interface AgentContinuityRecallSelectionCount {
  readonly available: number;
  readonly matched: number;
  readonly selected: number;
}

export interface AgentContinuityRecallSelection {
  readonly digests: AgentContinuityRecallSelectionCount;
  readonly events: AgentContinuityRecallSelectionCount;
  readonly usedTokens: number;
  readonly maxTokens: number;
}

/** The complete prompt memory surface. MemOS owns knowledge and period summaries. */
export interface AgentContinuityMemoryPromptContext {
  readonly enabled: boolean;
  /** The user text used for this turn's MemOS search, kept for UI audit only. */
  readonly query?: string;
  readonly deliveryEpoch?: number;
  readonly periodDigests: readonly AgentContinuityDigestPromptEntry[];
  readonly eventCandidates: readonly AgentContinuityEventCandidate[];
  readonly selection: AgentContinuityRecallSelection;
}

export const EmptyAgentContinuityMemoryPromptContext: AgentContinuityMemoryPromptContext = {
  enabled: false,
  periodDigests: [],
  eventCandidates: [],
  selection: {
    digests: { available: 0, matched: 0, selected: 0 },
    events: { available: 0, matched: 0, selected: 0 },
    usedTokens: 0,
    maxTokens: 0,
  },
};
