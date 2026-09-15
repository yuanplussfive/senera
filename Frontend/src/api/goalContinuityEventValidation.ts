import { z } from "zod";
import type {
  ContinuityRecallQueryData,
  ContinuityRecallSettledData,
  ContinuityRulesSnapshotData,
  ContinuitySnapshotData,
  AgendaSnapshotData,
  WorldSnapshotData,
  ExecutionEventData,
  PromptHarnessComposedData,
  TodoSnapshotData,
} from "./eventTypes";

const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

const SelectionCountSchema = z.object({
  available: NonNegativeIntegerSchema,
  matched: NonNegativeIntegerSchema,
  selected: NonNegativeIntegerSchema,
});

const AgendaActorSchema = z.object({
  id: z.string(),
  uri: z.string(),
  createdAt: z.string(),
  worldId: z.string(),
  role: z.enum(["user", "resident", "system"]),
});

const AgendaRecordSchema = z.object({
  id: z.string(),
  revision: PositiveIntegerSchema,
  uri: z.string(),
  worldId: z.string(),
  actorId: z.string(),
  kind: z.enum(["goal", "activity", "event", "schedule"]),
  actor: AgendaActorSchema,
  summary: z.string(),
  status: z.enum(["planned", "active", "paused", "completed", "cancelled", "recorded"]),
  dueAt: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  relatedRecordId: z.string().nullable(),
  detail: z.string().nullable(),
  intentMode: z.enum(["suggested", "tentative", "committed", "observed"]).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  progress: z.number().min(0).max(1).optional(),
  successCriteria: z.array(z.string()).optional(),
  nextReviewAt: z.string().nullable().optional(),
  blockedReason: z.string().nullable().optional(),
  statusReason: z.string().nullable().optional(),
  parentGoalId: z.string().nullable().optional(),
  ownerSessionId: z.string().nullable().optional(),
  lastDecisionKey: z.string().nullable().optional(),
  sourceRefs: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastEventId: z.string(),
});

