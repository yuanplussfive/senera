export interface AgendaWorldData {
  id: string;
  uri: string;
  createdAt: string;
  updatedAt: string;
  timeZone: string;
}

export interface AgendaClockData {
  instant: string;
  timeZone: string;
  localDate: string;
  localTime: string;
  weekdayLabel: string;
}

export interface AgendaActorData {
  id: string;
  uri: string;
  worldId: string;
  role: "user" | "resident" | "system";
  createdAt: string;
}

export interface AgendaRecordData {
  id: string;
  revision: number;
  uri: string;
  worldId: string;
  actorId: string;
  kind: "goal" | "activity" | "event" | "schedule";
  actor: AgendaActorData;
  summary: string;
  status: "planned" | "active" | "paused" | "completed" | "cancelled" | "recorded";
  dueAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  relatedRecordId: string | null;
  detail: string | null;
  intentMode?: "suggested" | "tentative" | "committed" | "observed";
  priority?: number;
  progress?: number;
  successCriteria?: string[];
  nextReviewAt?: string | null;
  blockedReason?: string | null;
  statusReason?: string | null;
  parentGoalId?: string | null;
  ownerSessionId?: string | null;
  lastDecisionKey?: string | null;
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
  lastEventId: string;
}

export interface AgendaTimelineEntryData {
  id: string;
  recordId: string;
  recordKind: AgendaRecordData["kind"];
  actorRole: AgendaActorData["role"];
  eventKind:
    | "declared"
    | "started"
    | "progressed"
    | "paused"
    | "finished"
    | "cancelled"
    | "occurred"
    | "due"
    | "evidence_attached";
  summary: string;
  detail: string | null;
  occurredAt: string;
  sourceRefs: string[];
}

export interface AgendaSnapshotData {
  world: AgendaWorldData;
  clock: AgendaClockData;
  records: AgendaRecordData[];
  activeGoals: AgendaRecordData[];
  currentActivities: AgendaRecordData[];
  timeline: AgendaTimelineEntryData[];
  upcoming: AgendaRecordData[];
}

export interface AgendaSnapshotEventData {
  snapshot: AgendaSnapshotData;
}

export interface WorldSnapshotData {
  enabled: true;
  world: {
    id: string;
    name: string;
    timeZone: string;
  };
  time: {
    instant: string;
    timeZone: string;
    localDate: string;
    localTime: string;
    weekday: number;
    weekdayLabel: string;
    phaseId: string;
    phaseLabel: string;
    dayElapsedSeconds: number;
    dayElapsed: string;
    dayRemainingSeconds: number;
    dayRemaining: string;
  };
  calendar: {
    date: string;
    isHoliday: boolean;
    isWorkday: boolean;
    isPublicHoliday: boolean;
    isPublicWorkday: boolean;
    holidayName: string | null;
    lunarSummary: string;
  };
  nodes: Array<{
    id: string;
    kind: string;
    label: string;
    parentId: string | null;
    depth: number;
    lastChangedAt: string | null;
    children: string[];
    attributes: Array<{ key: string; value: string }>;
  }>;
  edges: Array<{
    id: string;
    subjectId: string;
    relation: string;
    relationLabel?: string;
    inverseRelation?: string;
    objectId: string;
    validFrom?: string;
    validUntil?: string;
    confidence?: number;
    sourceRefs?: string[];
  }>;
  timeline: Array<{
    id: string;
    type: string;
    occurredAt: string;
    summary: string;
    source: string;
    changedEntityIds: string[];
  }>;
  changedNodeIds: string[];
  nextSchedules: Array<{
    scheduleId: string;
    label: string;
    at: string;
    actorId: string;
    actorRole: AgendaRecordData["actor"]["role"];
    kind: AgendaRecordData["kind"] | "habit";
    source: "agenda" | "habit";
  }>;
  commitments: Array<{
    id: string;
    revision: number;
    label: string;
    actorId: string;
    actorRole: AgendaRecordData["actor"]["role"];
    status: AgendaRecordData["status"];
    dueAt: string | null;
    startsAt: string | null;
    endsAt: string | null;
    detail: string | null;
    intentMode?: AgendaRecordData["intentMode"];
    priority?: number;
    progress?: number;
    successCriteria?: string[];
    nextReviewAt?: string | null;
    blockedReason?: string | null;
    statusReason?: string | null;
    parentGoalId?: string | null;
    ownerSessionId?: string | null;
    sourceRefs: string[];
    updatedAt: string | null;
  }>;
  resident: {
    residentId: string | null;
    userId: string | null;
    location: string | null;
    activity: string | null;
    bodyState: string | null;
    emotionState: string | null;
    interruptedBy: string | null;
    relationship: string | null;
    nextPlan: {
      scheduleId: string;
      label: string;
      at: string;
      actorId: string;
      actorRole: AgendaRecordData["actor"]["role"];
      kind: AgendaRecordData["kind"] | "habit";
      source: "agenda" | "habit";
    } | null;
  };
}

