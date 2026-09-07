import type { AgentContinuityIdentityContext } from "../Continuity/AgentContinuityIdentityStore.js";
import type { AgentTextParts } from "../Text/AgentTextParts.js";

export const AgentTemporalMemoryGranularities = ["segment", "day", "month"] as const;
export type AgentTemporalMemoryGranularity = (typeof AgentTemporalMemoryGranularities)[number];

export const AgentTemporalMemoryDigestStatuses = ["open", "pending", "sealed", "failed", "stale"] as const;
export type AgentTemporalMemoryDigestStatus = (typeof AgentTemporalMemoryDigestStatuses)[number];

export interface AgentTemporalMemoryScope {
  readonly key: string;
  readonly workspaceId: string;
  readonly accountId: string | null;
  readonly userId: string | null;
  readonly worldId: string | null;
}

export interface AgentTemporalMemoryDigest {
  readonly id: string;
  readonly uri: string;
  readonly scope: AgentTemporalMemoryScope;
  readonly granularity: AgentTemporalMemoryGranularity;
  readonly digestKey: string;
  readonly sessionId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly timeZone: string;
  readonly status: AgentTemporalMemoryDigestStatus;
  /** Ephemeral semantic state used only while an open segment is classified. */
  readonly workingFocus: string;
  readonly summary: string;
  readonly topics: readonly string[];
  readonly openLoops: readonly string[];
  /** Structured source retained for identity-aware presentation. */
  readonly summaryParts?: AgentTextParts;
  readonly topicParts?: readonly AgentTextParts[];
  readonly openLoopParts?: readonly AgentTextParts[];
  readonly sourceRevision: string;
  readonly childCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTemporalMemoryDigestMember {
  readonly digestId: string;
  readonly memberUri: string;
  readonly memberKind: "episode" | "digest";
  readonly ordinal: number;
  readonly occurredAt: string;
  readonly sourceRevision: string;
}

export interface AgentTemporalMemoryDigestJob {
  readonly digestId: string;
  readonly nextAttemptAtMs: number;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export interface AgentTemporalMemoryDigestCount {
  readonly granularity: AgentTemporalMemoryGranularity;
  readonly status: AgentTemporalMemoryDigestStatus;
  readonly count: number;
}

export interface AgentTemporalMemoryOverview {
  readonly counts: readonly AgentTemporalMemoryDigestCount[];
  readonly segmentDecisions: readonly {
    readonly status: AgentConversationSegmentDecisionStatus;
    readonly count: number;
  }[];
  readonly latestSealed: readonly AgentTemporalMemoryDigest[];
}

export interface AgentTemporalMemorySummaryEntry {
  readonly uri: string;
  readonly occurredAt: string;
  readonly kind: string;
  readonly summary: string;
  readonly summaryParts?: AgentTextParts;
  readonly text?: string;
  readonly toolName?: string;
}

export interface AgentTemporalMemorySummaryPromptInput {
  readonly granularity: AgentTemporalMemoryGranularity;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly timeZone: string;
  readonly entries: readonly AgentTemporalMemorySummaryEntry[];
}

export interface AgentTemporalMemorySummaryResult {
  readonly summary: string | AgentTextParts;
  readonly topics: readonly (string | AgentTextParts)[];
  readonly openLoops: readonly (string | AgentTextParts)[];
}

export interface AgentTemporalMemoryRange {
  readonly start: string;
  readonly end: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly timeZone: string;
}

export interface AgentTemporalMemoryRuntimePolicy {
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryMaxDelayMs: number;
  readonly maxJobsPerDrain: number;
}

export interface AgentTemporalMemorySummaryClient {
  summarize(input: AgentTemporalMemorySummaryPromptInput): Promise<AgentTemporalMemorySummaryResult>;
}

export type AgentConversationBoundaryRelation = "continue" | "boundary";

export interface AgentConversationBoundaryTurn {
  readonly episodeUri: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly user: string;
  readonly assistant: string;
  readonly tools: readonly {
    readonly name: string;
    readonly summary: string;
    readonly content: string;
  }[];
}

export interface AgentConversationBoundaryPromptInput {
  readonly timeZone: string;
  readonly elapsedSeconds: number;
  readonly sameLocalDate: boolean;
  readonly anchors: readonly string[];
  readonly openSegment: {
    readonly digestUri: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly focus: string | null;
    readonly turns: readonly AgentConversationBoundaryTurn[];
  };
  readonly candidate: AgentConversationBoundaryTurn;
}

export interface AgentConversationBoundaryResult {
  readonly relation: AgentConversationBoundaryRelation;
  readonly confidence: number;
  /** Grounded topic state for classifying the next turn; never promoted as memory evidence. */
  readonly focus: string;
}

export interface AgentConversationBoundaryClient {
  classify(input: AgentConversationBoundaryPromptInput): Promise<AgentConversationBoundaryResult>;
}

export type AgentConversationSegmentDecisionStatus = "pending" | "resolved" | "failed";
export type AgentConversationSegmentDecisionRelation = "start" | AgentConversationBoundaryRelation;

export interface AgentConversationSegmentDecision {
  readonly episodeUri: string;
  readonly scopeKey: string;
  readonly sessionId: string;
  readonly sourceRevision: string;
  readonly completedAtMs: number;
  readonly status: AgentConversationSegmentDecisionStatus;
  readonly relation: AgentConversationSegmentDecisionRelation | null;
  readonly confidence: number | null;
  readonly predecessorDigestUri: string | null;
  readonly assignedDigestUri: string | null;
  readonly nextAttemptAtMs: number;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AgentTemporalMemoryIdentity = Pick<
  AgentContinuityIdentityContext,
  "workspaceId" | "accountId" | "userId" | "worldId"
>;