const AgendaSnapshotSchema: z.ZodType<AgendaSnapshotData> = z.object({
  world: z.object({
    id: z.string(),
    uri: z.string(),
    timeZone: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  clock: z.object({
    instant: z.string(),
    timeZone: z.string(),
    localDate: z.string(),
    localTime: z.string(),
    weekdayLabel: z.string(),
  }),
  records: z.array(AgendaRecordSchema),
  activeGoals: z.array(AgendaRecordSchema),
  currentActivities: z.array(AgendaRecordSchema),
  timeline: z.array(
    z.object({
      id: z.string(),
      recordId: z.string(),
      recordKind: z.enum(["goal", "activity", "event", "schedule"]),
      actorRole: z.enum(["user", "resident", "system"]),
      eventKind: z.enum([
        "declared",
        "started",
        "progressed",
        "paused",
        "finished",
        "cancelled",
        "occurred",
        "due",
        "evidence_attached",
      ]),
      summary: z.string(),
      detail: z.string().nullable(),
      occurredAt: z.string(),
      sourceRefs: z.array(z.string()),
    }),
  ),
  upcoming: z.array(AgendaRecordSchema),
});

const WorldSnapshotSchema: z.ZodType<WorldSnapshotData> = z.object({
  enabled: z.literal(true),
  world: z.object({ id: z.string(), name: z.string(), timeZone: z.string() }),
  time: z.object({
    instant: z.string(),
    timeZone: z.string(),
    localDate: z.string(),
    localTime: z.string(),
    weekday: z.number().int(),
    weekdayLabel: z.string(),
    phaseId: z.string(),
    phaseLabel: z.string(),
    dayElapsedSeconds: z.number().nonnegative(),
    dayElapsed: z.string(),
    dayRemainingSeconds: z.number().nonnegative(),
    dayRemaining: z.string(),
  }),
  calendar: z.object({
    date: z.string(),
    isHoliday: z.boolean(),
    isWorkday: z.boolean(),
    isPublicHoliday: z.boolean(),
    isPublicWorkday: z.boolean(),
    holidayName: z.string().nullable(),
    lunarSummary: z.string(),
  }),
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      label: z.string(),
      parentId: z.string().nullable(),
      depth: z.number().int().nonnegative(),
      lastChangedAt: z.string().nullable(),
      children: z.array(z.string()),
      attributes: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      subjectId: z.string(),
      relation: z.string(),
      relationLabel: z.string().optional(),
      inverseRelation: z.string().optional(),
      objectId: z.string(),
      validFrom: z.string().optional(),
      validUntil: z.string().optional(),
      confidence: z.number().optional(),
      sourceRefs: z.array(z.string()).optional(),
    }),
  ),
  timeline: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      occurredAt: z.string(),
      summary: z.string(),
      source: z.string(),
      changedEntityIds: z.array(z.string()),
    }),
  ),
  changedNodeIds: z.array(z.string()),
  nextSchedules: z.array(
    z.object({
      scheduleId: z.string(),
      label: z.string(),
      at: z.string(),
      actorId: z.string(),
      actorRole: z.enum(["user", "resident", "system"]),
      kind: z.enum(["goal", "activity", "event", "schedule", "habit"]),
      source: z.enum(["agenda", "habit"]),
    }),
  ),
  commitments: z.array(
    z.object({
      id: z.string(),
      revision: PositiveIntegerSchema,
      label: z.string(),
      actorId: z.string(),
      actorRole: z.enum(["user", "resident", "system"]),
      status: z.enum(["planned", "active", "paused", "completed", "cancelled", "recorded"]),
      dueAt: z.string().nullable(),
      startsAt: z.string().nullable(),
      endsAt: z.string().nullable(),
      detail: z.string().nullable(),
      intentMode: z.enum(["suggested", "tentative", "committed", "observed"]).optional(),
      priority: z.number().int().min(0).max(100).optional(),
      progress: z.number().min(0).max(1).optional(),
      successCriteria: z.array(z.string()).optional(),
      nextReviewAt: z.string().nullable().optional(),
      blockedReason: z.string().nullable().optional(),
      statusReason: z.string().nullable().optional(),
      parentGoalId: z.string().nullable().optional(),
      ownerSessionId: z.string().nullable().optional(),
      sourceRefs: z.array(z.string()),
      updatedAt: z.string().nullable(),
    }),
  ),
  resident: z.object({
    residentId: z.string().nullable(),
    userId: z.string().nullable(),
    location: z.string().nullable(),
    activity: z.string().nullable(),
    bodyState: z.string().nullable(),
    emotionState: z.string().nullable(),
    interruptedBy: z.string().nullable(),
    relationship: z.string().nullable(),
    nextPlan: z
      .object({
        scheduleId: z.string(),
        label: z.string(),
        at: z.string(),
        actorId: z.string(),
        actorRole: z.enum(["user", "resident", "system"]),
        kind: z.enum(["goal", "activity", "event", "schedule", "habit"]),
        source: z.enum(["agenda", "habit"]),
      })
      .nullable(),
  }),
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

