import { z } from "zod";
import { AgentMemoryRecallArchiveSnapshotSchema } from "../../../Source/AgentSystem/Continuity/AgentMemoryRecallArchiveContract";
import type {
  ContinuityRecallQueryData,
  ContinuityRecallSettledData,
  ContinuitySnapshotData,
  PromptHarnessComposedData,
  TodoSnapshotData,
} from "./eventTypes";

const NonNegativeIntegerSchema = z.number().int().nonnegative();

const TodoSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  order: NonNegativeIntegerSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const TodoCountsSchema = z.object({
  total: NonNegativeIntegerSchema,
  pending: NonNegativeIntegerSchema,
  inProgress: NonNegativeIntegerSchema,
  completed: NonNegativeIntegerSchema,
  cancelled: NonNegativeIntegerSchema,
});

const TodoSnapshotSchema = z.object({ items: z.array(TodoSchema), counts: TodoCountsSchema });
export function readContinuitySnapshotData(value: unknown): ContinuitySnapshotData | undefined {
  const parsed = AgentMemoryRecallArchiveSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readTodoSnapshotEventData(value: unknown): { snapshot: TodoSnapshotData } | undefined {
  const parsed = z.object({ snapshot: TodoSnapshotSchema }).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const ContinuityRecallLocalMatchSchema = z.object({
  label: z.string(),
  kind: z.string().optional(),
  score: z.number().min(0).max(1),
  direct: z.boolean(),
  matchedBy: z.array(z.enum(["phrase", "token", "fuzzy"])),
  matchedTerms: z.array(z.string()).optional(),
  matchedLabel: z.string().optional(),
  anchorEligible: z.boolean().optional(),
});

const ContinuityRecallLocalRelationSchema = z.object({
  relationId: z.string(),
  label: z.string(),
  score: z.number().min(0).max(1),
  direct: z.boolean(),
});

const ContinuityRecallLocalPlanSchema = z.object({
  terms: z.array(z.string()),
  concepts: z.array(ContinuityRecallLocalMatchSchema),
  entities: z.array(ContinuityRecallLocalMatchSchema),
  relations: z.array(ContinuityRecallLocalRelationSchema),
  anchorLabels: z.array(z.string()),
  expanded: z.boolean(),
});

const ContinuityRecallQuerySchema = z.object({
  original: z.string(),
  local: ContinuityRecallLocalPlanSchema.optional(),
});

const ContinuityRecallSettledSchema = z.object({
  injectedCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  matchedByCounts: z.object({
    textSimilarity: z.number().int().nonnegative(),
    lexical: z.number().int().nonnegative(),
    exactPhrase: z.number().int().nonnegative(),
    exactReference: z.number().int().nonnegative(),
    embedding: z.number().int().nonnegative(),
  }),
  directCount: z.number().int().nonnegative(),
  referenceCount: z.number().int().nonnegative(),
  nearMissCount: z.number().int().nonnegative(),
  belowSimilarity: z.number().int().nonnegative(),
  belowCandidate: z.number().int().nonnegative(),
  funnelSkipped: z.number().int().nonnegative(),
  degraded: z.enum(["none", "semantic_timeout", "semantic_unavailable"]),
  semanticStatus: z.enum([
    "short_query",
    "no_observations",
    "no_client",
    "no_embeddings",
    "model_mismatch",
    "no_vector",
    "dimension_mismatch",
    "request_failed",
    "completed",
    "disabled",
    "unavailable",
    "timeout",
  ]),
  semanticIndexedCount: z.number().int().nonnegative(),
  semanticCompatibleCount: z.number().int().nonnegative(),
  totalLatencyMs: z.number().int().nonnegative(),
});

export function readContinuityRecallQueryData(value: unknown): ContinuityRecallQueryData | undefined {
  const parsed = ContinuityRecallQuerySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readContinuityRecallSettledData(value: unknown): ContinuityRecallSettledData | undefined {
  const parsed = ContinuityRecallSettledSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const PromptHarnessComposedSchema = z.object({
  profile: z.enum(["native", "baml"]),
  sections: z.object({
    frozen: z.object({
      bytes: z.number().int().nonnegative(),
      tokens: z.number().int().nonnegative(),
      revision: z.string(),
    }),
    stable: z.object({
      bytes: z.number().int().nonnegative(),
      tokens: z.number().int().nonnegative(),
      revision: z.string(),
    }),
    volatile: z.object({
      bytes: z.number().int().nonnegative(),
      tokens: z.number().int().nonnegative(),
      revision: z.string(),
    }),
  }),
  merged: z.object({ bytes: z.number().int().nonnegative(), tokens: z.number().int().nonnegative() }),
});

export function readPromptHarnessComposedData(value: unknown): PromptHarnessComposedData | undefined {
  const parsed = PromptHarnessComposedSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
