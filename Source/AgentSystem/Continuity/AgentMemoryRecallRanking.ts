import type { ScoredMemory } from "@mem-os/sdk";
import type { AgentMemoryQuality } from "./AgentMemoryLearningLedger.js";
import type { AgentMemoryRecallEntry, AgentMemoryRecallSnapshot } from "./AgentMemoryRecallContract.js";

/** Use raw channel evidence, never the SDK's trust-weighted hybrid score. */
export function agentMemoryRelevance(memory: Pick<ScoredMemory, "score" | "scores">): number {
  const channels = [memory.scores?.keyword, memory.scores?.semantic].filter(
    (score): score is number => score !== undefined && Number.isFinite(score),
  );
  return channels.length
    ? channels.reduce((sum, score) => sum + Math.max(0, Math.min(1, score)), 0) / channels.length
    : memory.score;
}

/** The ledger is the sole owner of memory weight. */
export function agentMemoryQualityWeight(quality?: AgentMemoryQuality): number {
  return quality ? quality.weight / 100 : 1;
}

/** Audit the scores used by recall; a missing relevance assessment is never a ranking score. */
export function summarizeAgentMemoryRecall(
  records: readonly Pick<AgentMemoryRecallEntry, "score" | "scores">[],
  currentQuality?: Readonly<Record<string, AgentMemoryQuality>>,
): NonNullable<AgentMemoryRecallSnapshot["metrics"]> {
  const summarize = (values: readonly number[]) => ({
    count: values.length,
    ...(values.length
      ? { average: values.reduce((sum, value) => sum + value, 0) / values.length, max: Math.max(...values) }
      : {}),
  });
  return {
    ranking: summarize(records.map((record) => record.score)),
    relevance: summarize(
      records.flatMap((record) => (record.scores?.relevance === undefined ? [] : [record.scores.relevance])),
    ),
    ...(currentQuality
      ? {
          quality: summarize(Object.values(currentQuality).map((quality) => quality.weight)),
        }
      : {}),
  };
}