export interface WorldSnapshotEventData {
  snapshot: WorldSnapshotData;
}

export interface ExecutionSnapshotData {
  active: ExecutionData | null;
  executions: ExecutionData[];
}

export interface ExecutionData {
  id: string;
  uri: string;
  sessionId: string;
  requestId: string;
  objective: string;
  status: "active" | "paused" | "blocked" | "completed" | "cancelled";
  reason?: string;
  steps: ExecutionStepData[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TodoData {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TodoCountsData {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

export interface TodoSnapshotData {
  items: TodoData[];
  counts: TodoCountsData;
}

export interface ExecutionStepData {
  id: string;
  nodeId: string;
  planId: string;
  planRevision: number;
  index: number;
  title: string;
  detail: string;
  status: "planned" | "running" | "completed" | "failed" | "blocked";
  dependencyIds: string[];
  callId?: string;
  failure?: string;
  createdAt: string;
  updatedAt: string;
}

/** Browser-safe record of continuity context that was injected into a turn. */
export interface ContinuitySnapshotData {
  enabled: boolean;
  concepts: Array<{
    uri: string;
    label: string;
    aliases: string[];
    entityKind?: string;
    scope: { kind: string; id: string };
    recordKinds: Array<"fact" | "profile" | "signal" | "rule">;
    recordCount: number;
    updatedAt: string;
  }>;
  /** Added in the property-graph snapshot revision; absent only on older history. */
  graph?: {
    scope: Array<{ kind: string; id: string }>;
    entities: Array<{
      uri: string;
      label: string;
      aliases: string[];
      kind: string;
      scope: { kind: string; id: string };
      status: "active" | "merged" | "retired";
      mergedIntoUri: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    relations: Array<{
      id: string;
      uri: string;
      subjectUri: string;
      relationId: string;
      relationLabel: string;
      objectUri: string;
      scope: { kind: string; id: string };
      cardinality: "many_to_many" | "single_subject";
      temporal: {
        kind: "persistent" | "instant" | "interval" | "until_condition" | "recurring";
        startsAt?: string;
        endsAt?: string;
        timeZone: string;
      };
      authority: string;
      confidence: number;
      sourceRefs: string[];
      supportCount: number;
      supportMass: number;
      maturity: "candidate" | "active" | "established";
      status: "active" | "superseded" | "retracted";
      supersededBy: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  graphRelations?: Array<{
    subject: string;
    subjectKind: string;
    relationId: string;
    relation: string;
    object: string;
    objectKind: string;
    temporal: {
      kind: "persistent" | "instant" | "interval" | "until_condition" | "recurring";
      startsAt?: string;
      endsAt?: string;
      timeZone: string;
    };
    confidence: number;
    maturity: "candidate" | "active" | "established";
  }>;
  temporalMemory?: {
    counts: Array<{
      granularity: "segment" | "day" | "month";
      status: "open" | "pending" | "sealed" | "failed" | "stale";
      count: number;
    }>;
    segmentDecisions: Array<{
      status: "pending" | "resolved" | "failed";
      count: number;
    }>;
    latestSealed: Array<{
      uri: string;
      granularity: "segment" | "day" | "month";
      periodStart: string;
      periodEnd: string;
      timeZone: string;
      summary: string;
      topics: string[];
      openLoops: string[];
      sourceCount: number;
    }>;
  };
  residentProfile: Array<{
    subject: "agent" | "user";
    key: string;
    valueJson: string;
    claim: string;
    validUntil?: string;
    maturity?: "candidate" | "active" | "established";
    supportCount?: number;
  }>;
  factCatalog: Array<{
    factKey: string;
    claim: string;
    sourceRefs: string[];
    confidence: number;
    authority: string;
    validFrom?: string;
    validUntil?: string;
    supportCount?: number;
    supportMass?: number;
    maturity?: "candidate" | "active" | "established";
    updatedAt: string;
    score: number;
    matchedBy: string[];
  }>;
  selection: {
    profiles: ContinuitySelectionCountData;
    facts: ContinuitySelectionCountData;
    relations?: ContinuitySelectionCountData;
    events: ContinuitySelectionCountData;
    evidence: ContinuitySelectionCountData;
    usedCharacters: number;
    maxCharacters: number;
  };
  rejections?: {
    belowSimilarity: number;
    belowCandidate: number;
    funnelSkipped: number;
  };
  nearMisses?: Array<{
    summary: string;
    score: number;
    textSimilarityScore: number;
    lexicalScore: number;
    semanticScore: number;
    matchedBy: string[];
  }>;
  preset: {
    enabled: boolean;
    activePresetName: string | null;
    title?: string;
    corePersona?: string;
    languageStyle?: string;
  };
  evidenceCandidates: Array<{
    sourceRefs: string[];
    score: number;
    matchedBy: string[];
  }>;
  eventCandidates: Array<{
    sourceRefs: string[];
    summary: string;
    occurredAt: string;
    score: number;
    matchedBy: string[];
  }>;
  rules: Array<{
    uri: string;
    title: string;
    action: string;
    actionKind: "recall" | "notify";
    activation: "while_true" | "once";
    status: "armed" | "partial" | "triggered" | "resolved" | "cancelled" | "expired";
    truth: "true" | "false" | "unknown";
    score: number;
    threshold: number;
    missingSignals: string[];
    conditions: Array<{
      label: string;
      truth: "true" | "false" | "unknown";
      score: number;
      actual?: string | number | boolean;
    }>;
    authority: string;
    confidence: number;
    supportCount: number;
    maturity: "candidate" | "active" | "established";
    validUntil?: string;
    lastEvaluatedAt?: string;
    lastTriggeredAt?: string;
  }>;
  signals: Array<{
    uri: string;
    summary: string;
    valueJson: string;
    valueType: "boolean" | "number" | "string" | "json";
    observedAt: string;
    expiresAt?: string;
  }>;
}

export interface ContinuitySelectionCountData {
  available: number;
  matched: number;
  selected: number;
}

export interface ExecutionEventData {
  snapshot: ExecutionSnapshotData;
  execution: ExecutionData;
  step?: ExecutionStepData;
}

export interface ContinuityRulesSnapshotData {
  rules: ContinuitySnapshotData["rules"];
  signals: ContinuitySnapshotData["signals"];
}

/** Three-tier prompt harness composition report for one turn. */
export interface PromptHarnessComposedData {
  profile: "native" | "baml";
  sections: {
    frozen: { bytes: number; tokens: number; revision: string };
    stable: { bytes: number; tokens: number; revision: string };
    volatile: { bytes: number; tokens: number; revision: string };
  };
  merged: { bytes: number; tokens: number };
}

export interface ContinuityRecallLocalMatchData {
  label: string;
  kind?: string;
  score: number;
  direct: boolean;
  matchedBy: Array<"phrase" | "token" | "fuzzy">;
  matchedTerms?: string[];
  matchedLabel?: string;
  anchorEligible?: boolean;
}

export interface ContinuityRecallLocalRelationData {
  relationId: string;
  label: string;
  score: number;
  direct: boolean;
}

/** Deterministic local planning diagnostics, without persistence URIs. */
export interface ContinuityRecallLocalPlanData {
  terms: string[];
  concepts: ContinuityRecallLocalMatchData[];
  entities: ContinuityRecallLocalMatchData[];
  relations: ContinuityRecallLocalRelationData[];
  anchorLabels: string[];
  expanded: boolean;
}

/** Recall observability for one deterministic local planning pass. */
export interface ContinuityRecallQueryData {
  original: string;
  local?: ContinuityRecallLocalPlanData;
}

/** Settled recall summary: what was injected and how it was matched. */
export interface ContinuityRecallSettledData {
  injectedCount: number;
  eventCount: number;
  matchedByCounts: {
    textSimilarity: number;
    lexical: number;
    exactPhrase: number;
    exactReference: number;
    embedding: number;
  };
  directCount: number;
  referenceCount: number;
  nearMissCount: number;
  belowSimilarity: number;
  belowCandidate: number;
  funnelSkipped: number;
  degraded: "none" | "semantic_timeout" | "semantic_unavailable";
  semanticStatus:
    | "short_query"
    | "no_observations"
    | "no_client"
    | "no_embeddings"
    | "model_mismatch"
    | "no_vector"
    | "dimension_mismatch"
    | "request_failed"
    | "completed"
    | "disabled"
    | "unavailable"
    | "timeout";
  semanticIndexedCount: number;
  semanticCompatibleCount: number;
  totalLatencyMs: number;
}
