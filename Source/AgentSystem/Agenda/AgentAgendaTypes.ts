export const AgentAgendaRecordKinds = {
  Goal: "goal",
  Activity: "activity",
  Event: "event",
  Schedule: "schedule",
} as const;

export type AgentAgendaRecordKind = (typeof AgentAgendaRecordKinds)[keyof typeof AgentAgendaRecordKinds];

export const AgentAgendaStatuses = {
  Planned: "planned",
  Active: "active",
  Paused: "paused",
  Completed: "completed",
  Cancelled: "cancelled",
  Recorded: "recorded",
} as const;

export type AgentAgendaStatus = (typeof AgentAgendaStatuses)[keyof typeof AgentAgendaStatuses];

/** Describes how strongly a goal is authorized to drive autonomous work. */
export const AgentAgendaIntentModes = Object.freeze({
  Suggested: "suggested",
  Tentative: "tentative",
  Committed: "committed",
  Observed: "observed",
} as const);

export type AgentAgendaIntentMode = (typeof AgentAgendaIntentModes)[keyof typeof AgentAgendaIntentModes];

export const AgentAgendaActorRoles = {
  User: "user",
  Resident: "resident",
  System: "system",
} as const;

export type AgentAgendaActorRole = (typeof AgentAgendaActorRoles)[keyof typeof AgentAgendaActorRoles];

export const AgentAgendaAuthorities = {
  UserExplicit: "user_explicit",
  ToolVerified: "tool_verified",
  WorldDefinition: "world_definition",
  Host: "host",
} as const;

export type AgentAgendaAuthority = (typeof AgentAgendaAuthorities)[keyof typeof AgentAgendaAuthorities];

export const AgentAgendaEventKinds = {
  Declared: "declared",
  Started: "started",
  Progressed: "progressed",
  Paused: "paused",
  Finished: "finished",
  Cancelled: "cancelled",
  Occurred: "occurred",
  Due: "due",
  EvidenceAttached: "evidence_attached",
} as const;

export type AgentAgendaEventKind = (typeof AgentAgendaEventKinds)[keyof typeof AgentAgendaEventKinds];

export const AgentAgendaWriteDispositions = {
  Created: "created",
  Idempotent: "idempotent",
} as const;

export type AgentAgendaWriteDisposition =
  (typeof AgentAgendaWriteDispositions)[keyof typeof AgentAgendaWriteDispositions];

export interface AgentAgendaWriteReceipt {
  readonly disposition: AgentAgendaWriteDisposition;
}

