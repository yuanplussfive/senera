import { Temporal } from "@js-temporal/polyfill";
import { uniqueStrings } from "../Core/AgentCollections.js";
import {
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
  type AgentAgendaActor,
  type AgentAgendaClock,
  type AgentAgendaEvent,
  type AgentAgendaRecord,
  type AgentAgendaRecordIdentity,
  type AgentAgendaSnapshot,
  type AgentAgendaTimelineEntry,
  type AgentAgendaWorld,
} from "./AgentAgendaTypes.js";

export interface AgentAgendaProjectionInput {
  readonly world: AgentAgendaWorld;
  readonly actors: readonly AgentAgendaActor[];
  readonly identities: readonly AgentAgendaRecordIdentity[];
  readonly events: readonly AgentAgendaEvent[];
  readonly now: Date;
}

/** Rebuilds all mutable agenda state from its append-only event ledger. */
export function projectAgentAgendaSnapshot(input: AgentAgendaProjectionInput): AgentAgendaSnapshot {
  const clock = projectClock(input.now, input.world.timeZone);
  const actors = new Map(input.actors.map((actor) => [actor.id, actor] as const));
  const identities = new Map(input.identities.map((identity) => [identity.id, identity] as const));
  const states = new Map<string, AgentAgendaRecord>();
  const events = input.events.slice().sort(compareEvents);

  for (const event of events) {
    const identity = identities.get(event.recordId);
    if (!identity) throw new Error(`Agenda event references unknown record: ${event.recordId}`);
    const actor = actors.get(identity.actorId);
    if (!actor) throw new Error(`Agenda record references unknown actor: ${identity.id}`);
    states.set(identity.id, applyEvent(states.get(identity.id), identity, actor, event));
  }

  const records = [...states.values()].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
  );
  const byId = new Map(records.map((record) => [record.id, record] as const));
  const timeline = events
    .filter((event) => event.localDate === clock.localDate)
    .map((event) => projectTimelineEntry(event, byId.get(event.recordId)))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));

  return {
    world: input.world,
    clock,
    records,
    activeGoals: records.filter(
      (record) => record.kind === AgentAgendaRecordKinds.Goal && record.status === AgentAgendaStatuses.Active,
    ),
    currentActivities: records.filter(
      (record) => record.kind === AgentAgendaRecordKinds.Activity && record.status === AgentAgendaStatuses.Active,
    ),
    timeline,
    upcoming: records
      .filter(
        (record) =>
          record.dueAt !== null &&
          record.dueAt >= clock.instant &&
          record.status !== AgentAgendaStatuses.Completed &&
          record.status !== AgentAgendaStatuses.Cancelled,
      )
      .sort((left, right) => left.dueAt!.localeCompare(right.dueAt!) || left.id.localeCompare(right.id)),
  };
}

