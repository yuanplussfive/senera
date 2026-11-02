import { z } from "zod";
import { AgentMemoryRetentionSchema } from "./AgentMemoryRetention.js";

/** Browser-safe contract shared by the producer, live reducer and history replay. */
export const AgentMemoryQualitySchema = z
  .object({
    weight: z.number().min(0).max(100),
    recallCount: z.number().int().nonnegative(),
    helpfulCount: z.number().int().nonnegative(),
    unhelpfulCount: z.number().int().nonnegative(),
    unusedCount: z.number().int().nonnegative(),
    uncertainCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
  })
  .strict();

export const AgentMemoryScoresSchema = z
  .object({
    keyword: z.number().optional(),
    semantic: z.number().optional(),
    hybrid: z.number().optional(),
    relevance: z.number().min(0).max(1).optional(),
    recency: z.number().min(0).max(1).optional(),
  })
  .strict();

export const AgentMemoryRecallEntrySchema = z
  .object({
    id: z.string(),
    uri: z.string(),
    revision: z.string(),
    type: z.enum(["fact", "preference", "relationship", "context"]),
    summary: z.string(),
    occurredAt: z.string(),
    score: z.number().finite(),
    matchedBy: z.array(z.string()),
    scores: AgentMemoryScoresSchema.optional(),
    quality: AgentMemoryQualitySchema.optional(),
    reserved: z.boolean().optional(),
    retention: AgentMemoryRetentionSchema.optional(),
  })
  .strict();

const Count = z.number().int().nonnegative();
const ScoreSummary = z
  .object({ count: Count, average: z.number().finite().optional(), max: z.number().finite().optional() })
  .strict();
export const AgentMemoryRecallMetricsSchema = z
  .object({ ranking: ScoreSummary, relevance: ScoreSummary, quality: ScoreSummary.optional() })
  .strict();
const Latency = z.number().finite().nonnegative();
export const AgentMemoryRetrievalSchema = z
  .object({
    totalLatencyMs: Latency,
    background: z
      .object({
        source: z.enum(["query", "global_preferences", "frozen"]),
        queryCandidates: z.number().int().nonnegative(),
        globalPreferenceCandidates: z.number().int().nonnegative(),
        keywordMatches: z.number().int().nonnegative(),
        semanticMatches: z.number().int().nonnegative(),
        searchLatencyMs: Latency.optional(),
        assessmentLatencyMs: Latency.optional(),
        status: z.enum(["completed", "unavailable"]).optional(),
      })
      .strict(),
    task: z
      .object({
        latencyMs: Latency,
        candidates: z.number().int().nonnegative(),
        status: z.enum(["completed", "unavailable"]).optional(),
      })
      .strict(),
    related: z
      .object({ latencyMs: Latency, candidates: Count, status: z.enum(["not_needed", "completed", "unavailable"]) })
      .strict()
      .optional(),
  })
  .strict();
export const AgentMemorySelectionCountSchema = z.object({ available: Count, matched: Count, selected: Count }).strict();
export const AgentMemoryRecallSnapshotSchema = z
  .object({
    enabled: z.boolean(),
    query: z.string().optional(),
    eventCandidates: z.array(AgentMemoryRecallEntrySchema),
    taskCandidates: z.array(AgentMemoryRecallEntrySchema).optional(),
    relatedCandidates: z.array(AgentMemoryRecallEntrySchema).optional(),
    snapshotGeneration: Count.optional(),
    /** Producer aggregates the actual ranking and assessed relevance independently. */
    metrics: AgentMemoryRecallMetricsSchema.optional(),
    retrieval: AgentMemoryRetrievalSchema.optional(),
    /** Live ledger values; these never change the frozen system-memory entries. */
    currentQuality: z.record(z.string(), AgentMemoryQualitySchema).optional(),
    diagnostics: z
      .object({
        unassigned: Count,
        otherSubject: Count,
        irrelevant: Count,
        snapshotReused: z.boolean(),
        relevanceStatus: z.enum(["not_needed", "completed", "unavailable"]).optional(),
      })
      .strict()
      .optional(),
    selection: z
      .object({
        events: AgentMemorySelectionCountSchema,
        tasks: AgentMemorySelectionCountSchema.optional(),
        related: AgentMemorySelectionCountSchema.optional(),
        usedTokens: Count,
        maxTokens: Count,
      })
      .strict(),
  })
  .strict();

export type AgentMemoryRecallSnapshot = z.infer<typeof AgentMemoryRecallSnapshotSchema>;
export type AgentMemoryRecallEntry = z.infer<typeof AgentMemoryRecallEntrySchema>;
export type AgentMemoryQualityData = z.infer<typeof AgentMemoryQualitySchema>;
export type AgentMemoryScoreBreakdown = z.infer<typeof AgentMemoryScoresSchema>;