export interface AgentAgendaWorld {
  readonly id: string;
  readonly uri: string;
  readonly timeZone: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentAgendaActor {
  readonly id: string;
  readonly uri: string;
  readonly worldId: string;
  readonly role: AgentAgendaActorRole;
  readonly createdAt: string;
}

export interface AgentAgendaRecordIdentity {
  readonly id: string;
  readonly uri: string;
  readonly worldId: string;
  readonly actorId: string;
  readonly kind: AgentAgendaRecordKind;
  readonly createdAt: string;
}

/** A host-owned event payload. Models never generate IDs, source references, or authority. */
export interface AgentAgendaMutation {
  readonly summary?: string;
  readonly status?: AgentAgendaStatus;
  readonly dueAt?: string | null;
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
  readonly relatedRecordId?: string | null;
  readonly detail?: string | null;
  /** Goal-only authorization and progress fields. Older events omit them. */
  readonly intentMode?: AgentAgendaIntentMode;
  readonly priority?: number;
  readonly progress?: number;
  readonly successCriteria?: readonly string[];
  readonly nextReviewAt?: string | null;
  readonly blockedReason?: string | null;
  /** Human-authored reason for an explicit status transition. */
  readonly statusReason?: string | null;
  readonly parentGoalId?: string | null;
  /** Session that may receive an autonomous follow-up for this goal. */
  readonly ownerSessionId?: string | null;
  /** Host-owned key used to make a micro-loop decision replay-safe. */
  readonly lastDecisionKey?: string | null;
}

export interface AgentAgendaEvent {
  readonly id: string;
  readonly uri: string;
  readonly recordId: string;
  /** Monotonic within one record; preserves causal replay when instants are equal. */
  readonly sequence: number;
  readonly kind: AgentAgendaEventKind;
  readonly mutation: AgentAgendaMutation;
  readonly sourceRefs: readonly string[];
  readonly authority: AgentAgendaAuthority;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly localDate: string;
}

export interface AgentAgendaRecord extends AgentAgendaRecordIdentity {
  /** Latest event sequence; used for optimistic concurrency control. */
  readonly revision: number;
  readonly actor: AgentAgendaActor;
  readonly summary: string;
  readonly status: AgentAgendaStatus;
  readonly dueAt: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly relatedRecordId: string | null;
  readonly detail: string | null;
  readonly intentMode?: AgentAgendaIntentMode;
  readonly priority?: number;
  readonly progress?: number;
  readonly successCriteria?: readonly string[];
  readonly nextReviewAt?: string | null;
  readonly blockedReason?: string | null;
  readonly statusReason?: string | null;
  readonly parentGoalId?: string | null;
  readonly ownerSessionId?: string | null;
  readonly lastDecisionKey?: string | null;
  readonly sourceRefs: readonly string[];
  readonly updatedAt: string;
  readonly lastEventId: string;
}

export interface AgentAgendaTimelineEntry {
  readonly id: string;
  readonly recordId: string;
  readonly recordKind: AgentAgendaRecordKind;
  readonly actorRole: AgentAgendaActorRole;
  readonly eventKind: AgentAgendaEventKind;
  readonly summary: string;
  readonly detail: string | null;
  readonly occurredAt: string;
  readonly sourceRefs: readonly string[];
}

export interface AgentAgendaClock {
  readonly instant: string;
  readonly timeZone: string;
  readonly localDate: string;
  readonly localTime: string;
  readonly weekdayLabel: string;
}

export interface AgentAgendaSnapshot {
  readonly world: AgentAgendaWorld;
  readonly clock: AgentAgendaClock;
  readonly records: readonly AgentAgendaRecord[];
  readonly activeGoals: readonly AgentAgendaRecord[];
  readonly currentActivities: readonly AgentAgendaRecord[];
  readonly timeline: readonly AgentAgendaTimelineEntry[];
  readonly upcoming: readonly AgentAgendaRecord[];
}

/** Physical append-only inputs used by downstream world materializers. */
export interface AgentAgendaHistory {
  readonly world: AgentAgendaWorld;
  readonly actors: readonly AgentAgendaActor[];
  readonly identities: readonly AgentAgendaRecordIdentity[];
  readonly events: readonly AgentAgendaEvent[];
}

export interface AgentAgendaCreateRecordInput {
  readonly worldId: string;
  readonly actorId: string;
  readonly kind: AgentAgendaRecordKind;
  readonly eventKind: AgentAgendaEventKind;
  readonly mutation: Required<Pick<AgentAgendaMutation, "summary" | "status">> & AgentAgendaMutation;
  readonly sourceRefs: readonly string[];
  readonly authority: AgentAgendaAuthority;
  readonly occurredAt: string;
  readonly recordedAt: string;
  /** Stable caller-owned key for safe replay of a persisted transition. */
  readonly idempotencyKey: string;
}

export interface AgentAgendaAppendEventInput {
  readonly recordId: string;
  readonly kind: AgentAgendaEventKind;
  readonly mutation: AgentAgendaMutation;
  readonly sourceRefs: readonly string[];
  readonly authority: AgentAgendaAuthority;
  readonly occurredAt: string;
  readonly recordedAt: string;
  /** Stable caller-owned key for safe replay of a persisted transition. */
  readonly idempotencyKey: string;
}

export interface AgentAgendaCommandEventInput extends AgentAgendaAppendEventInput {
  readonly commandId: string;
  readonly operationKind: string;
  readonly payloadHash: string;
  readonly expectedRevision: number;
}

export interface AgentAgendaCommandReceipt {
  readonly commandId: string;
  readonly operationKind: string;
  readonly payloadHash: string;
  readonly recordId: string;
  readonly eventId: string;
  readonly revision: number;
  readonly createdAt: string;
}

export interface AgentAgendaDraft {
  readonly kind: AgentAgendaRecordKind;
  readonly change: "create" | "start" | "progress" | "finish" | "cancel";
  readonly actor: AgentAgendaActorRole;
  readonly summary: string;
  readonly timeText?: string;
  readonly relatesTo?: string;
}