const RuleTruthSchema = z.enum(["true", "false", "unknown"]);
const ContinuityRuleSchema = z.object({
  uri: z.string(),
  title: z.string(),
  action: z.string(),
  actionKind: z.enum(["recall", "notify"]),
  activation: z.enum(["while_true", "once"]),
  status: z.enum(["armed", "partial", "triggered", "resolved", "cancelled", "expired"]),
  truth: RuleTruthSchema,
  score: z.number(),
  threshold: z.number(),
  missingSignals: z.array(z.string()),
  conditions: z.array(
    z.object({
      label: z.string(),
      truth: RuleTruthSchema,
      score: z.number(),
      actual: z.union([z.string(), z.number(), z.boolean()]).optional(),
    }),
  ),
  authority: z.string(),
  confidence: z.number().min(0).max(1),
  supportCount: NonNegativeIntegerSchema,
  maturity: z.enum(["candidate", "active", "established"]),
  validUntil: z.string().optional(),
  lastEvaluatedAt: z.string().optional(),
  lastTriggeredAt: z.string().optional(),
});
const ContinuitySignalSchema = z.object({
  uri: z.string(),
  summary: z.string(),
  valueJson: z.string(),
  valueType: z.enum(["boolean", "number", "string", "json"]),
  observedAt: z.string(),
  expiresAt: z.string().optional(),
});
const ExecutionSnapshotSchema = z.object({
  active: ExecutionSchema.nullable(),
  executions: z.array(ExecutionSchema),
});
const TodoSnapshotSchema: z.ZodType<TodoSnapshotData> = z.object({
  items: z.array(TodoSchema),
  counts: TodoCountsSchema,
});

