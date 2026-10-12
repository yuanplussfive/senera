import { z } from "zod";
import type {
  ContinuityRecallQueryData,
  ContinuityRecallSettledData,
  ContinuitySnapshotData,
  ExecutionEventData,
  PromptHarnessComposedData,
  TodoSnapshotData,
} from "./eventTypes";

const NonNegativeIntegerSchema = z.number().int().nonnegative();

const SelectionCountSchema = z.object({
  available: NonNegativeIntegerSchema,
  matched: NonNegativeIntegerSchema,
  selected: NonNegativeIntegerSchema,
});

const ExecutionStepSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  planId: z.string(),
  planRevision: NonNegativeIntegerSchema,
  index: NonNegativeIntegerSchema,
  title: z.string(),
  detail: z.string(),
  status: z.enum(["planned", "running", "completed", "failed", "blocked"]),
  dependencyIds: z.array(z.string()),
  callId: z.string().optional(),
  failure: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ExecutionSchema = z.object({
  id: z.string(),
  uri: z.string(),
  sessionId: z.string(),
  requestId: z.string(),
  objective: z.string(),
  status: z.enum(["active", "paused", "blocked", "completed", "cancelled"]),
  reason: z.string().optional(),
  steps: z.array(ExecutionStepSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});

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

const ExecutionSnapshotSchema = z.object({ active: ExecutionSchema.nullable(), executions: z.array(ExecutionSchema) });
const TodoSnapshotSchema = z.object({ items: z.array(TodoSchema), counts: TodoCountsSchema });
const ContinuitySnapshotSchema: z.ZodType<ContinuitySnapshotData> = z
  .object({
    enabled: z.boolean(),
    query: z.string().optional(),
    periodDigests: z.array(
      z
        .object({
          id: z.string(),
          uri: z.string(),
          revision: z.string(),
          granularity: z.enum(["day", "month"]),
          periodStart: z.string(),
          periodEnd: z.string(),
          summary: z.string(),
          score: z.number(),
          matchedBy: z.array(z.string()),
          scores: z
            .object({
              keyword: z.number().optional(),
              semantic: z.number().optional(),
              hybrid: z.number().optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    eventCandidates: z.array(
      z
        .object({
          id: z.string(),
          uri: z.string(),
          revision: z.string(),
          type: z.enum(["fact", "preference", "relationship", "context", "entity", "custom"]),
          summary: z.string(),
          occurredAt: z.string(),
          score: z.number(),
          matchedBy: z.array(z.string()),
          scores: z
            .object({
              keyword: z.number().optional(),
              semantic: z.number().optional(),
              hybrid: z.number().optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    selection: z
      .object({
        digests: SelectionCountSchema,
        events: SelectionCountSchema,
        usedTokens: NonNegativeIntegerSchema,
        maxTokens: NonNegativeIntegerSchema,
      })
      .strict(),
  })
  .strict();

export function readContinuitySnapshotData(value: unknown): ContinuitySnapshotData | undefined {
  const parsed = ContinuitySnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readExecutionEventData(value: unknown): ExecutionEventData | undefined {
  const parsed = z
    .object({
      snapshot: ExecutionSnapshotSchema,
      execution: ExecutionSchema,
      step: ExecutionStepSchema.optional(),
    })
    .safeParse(value);
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
