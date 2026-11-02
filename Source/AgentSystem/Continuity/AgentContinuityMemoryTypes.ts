import type {
  AgentMemoryRecallSnapshot,
  AgentMemoryRecallEntry,
  AgentMemoryScoreBreakdown,
} from "./AgentMemoryRecallContract.js";

export type AgentContinuityScoreBreakdown = Readonly<AgentMemoryScoreBreakdown>;

export type AgentContinuityEventCandidate = Readonly<Omit<AgentMemoryRecallEntry, "matchedBy">> & {
  readonly matchedBy: readonly string[];
  /** Host-only keys used to suppress native near-duplicate candidates. */
  readonly dedupeKeys?: readonly string[];
};

export type AgentContinuityRecallSelection = AgentMemoryRecallSnapshot["selection"];
export type AgentContinuityRecallSelectionCount = AgentContinuityRecallSelection["events"];

/** The complete automatic prompt-memory surface. Period summaries are explicit-recall only. */
export type AgentContinuityMemoryPromptContext = Readonly<
  Omit<AgentMemoryRecallSnapshot, "eventCandidates" | "taskCandidates" | "relatedCandidates">
> & {
  readonly eventCandidates: readonly AgentContinuityEventCandidate[];
  /** Working state belonging to the active session task. */
  readonly taskCandidates?: readonly AgentContinuityEventCandidate[];
  /** Query-selected knowledge and historical experience from accessible conversations. */
  readonly relatedCandidates?: readonly AgentContinuityEventCandidate[];
  /** Markdown captured with the long-term snapshot, never repeated in turn context. */
  readonly diaryIndex?: string;
};

export const EmptyAgentContinuityMemoryPromptContext: AgentContinuityMemoryPromptContext = {
  enabled: false,
  eventCandidates: [],
  selection: {
    events: { available: 0, matched: 0, selected: 0 },
    usedTokens: 0,
    maxTokens: 0,
  },
};