const ContinuitySnapshotSchema: z.ZodType<ContinuitySnapshotData> = z.object({
  enabled: z.boolean(),
  concepts: z.array(
    z.object({
      uri: z.string(),
      label: z.string(),
      aliases: z.array(z.string()),
      entityKind: z.string().optional(),
      scope: z.object({ kind: z.string(), id: z.string() }),
      recordKinds: z.array(z.enum(["fact", "profile", "signal", "rule"])),
      recordCount: NonNegativeIntegerSchema,
      updatedAt: z.string(),
    }),
  ),
  graph: z
    .object({
      scope: z.array(z.object({ kind: z.string(), id: z.string() })),
      entities: z.array(
        z.object({
          uri: z.string(),
          label: z.string(),
          aliases: z.array(z.string()),
          kind: z.string(),
          scope: z.object({ kind: z.string(), id: z.string() }),
          status: z.enum(["active", "merged", "retired"]),
          mergedIntoUri: z.string().nullable(),
          createdAt: z.string(),
          updatedAt: z.string(),
        }),
      ),
      relations: z.array(
        z.object({
          id: z.string(),
          uri: z.string(),
          subjectUri: z.string(),
          relationId: z.string(),
          relationLabel: z.string(),
          objectUri: z.string(),
          scope: z.object({ kind: z.string(), id: z.string() }),
          cardinality: z.enum(["many_to_many", "single_subject"]),
          temporal: z.object({
            kind: z.enum(["persistent", "instant", "interval", "until_condition", "recurring"]),
            startsAt: z.string().optional(),
            endsAt: z.string().optional(),
            timeZone: z.string(),
          }),
          authority: z.string(),
          confidence: z.number(),
          sourceRefs: z.array(z.string()),
          supportCount: NonNegativeIntegerSchema,
          supportMass: z.number().min(0).max(1),
          maturity: z.enum(["candidate", "active", "established"]),
          status: z.enum(["active", "superseded", "retracted"]),
          supersededBy: z.string().nullable(),
          createdAt: z.string(),
          updatedAt: z.string(),
        }),
      ),
    })
    .optional(),
  graphRelations: z
    .array(
      z.object({
        subject: z.string(),
        subjectKind: z.string(),
        relationId: z.string(),
        relation: z.string(),
        object: z.string(),
        objectKind: z.string(),
        temporal: z.object({
          kind: z.enum(["persistent", "instant", "interval", "until_condition", "recurring"]),
          startsAt: z.string().optional(),
          endsAt: z.string().optional(),
          timeZone: z.string(),
        }),
        confidence: z.number(),
        maturity: z.enum(["candidate", "active", "established"]),
      }),
    )
    .optional(),
  temporalMemory: z
    .object({
      counts: z.array(
        z.object({
          granularity: z.enum(["segment", "day", "month"]),
          status: z.enum(["open", "pending", "sealed", "failed", "stale"]),
          count: NonNegativeIntegerSchema,
        }),
      ),
      segmentDecisions: z.array(
        z.object({
          status: z.enum(["pending", "resolved", "failed"]),
          count: NonNegativeIntegerSchema,
        }),
      ),
      latestSealed: z.array(
        z.object({
          uri: z.string(),
          granularity: z.enum(["segment", "day", "month"]),
          periodStart: z.string(),
          periodEnd: z.string(),
          timeZone: z.string(),
          summary: z.string(),
          topics: z.array(z.string()),
          openLoops: z.array(z.string()),
          sourceCount: NonNegativeIntegerSchema,
        }),
      ),
    })
    .optional(),
  residentProfile: z.array(
    z.object({
      subject: z.enum(["agent", "user"]),
      key: z.string(),
      valueJson: z.string(),
      claim: z.string(),
      validUntil: z.string().optional(),
      maturity: z.enum(["candidate", "active", "established"]).optional(),
      supportCount: z.number().int().nonnegative().optional(),
    }),
  ),
  factCatalog: z.array(
    z.object({
      factKey: z.string(),
      claim: z.string(),
      sourceRefs: z.array(z.string()),
      confidence: z.number(),
      authority: z.string(),
      validFrom: z.string().optional(),
      validUntil: z.string().optional(),
      supportCount: NonNegativeIntegerSchema.optional(),
      supportMass: z.number().min(0).max(1).optional(),
      maturity: z.enum(["candidate", "active", "established"]).optional(),
      updatedAt: z.string(),
      score: z.number(),
      matchedBy: z.array(z.string()),
    }),
  ),
  selection: z.object({
    profiles: SelectionCountSchema,
    facts: SelectionCountSchema,
    relations: SelectionCountSchema.optional(),
    events: SelectionCountSchema,
    evidence: SelectionCountSchema,
    usedCharacters: NonNegativeIntegerSchema,
    maxCharacters: PositiveIntegerSchema,
  }),
  rejections: z
    .object({
      belowSimilarity: NonNegativeIntegerSchema,
      belowCandidate: NonNegativeIntegerSchema,
      funnelSkipped: NonNegativeIntegerSchema,
    })
    .optional(),
  nearMisses: z
    .array(
      z.object({
        summary: z.string(),
        score: z.number(),
        textSimilarityScore: z.number(),
        lexicalScore: z.number(),
        semanticScore: z.number(),
        matchedBy: z.array(z.string()),
      }),
    )
    .optional(),
  preset: z.object({
    enabled: z.boolean(),
    activePresetName: z.string().nullable(),
    title: z.string().optional(),
    corePersona: z.string().optional(),
    languageStyle: z.string().optional(),
  }),
  evidenceCandidates: z.array(
    z.object({
      sourceRefs: z.array(z.string()),
      score: z.number(),
      matchedBy: z.array(z.string()),
    }),
  ),
  eventCandidates: z.array(
    z.object({
      sourceRefs: z.array(z.string()),
      summary: z.string(),
      occurredAt: z.string(),
      score: z.number(),
      matchedBy: z.array(z.string()),
    }),
  ),
  rules: z.array(ContinuityRuleSchema),
  signals: z.array(ContinuitySignalSchema),
});

/** Rejects incomplete history records before they can enter the UI store. */
export function readContinuitySnapshotData(value: unknown): ContinuitySnapshotData | undefined {
  const parsed = ContinuitySnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readAgendaSnapshotData(value: unknown): { snapshot: AgendaSnapshotData } | undefined {
  const parsed = z.object({ snapshot: AgendaSnapshotSchema }).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readWorldSnapshotData(value: unknown): { snapshot: WorldSnapshotData } | undefined {
  const parsed = z.object({ snapshot: WorldSnapshotSchema }).safeParse(value);
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

export function readContinuityRulesSnapshotData(value: unknown): ContinuityRulesSnapshotData | undefined {
  const parsed = z
    .object({ rules: z.array(ContinuityRuleSchema), signals: z.array(ContinuitySignalSchema) })
    .safeParse(value);
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
