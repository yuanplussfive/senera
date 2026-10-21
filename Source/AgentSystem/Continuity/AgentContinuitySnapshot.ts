import type {
  AgentContinuityMemoryPromptContext,
  AgentContinuityDigestPromptEntry,
  AgentContinuityEventCandidate,
} from "./AgentContinuityMemoryTypes.js";

/** Browser-safe record of the MemOS memory actually selected for this turn. */
export type AgentContinuitySnapshot = Omit<
  AgentContinuityMemoryPromptContext,
  "deliveryEpoch" | "periodDigests" | "eventCandidates"
> & {
  readonly periodDigests: readonly Omit<AgentContinuityDigestPromptEntry, "deliveryKeys">[];
  readonly eventCandidates: readonly Omit<AgentContinuityEventCandidate, "deliveryKeys">[];
};

export function projectAgentContinuitySnapshot(memory: AgentContinuityMemoryPromptContext): AgentContinuitySnapshot {
  return {
    enabled: memory.enabled,
    ...(memory.query ? { query: memory.query } : {}),
    periodDigests: memory.periodDigests.map(({ deliveryKeys: _deliveryKeys, ...digest }) => ({
      ...digest,
      matchedBy: [...digest.matchedBy],
      ...(digest.scores ? { scores: { ...digest.scores } } : {}),
    })),
    eventCandidates: memory.eventCandidates.map(({ deliveryKeys: _deliveryKeys, ...event }) => ({
      ...event,
      matchedBy: [...event.matchedBy],
      ...(event.scores ? { scores: { ...event.scores } } : {}),
    })),
    selection: {
      ...memory.selection,
      digests: { ...memory.selection.digests },
      events: { ...memory.selection.events },
    },
  };
}
