import type { Temporal } from "@js-temporal/polyfill";
import type {
  AgentAgendaActorRole,
  AgentAgendaIntentMode,
  AgentAgendaRecordKind,
  AgentAgendaStatus,
} from "../Agenda/AgentAgendaTypes.js";
import type { AgentWorldActionBudgetPort } from "./AgentWorldActionBudget.js";
import type { AgentInferenceBudgetPort } from "../ModelEndpoints/AgentInferenceBudget.js";

export type AgentWorldJsonValue =
  string | number | boolean | null | readonly AgentWorldJsonValue[] | { readonly [key: string]: AgentWorldJsonValue };

export type AgentWorldAttributes = Readonly<Record<string, AgentWorldJsonValue>>;

export interface AgentWorldIdentity {
  readonly id: string;
  readonly name: string;
  readonly timeZone: string;
}

export interface AgentWorldDayPhase {
  readonly id: string;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface AgentWorldEntityState {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly attributes: AgentWorldAttributes;
  readonly lastChangedAt: string | null;
}

export interface AgentWorldTreeNode extends AgentWorldEntityState {
  readonly depth: number;
  readonly children: readonly string[];
}

export interface AgentWorldTreeEdge {
  readonly id: string;
  readonly subjectId: string;
  readonly relation: string;
  readonly relationLabel?: string;
  readonly inverseRelation?: string;
  readonly objectId: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly confidence?: number;
  readonly sourceRefs?: readonly string[];
}

export interface AgentWorldTimelineEntry {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly summary: string;
  readonly source: string;
  readonly changedEntityIds: readonly string[];
}

export interface AgentWorldCalendarProjection {
  readonly date: string;
  readonly isHoliday: boolean;
  readonly isWorkday: boolean;
  readonly isPublicHoliday: boolean;
  readonly isPublicWorkday: boolean;
  readonly holidayName: string | null;
  readonly lunarSummary: string;
}

export interface AgentWorldTimeProjection {
  readonly instant: Temporal.Instant;
  readonly timeZone: string;
  readonly localDate: string;
  readonly localTime: string;
  readonly weekday: number;
  readonly weekdayLabel: string;
  readonly phaseId: string;
  readonly phaseLabel: string;
  readonly dayElapsedSeconds: number;
  readonly dayElapsed: string;
  readonly dayRemainingSeconds: number;
  readonly dayRemaining: string;
}

export interface AgentWorldScheduleOccurrence {
  readonly scheduleId: string;
  readonly label: string;
  readonly at: string;
  readonly actorId: string;
  readonly actorRole: AgentAgendaActorRole;
  readonly kind: AgentAgendaRecordKind | "habit";
  readonly source: "agenda" | "habit";
}

export interface AgentWorldWakePlan {
  readonly due: boolean;
  readonly instants: readonly Temporal.Instant[];
}

/**
 * A side-effect-free participant that contributes wake instants and may
 * materialize real world events when the runtime reaches one of them.
 * Snapshot reads never invoke this hook; only the runtime timer does.
 */
export interface AgentWorldWakeSource {
  /** Stable identifier used by the World action arbiter when configured. */
  readonly sourceId?: string;
  /** Low-frequency maintenance sources may opt out of static fair-share slots. */
  readonly fairShareEligible?: boolean;
  wakePlan(input: { readonly worldId: string; readonly after: Temporal.Instant }): AgentWorldWakePlan;
  upcomingSchedules(input: {
    readonly worldId: string;
    readonly after: Temporal.Instant;
  }): readonly AgentWorldScheduleOccurrence[];
  onWake(input: AgentWorldWakeInput): AgentWorldWakeResult | Promise<AgentWorldWakeResult>;
}

export interface AgentWorldWakeInput {
  readonly worldId: string;
  readonly from: Temporal.Instant;
  readonly to: Temporal.Instant;
  readonly snapshot: AgentWorldTreeProjection;
  /** Per-wake shared action budget. Omitted for embedders that do not configure arbitration. */
  readonly budget?: AgentWorldActionBudgetPort;
  /** Shared model-inference budget for model-backed sources. */
  readonly inferenceBudget?: AgentInferenceBudgetPort;
  /** Workspace or tenant scope used by the inference budget. */
  readonly inferenceBudgetScope?: string;
}

export interface AgentWorldWakeResult {
  readonly changed: boolean;
}

export interface AgentWorldCommitment {
  readonly id: string;
  readonly revision: number;
  readonly label: string;
  readonly actorId: string;
  readonly actorRole: AgentAgendaActorRole;
  readonly status: AgentAgendaStatus;
  readonly dueAt: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
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
  readonly sourceRefs: readonly string[];
  readonly updatedAt: string | null;
}

export interface AgentWorldResidentFocus {
  readonly residentId: string | null;
  readonly userId: string | null;
  readonly location: string | null;
  readonly activity: string | null;
  readonly bodyState: string | null;
  readonly emotionState: string | null;
  readonly interruptedBy: string | null;
  readonly relationship: string | null;
  readonly nextPlan: AgentWorldScheduleOccurrence | null;
}

export interface AgentWorldTreeProjection {
  readonly world: AgentWorldIdentity;
  readonly time: AgentWorldTimeProjection;
  readonly calendar: AgentWorldCalendarProjection;
  readonly nodes: readonly AgentWorldTreeNode[];
  readonly edges: readonly AgentWorldTreeEdge[];
  readonly timeline: readonly AgentWorldTimelineEntry[];
  readonly changedNodeIds: readonly string[];
  readonly nextSchedules: readonly AgentWorldScheduleOccurrence[];
  readonly commitments: readonly AgentWorldCommitment[];
  readonly resident: AgentWorldResidentFocus;
}

/** Runtime boundary shared by persistent and definition-backed world projections. */
export interface AgentWorldSnapshotProvider {
  snapshot(now?: Temporal.Instant): AgentWorldTreeProjection;
}

/** Control-plane surface for explicit Resident work requests. */
export interface AgentWorldResidentWakeControlPort {
  request(input: {
    readonly worldId: string;
    readonly now: string | Temporal.Instant;
    readonly request: {
      readonly id: string;
      readonly reason: string;
      readonly priority: number;
      readonly payload: unknown;
      readonly requestedAt?: string;
    };
  }): unknown;
}
