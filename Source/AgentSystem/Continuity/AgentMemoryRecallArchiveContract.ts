import { z } from "zod";
import {
  AgentMemoryQualitySchema,
  AgentMemoryRecallEntrySchema,
  AgentMemoryRecallSnapshotSchema,
  type AgentMemoryRecallEntry,
} from "./AgentMemoryRecallContract.js";

/** Explicit decoder for historical events. Retired truth scores are never reinterpreted as task weight. */
const RetiredQualitySchema = z
  .object({
    confidence: z.number().min(0).max(100),
    importance: z.number().min(0).max(100),
    usefulness: z.number().min(0).max(100),
    recallCount: z.number().int().nonnegative(),
    evidenceCount: z.number().int().nonnegative(),
    reinforcedRecallCount: z.number().int().nonnegative().optional(),
    rankingScore: z.number().min(0).max(100).optional(),
  })
  .strict();
const ArchivedQualitySchema = z.union([AgentMemoryQualitySchema, RetiredQualitySchema]);
const ArchivedEntrySchema = AgentMemoryRecallEntrySchema.extend({ quality: ArchivedQualitySchema.optional() });

function currentEntry(entry: z.infer<typeof ArchivedEntrySchema>): AgentMemoryRecallEntry {
  const { quality, ...record } = entry;
  return quality && "weight" in quality ? { ...record, quality } : record;
}

export const AgentMemoryRecallArchiveSnapshotSchema = AgentMemoryRecallSnapshotSchema.extend({
  eventCandidates: z.array(ArchivedEntrySchema),
  taskCandidates: z.array(ArchivedEntrySchema).optional(),
  relatedCandidates: z.array(ArchivedEntrySchema).optional(),
  currentQuality: z.record(z.string(), ArchivedQualitySchema).optional(),
}).transform(({ currentQuality, metrics, eventCandidates, taskCandidates, relatedCandidates, ...snapshot }) => {
  const qualities = Object.entries(currentQuality ?? {}).flatMap(([id, quality]) =>
    "weight" in quality ? [[id, quality] as const] : [],
  );
  const hasRetiredQuality =
    (currentQuality !== undefined && qualities.length !== Object.keys(currentQuality).length) ||
    [...eventCandidates, ...(taskCandidates ?? []), ...(relatedCandidates ?? [])].some(
      (entry) => entry.quality && !("weight" in entry.quality),
    );
  return {
    ...snapshot,
    eventCandidates: eventCandidates.map(currentEntry),
    ...(taskCandidates ? { taskCandidates: taskCandidates.map(currentEntry) } : {}),
    ...(relatedCandidates ? { relatedCandidates: relatedCandidates.map(currentEntry) } : {}),
    ...(currentQuality ? { currentQuality: Object.fromEntries(qualities) } : {}),
    ...(metrics
      ? { metrics: hasRetiredQuality ? { ranking: metrics.ranking, relevance: metrics.relevance } : metrics }
      : {}),
  };
});