function applyEvent(
  existing: AgentAgendaRecord | undefined,
  identity: AgentAgendaRecordIdentity,
  actor: AgentAgendaActor,
  event: AgentAgendaEvent,
): AgentAgendaRecord {
  if (!existing) {
    if (!event.mutation.summary || !event.mutation.status) {
      throw new Error(`Initial agenda event must define summary and status: ${event.id}`);
    }
    return {
      ...identity,
      actor,
      revision: event.sequence,
      summary: event.mutation.summary,
      status: event.mutation.status,
      dueAt: event.mutation.dueAt ?? null,
      startsAt: event.mutation.startsAt ?? null,
      endsAt: event.mutation.endsAt ?? null,
      relatedRecordId: event.mutation.relatedRecordId ?? null,
      detail: event.mutation.detail ?? null,
      ...(event.mutation.intentMode !== undefined ? { intentMode: event.mutation.intentMode } : {}),
      ...(event.mutation.priority !== undefined ? { priority: event.mutation.priority } : {}),
      ...(event.mutation.progress !== undefined ? { progress: event.mutation.progress } : {}),
      ...(event.mutation.successCriteria !== undefined ? { successCriteria: [...event.mutation.successCriteria] } : {}),
      ...(event.mutation.nextReviewAt !== undefined ? { nextReviewAt: event.mutation.nextReviewAt } : {}),
      ...(event.mutation.blockedReason !== undefined ? { blockedReason: event.mutation.blockedReason } : {}),
      ...(event.mutation.statusReason !== undefined ? { statusReason: event.mutation.statusReason } : {}),
      ...(event.mutation.parentGoalId !== undefined ? { parentGoalId: event.mutation.parentGoalId } : {}),
      ...(event.mutation.ownerSessionId !== undefined ? { ownerSessionId: event.mutation.ownerSessionId } : {}),
      ...(event.mutation.lastDecisionKey !== undefined ? { lastDecisionKey: event.mutation.lastDecisionKey } : {}),
      sourceRefs: [...event.sourceRefs],
      updatedAt: event.recordedAt,
      lastEventId: event.id,
    };
  }

  return {
    ...existing,
    revision: event.sequence,
    ...(event.mutation.summary !== undefined ? { summary: event.mutation.summary } : {}),
    ...(event.mutation.status !== undefined ? { status: event.mutation.status } : {}),
    ...(event.mutation.dueAt !== undefined ? { dueAt: event.mutation.dueAt } : {}),
    ...(event.mutation.startsAt !== undefined ? { startsAt: event.mutation.startsAt } : {}),
    ...(event.mutation.endsAt !== undefined ? { endsAt: event.mutation.endsAt } : {}),
    ...(event.mutation.relatedRecordId !== undefined ? { relatedRecordId: event.mutation.relatedRecordId } : {}),
    ...(event.mutation.detail !== undefined ? { detail: event.mutation.detail } : {}),
    ...(event.mutation.intentMode !== undefined ? { intentMode: event.mutation.intentMode } : {}),
    ...(event.mutation.priority !== undefined ? { priority: event.mutation.priority } : {}),
    ...(event.mutation.progress !== undefined ? { progress: event.mutation.progress } : {}),
    ...(event.mutation.successCriteria !== undefined ? { successCriteria: [...event.mutation.successCriteria] } : {}),
    ...(event.mutation.nextReviewAt !== undefined ? { nextReviewAt: event.mutation.nextReviewAt } : {}),
    ...(event.mutation.blockedReason !== undefined ? { blockedReason: event.mutation.blockedReason } : {}),
    ...(event.mutation.statusReason !== undefined ? { statusReason: event.mutation.statusReason } : {}),
    ...(event.mutation.parentGoalId !== undefined ? { parentGoalId: event.mutation.parentGoalId } : {}),
    ...(event.mutation.ownerSessionId !== undefined ? { ownerSessionId: event.mutation.ownerSessionId } : {}),
    ...(event.mutation.lastDecisionKey !== undefined ? { lastDecisionKey: event.mutation.lastDecisionKey } : {}),
    sourceRefs: uniqueStrings([...existing.sourceRefs, ...event.sourceRefs]),
    updatedAt: event.recordedAt,
    lastEventId: event.id,
  };
}

function projectTimelineEntry(
  event: AgentAgendaEvent,
  record: AgentAgendaRecord | undefined,
): AgentAgendaTimelineEntry {
  if (!record) throw new Error(`Agenda timeline event has no projected record: ${event.recordId}`);
  return {
    id: event.id,
    recordId: record.id,
    recordKind: record.kind,
    actorRole: record.actor.role,
    eventKind: event.kind,
    summary: event.mutation.summary ?? record.summary,
    detail: event.mutation.detail ?? record.detail,
    occurredAt: event.occurredAt,
    sourceRefs: event.sourceRefs,
  };
}

function projectClock(now: Date, timeZone: string): AgentAgendaClock {
  const instant = Temporal.Instant.from(now.toISOString());
  const zoned = instant.toZonedDateTimeISO(timeZone);
  return {
    instant: instant.toString(),
    timeZone,
    localDate: zoned.toPlainDate().toString(),
    localTime: zoned.toPlainTime().toString({ smallestUnit: "second" }),
    weekdayLabel: new Intl.DateTimeFormat("zh-CN", { timeZone, weekday: "long" }).format(now),
  };
}

function compareEvents(left: AgentAgendaEvent, right: AgentAgendaEvent): number {
  // Use one total order so replay remains deterministic even when many records share a timestamp.
  const temporalOrder =
    left.occurredAt.localeCompare(right.occurredAt) || left.recordedAt.localeCompare(right.recordedAt);
  if (temporalOrder !== 0) return temporalOrder;
  if (left.recordId === right.recordId) return left.sequence - right.sequence;
  return (
    left.recordId.localeCompare(right.recordId) || left.sequence - right.sequence || left.id.localeCompare(right.id)
  );
}
