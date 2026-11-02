import type { AgentContinuityMemoryPromptContext } from "./AgentContinuityMemoryTypes.js";
import { AgentMemoryRecallSnapshotSchema, type AgentMemoryRecallSnapshot } from "./AgentMemoryRecallContract.js";
import { summarizeAgentMemoryRecall } from "./AgentMemoryRecallRanking.js";

/** Browser-safe record of the MemOS memory actually selected for this turn. */
export type AgentContinuitySnapshot = AgentMemoryRecallSnapshot;

export function projectAgentContinuitySnapshot(memory: AgentContinuityMemoryPromptContext): AgentContinuitySnapshot {
  return AgentMemoryRecallSnapshotSchema.parse({
    enabled: memory.enabled,
    ...(memory.query ? { query: memory.query } : {}),
    eventCandidates: memory.eventCandidates.map(({ dedupeKeys: _dedupeKeys, ...event }) => ({
      ...event,
      matchedBy: [...event.matchedBy],
      ...(event.scores ? { scores: { ...event.scores } } : {}),
    })),
    ...(memory.snapshotGeneration !== undefined ? { snapshotGeneration: memory.snapshotGeneration } : {}),
    ...(memory.diagnostics ? { diagnostics: memory.diagnostics } : {}),
    ...(memory.retrieval ? { retrieval: memory.retrieval } : {}),
    ...(memory.currentQuality ? { currentQuality: memory.currentQuality } : {}),
    metrics: summarizeAgentMemoryRecall(
      [...memory.eventCandidates, ...(memory.taskCandidates ?? []), ...(memory.relatedCandidates ?? [])],
      memory.currentQuality,
    ),
    ...(memory.taskCandidates
      ? {
          taskCandidates: memory.taskCandidates.map(({ dedupeKeys: _keys, ...entry }) => ({
            ...entry,
            matchedBy: [...entry.matchedBy],
          })),
        }
      : {}),
    selection: {
      ...memory.selection,
      events: { ...memory.selection.events },
    },
    ...(memory.relatedCandidates
      ? {
          relatedCandidates: memory.relatedCandidates.map(({ dedupeKeys: _keys, ...entry }) => ({
            ...entry,
            matchedBy: [...entry.matchedBy],
          })),
        }
      : {}),
  });
}
