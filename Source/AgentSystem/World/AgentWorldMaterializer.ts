import { Temporal } from "@js-temporal/polyfill";
import { uniqueStrings } from "../Core/AgentCollections.js";
import {
  AgentAgendaActorRoles,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
  type AgentAgendaActorRole,
  type AgentAgendaRecordKind,
  type AgentAgendaStatus,
} from "../Agenda/AgentAgendaTypes.js";
import { isAgentContinuityTemporalActive } from "../Continuity/AgentContinuityDomain.js";
import type { AgentContinuityGraphSnapshot } from "../Continuity/AgentContinuityGraphTypes.js";
import { getAgentContinuityRelationDefinition } from "../Continuity/AgentContinuityRelationCatalog.js";
import type { ResolvedAgentWorldConfig } from "../Types/AgentRuntimeConfigTypes.js";
import { projectChineseWorldCalendar } from "./AgentWorldCalendar.js";
import type { AgentWorldEvent, AgentWorldEventChange, AgentWorldEventLedger } from "./AgentWorldEventLedger.js";
import { projectAgentWorldTime } from "./AgentWorldTime.js";
import { projectAgentWorldTimeline, type AgentWorldTimelineProjectionPolicy } from "./AgentWorldTimelineProjection.js";
import type {
  AgentWorldAttributes,
  AgentWorldCommitment,
  AgentWorldEntityState,
  AgentWorldResidentFocus,
  AgentWorldScheduleOccurrence,
  AgentWorldTreeEdge,
  AgentWorldTreeNode,
  AgentWorldTreeProjection,
} from "./AgentWorldTypes.js";
import {
  projectLegacyIdentityText,
  renderAgentTextParts,
  type AgentIdentityDisplayValues,
} from "../Text/AgentTextParts.js";

export const AgentWorldSemanticAttributes = Object.freeze({
  Activity: "activity",
  BodyState: "bodyState",
  EmotionState: "emotionState",
  InterruptedBy: "interruptedBy",
});

export interface AgentWorldMaterializerOptions {
  readonly ledger: AgentWorldEventLedger;
  readonly graphSnapshot: () => AgentContinuityGraphSnapshot;
  readonly config: () => ResolvedAgentWorldConfig;
  /** Resolves display names only when derived timeline prose is presented. */
  readonly identityDisplayValues?: () => AgentIdentityDisplayValues;
  readonly timelineProjectionPolicy?: AgentWorldTimelineProjectionPolicy;
}

interface MutableEntityState {
  id: string;
  kind: string;
  label: string;
  parentId: string | null;
  attributes: Record<string, AgentWorldAttributes[string]>;
  lastChangedAt: string | null;
}

/** Replays physical world events and overlays the relevant Continuity property graph. */
export class AgentWorldMaterializer {
  constructor(private readonly options: AgentWorldMaterializerOptions) {}

  readAttribute(entityId: string, attribute: string, now: Temporal.Instant): AgentWorldAttributes[string] | undefined {
    const node = this.materialize(now, []).nodes.find((candidate) => candidate.id === entityId);
    return node?.attributes[attribute];
  }

  materialize(
    now: Temporal.Instant,
    recurringSchedules: readonly AgentWorldScheduleOccurrence[],
  ): AgentWorldTreeProjection {
    const config = this.options.config();
    const ledger = this.options.ledger.snapshot(config.TimeZone);
    const entities = new Map<string, MutableEntityState>();
    const edges = new Map<string, AgentWorldTreeEdge>();
    this.applyContinuityGraph(entities, edges, now);
    for (const event of ledger.events) this.applyEvent(entities, edges, event, now);

    const localDate = now.toZonedDateTimeISO(config.TimeZone).toPlainDate().toString();
    const timeline = projectAgentWorldTimeline({
      events: ledger.events,
      localDate,
      limit: config.TimelineLimit,
      policy: this.options.timelineProjectionPolicy,
    }).map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      summary: renderAgentTextParts(
        event.summaryParts?.length ? event.summaryParts : projectLegacyIdentityText(event.summary),
        this.options.identityDisplayValues?.(),
      ),
      source: event.uri,
      changedEntityIds: changedEntityIds(event.changes),
    }));
    const schedules = mergeSchedules(projectAgendaSchedules(entities, now), recurringSchedules);
    const commitments = projectCommitments(entities, ledger.events);
    const resident = projectResidentFocus(entities, edges, schedules);
    const selected = selectWorldEntities(entities, edges, ledger.events, schedules, commitments, config.RecordLimit);
    const selectedIds = new Set(selected.map((entity) => entity.id));
    const selectedEdges = [...edges.values()].filter(
      (edge) => selectedIds.has(edge.subjectId) && selectedIds.has(edge.objectId),
    );

    return {
      world: { id: ledger.world.id, name: config.Name, timeZone: ledger.world.timeZone },
      time: projectAgentWorldTime({
        instant: now,
        timeZone: config.TimeZone,
        dayPhases: config.DayPhases.map((phase) => ({
          id: phase.Id,
          label: phase.Label,
          startsAt: phase.StartsAt,
          endsAt: phase.EndsAt,
        })),
      }),
      calendar: projectChineseWorldCalendar(Temporal.PlainDate.from(localDate), config.TimeZone),
      nodes: projectTreeNodes(selected),
      edges: selectedEdges,
      timeline,
      changedNodeIds: uniqueStrings(timeline.flatMap((event) => event.changedEntityIds)),
      nextSchedules: schedules,
      commitments,
      resident,
    };
  }

  private applyContinuityGraph(
    entities: Map<string, MutableEntityState>,
    edges: Map<string, AgentWorldTreeEdge>,
    now: Temporal.Instant,
  ): void {
    const graph = this.options.graphSnapshot();
    for (const entity of graph.entities) {
      if (entity.status !== "active") continue;
      entities.set(entity.uri, {
        id: entity.uri,
        kind: entity.kind,
        label: entity.label,
        parentId: null,
        attributes: { aliases: [...entity.aliases] },
        lastChangedAt: entity.updatedAt,
      });
    }
    for (const relation of graph.relations) {
      if (
        relation.status !== "active" ||
        relation.maturity === "candidate" ||
        !isAgentContinuityTemporalActive(relation.temporal, new Date(now.epochMilliseconds))
      )
        continue;
      const definition = getAgentContinuityRelationDefinition(relation.relationId);
      edges.set(relation.uri, {
        id: relation.uri,
        subjectId: relation.subjectUri,
        relation: definition.id,
        relationLabel: definition.label,
        ...(definition.inverseRelationId ? { inverseRelation: definition.inverseRelationId } : {}),
        objectId: relation.objectUri,
        ...(relation.temporal.startsAt ? { validFrom: relation.temporal.startsAt } : {}),
        ...(relation.temporal.endsAt ? { validUntil: relation.temporal.endsAt } : {}),
        confidence: relation.confidence,
        sourceRefs: relation.sourceRefs,
      });
    }
  }

  private applyEvent(
    entities: Map<string, MutableEntityState>,
    edges: Map<string, AgentWorldTreeEdge>,
    event: AgentWorldEvent,
    now: Temporal.Instant,
  ): void {
    for (const change of event.changes) {
      applyWorldChange(entities, edges, change, event, now);
    }
  }
}

function applyWorldChange(
  entities: Map<string, MutableEntityState>,
  edges: Map<string, AgentWorldTreeEdge>,
  change: AgentWorldEventChange,
  event: AgentWorldEvent,
  now: Temporal.Instant,
): void {
  switch (change.kind) {
    case "entity_upsert": {
      const previous = entities.get(change.entity.id);
      entities.set(change.entity.id, {
        id: change.entity.id,
        kind: change.entity.kind,
        label: change.entity.label,
        parentId: change.entity.parentId,
        attributes: { ...(previous?.attributes ?? {}), ...change.entity.attributes },
        lastChangedAt: event.occurredAt,
      });
      return;
    }
    case "entity_replace":
      entities.set(change.entity.id, {
        id: change.entity.id,
        kind: change.entity.kind,
        label: change.entity.label,
        parentId: change.entity.parentId,
        attributes: { ...change.entity.attributes },
        lastChangedAt: event.occurredAt,
      });
      return;
    case "entity_patch": {
      const entity = entities.get(change.entityId);
      if (!entity) throw new Error(`World event patches an unknown entity: ${change.entityId}`);
      entities.set(entity.id, {
        ...entity,
        ...(change.label !== undefined ? { label: change.label } : {}),
        ...(change.parentId !== undefined ? { parentId: change.parentId } : {}),
        attributes: { ...entity.attributes, ...change.attributes },
        lastChangedAt: event.occurredAt,
      });
      return;
    }
    case "entity_retire":
      entities.delete(change.entityId);
      for (const [id, edge] of edges) {
        if (edge.subjectId === change.entityId || edge.objectId === change.entityId) edges.delete(id);
      }
      return;
    case "relation_assert": {
      if (change.validFrom && Temporal.Instant.compare(now, Temporal.Instant.from(change.validFrom)) < 0) return;
      if (change.validUntil && Temporal.Instant.compare(now, Temporal.Instant.from(change.validUntil)) >= 0) return;
      const definition = getAgentContinuityRelationDefinition(change.relationId);
      const id = relationKey(change.subject.id, definition.id, change.object.id);
      edges.set(id, {
        id,
        subjectId: change.subject.id,
        relation: definition.id,
        relationLabel: definition.label,
        ...(definition.inverseRelationId ? { inverseRelation: definition.inverseRelationId } : {}),
        objectId: change.object.id,
        ...(change.validFrom ? { validFrom: change.validFrom } : {}),
        ...(change.validUntil ? { validUntil: change.validUntil } : {}),
        sourceRefs: event.evidenceRefs,
      });
      return;
    }
    case "relation_retract":
      edges.delete(relationKey(change.subjectId, change.relationId, change.objectId));
      return;
    case "state_transition": {
      const actor = entities.get(change.actorId);
      if (!actor) throw new Error(`World state transition references an unknown actor: ${change.actorId}`);
      actor.attributes[`state.${change.machineId}`] = change.to;
      actor.lastChangedAt = event.occurredAt;
      return;
    }
    case "state_machine_initialized":
      return;
    case "clock_advance":
      return;
  }
}

function selectWorldEntities(
  entities: ReadonlyMap<string, MutableEntityState>,
  edges: ReadonlyMap<string, AgentWorldTreeEdge>,
  events: readonly AgentWorldEvent[],
  schedules: readonly AgentWorldScheduleOccurrence[],
  commitments: readonly AgentWorldCommitment[],
  limit: number,
): MutableEntityState[] {
  const priority = new Set<string>();
  for (const event of events.slice(-limit)) priority.add(event.subject.id);
  for (const schedule of schedules) priority.add(schedule.scheduleId);
  for (const commitment of commitments) {
    priority.add(commitment.id);
    priority.add(commitment.actorId);
  }
  for (const edge of edges.values()) {
    if (edge.relation === "located_at" || edge.relation === "lives_at") {
      priority.add(edge.subjectId);
      priority.add(edge.objectId);
    }
  }
  return [...entities.values()]
    .sort(
      (left, right) =>
        Number(priority.has(right.id)) - Number(priority.has(left.id)) ||
        (right.lastChangedAt ?? "").localeCompare(left.lastChangedAt ?? "") ||
        left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}

function projectTreeNodes(entities: readonly MutableEntityState[]): AgentWorldTreeNode[] {
  const selectedIds = new Set(entities.map((entity) => entity.id));
  const normalized = entities.map((entity): AgentWorldEntityState => ({
    ...entity,
    parentId: entity.parentId && selectedIds.has(entity.parentId) ? entity.parentId : null,
    attributes: { ...entity.attributes },
  }));
  const byId = new Map(normalized.map((entity) => [entity.id, entity] as const));
  const children = new Map<string, string[]>();
  for (const entity of normalized) {
    if (!entity.parentId) continue;
    children.set(entity.parentId, [...(children.get(entity.parentId) ?? []), entity.id]);
  }
  return normalized.map((entity) => ({
    ...entity,
    depth: entityDepth(entity, byId),
    children: (children.get(entity.id) ?? []).sort(),
  }));
}

function entityDepth(entity: AgentWorldEntityState, byId: ReadonlyMap<string, AgentWorldEntityState>): number {
  const visited = new Set([entity.id]);
  let depth = 0;
  let parentId = entity.parentId;
  while (parentId) {
    if (visited.has(parentId)) throw new Error(`World entity hierarchy contains a cycle at ${parentId}.`);
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

function projectAgendaSchedules(
  entities: ReadonlyMap<string, MutableEntityState>,
  now: Temporal.Instant,
): AgentWorldScheduleOccurrence[] {
  return [...entities.values()].flatMap((entity) => {
    const kind = readAgendaKind(entity);
    const status = readAgendaStatus(entity);
    if (!kind || !status || !isOpenAgendaStatus(status)) return [];
    const at = readStringAttribute(entity, "dueAt") ?? readStringAttribute(entity, "startsAt");
    if (!at || Temporal.Instant.compare(Temporal.Instant.from(at), now) <= 0) return [];
    const actor = entity.parentId ? entities.get(entity.parentId) : undefined;
    const actorRole = readActorRole(actor);
    if (!actor || !actorRole) return [];
    return [
      {
        scheduleId: entity.id,
        label: entity.label,
        at,
        actorId: actor.id,
        actorRole,
        kind,
        source: "agenda" as const,
      },
    ];
  });
}

function mergeSchedules(
  agenda: readonly AgentWorldScheduleOccurrence[],
  recurring: readonly AgentWorldScheduleOccurrence[],
): AgentWorldScheduleOccurrence[] {
  return [
    ...new Map(
      [...agenda, ...recurring].map((schedule) => [`${schedule.scheduleId}:${schedule.at}`, schedule]),
    ).values(),
  ].sort((left, right) => left.at.localeCompare(right.at) || left.scheduleId.localeCompare(right.scheduleId));
}

function projectResidentFocus(
  entities: ReadonlyMap<string, MutableEntityState>,
  edges: ReadonlyMap<string, AgentWorldTreeEdge>,
  schedules: readonly AgentWorldScheduleOccurrence[],
): AgentWorldResidentFocus {
  const resident = [...entities.values()].find((entity) => entity.attributes.role === AgentAgendaActorRoles.Resident);
  const user = [...entities.values()].find((entity) => entity.attributes.role === AgentAgendaActorRoles.User);
  const locationEdge = resident
    ? [...edges.values()].find(
        (edge) => edge.subjectId === resident.id && (edge.relation === "located_at" || edge.relation === "lives_at"),
      )
    : undefined;
  const relationshipEdge =
    resident && user
      ? [...edges.values()].find(
          (edge) =>
            (edge.subjectId === resident.id && edge.objectId === user.id) ||
            (edge.subjectId === user.id && edge.objectId === resident.id),
        )
      : undefined;
  const currentActivity = [...entities.values()]
    .filter(
      (entity) =>
        readAgendaKind(entity) === AgentAgendaRecordKinds.Activity &&
        readStringAttribute(entity, "status") === AgentAgendaStatuses.Active &&
        entity.parentId === resident?.id,
    )
    .sort(compareRecentlyChanged)[0];
  return {
    residentId: resident?.id ?? null,
    userId: user?.id ?? null,
    location: locationEdge ? (entities.get(locationEdge.objectId)?.label ?? null) : null,
    activity: currentActivity?.label ?? readStringAttribute(resident, AgentWorldSemanticAttributes.Activity) ?? null,
    bodyState: readStringAttribute(resident, AgentWorldSemanticAttributes.BodyState) ?? null,
    emotionState: readStringAttribute(resident, AgentWorldSemanticAttributes.EmotionState) ?? null,
    interruptedBy: readStringAttribute(resident, AgentWorldSemanticAttributes.InterruptedBy) ?? null,
    relationship: relationshipEdge?.relationLabel ?? relationshipEdge?.relation ?? null,
    nextPlan: schedules.find((schedule) => schedule.actorRole === AgentAgendaActorRoles.Resident) ?? null,
  };
}

function projectCommitments(
  entities: ReadonlyMap<string, MutableEntityState>,
  events: readonly AgentWorldEvent[],
): AgentWorldCommitment[] {
  const evidenceByEntity = new Map<string, readonly string[]>();
  for (const event of events) {
    if (event.evidenceRefs.length > 0) evidenceByEntity.set(event.subject.id, event.evidenceRefs);
  }
  return [...entities.values()]
    .filter(
      (entity) =>
        readAgendaKind(entity) === AgentAgendaRecordKinds.Goal &&
        isOpenAgendaStatus(readStringAttribute(entity, "status") ?? ""),
    )
    .flatMap((entity) => {
      const actor = entity.parentId ? entities.get(entity.parentId) : undefined;
      const actorRole = readActorRole(actor);
      const status = readAgendaStatus(entity);
      if (!actor || !actorRole || !status) return [];
      return [
        {
          id: entity.id,
          revision: readRequiredCommitmentRevision(entity),
          label: entity.label,
          actorId: actor.id,
          actorRole,
          status,
          dueAt: readStringAttribute(entity, "dueAt") ?? null,
          startsAt: readStringAttribute(entity, "startsAt") ?? null,
          endsAt: readStringAttribute(entity, "endsAt") ?? null,
          detail: readStringAttribute(entity, "detail") ?? null,
          ...(readStringAttribute(entity, "intentMode")
            ? { intentMode: readStringAttribute(entity, "intentMode") as AgentWorldCommitment["intentMode"] }
            : {}),
          ...(readNumberAttribute(entity, "priority") !== undefined
            ? { priority: readNumberAttribute(entity, "priority") }
            : {}),
          ...(readNumberAttribute(entity, "progress") !== undefined
            ? { progress: readNumberAttribute(entity, "progress") }
            : {}),
          ...(readStringArrayAttribute(entity, "successCriteria")
            ? { successCriteria: readStringArrayAttribute(entity, "successCriteria") }
            : {}),
          ...(readStringAttribute(entity, "nextReviewAt")
            ? { nextReviewAt: readStringAttribute(entity, "nextReviewAt") }
            : {}),
          ...(readStringAttribute(entity, "blockedReason")
            ? { blockedReason: readStringAttribute(entity, "blockedReason") }
            : {}),
          ...(readStringAttribute(entity, "statusReason")
            ? { statusReason: readStringAttribute(entity, "statusReason") }
            : {}),
          ...(readStringAttribute(entity, "parentGoalId")
            ? { parentGoalId: readStringAttribute(entity, "parentGoalId") }
            : {}),
          ...(readStringAttribute(entity, "ownerSessionId")
            ? { ownerSessionId: readStringAttribute(entity, "ownerSessionId") }
            : {}),
          sourceRefs: evidenceByEntity.get(entity.id) ?? [],
          updatedAt: entity.lastChangedAt,
        },
      ];
    })
    .sort((left, right) => {
      const due = compareOptionalInstants(left.dueAt, right.dueAt);
      return due || (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || left.id.localeCompare(right.id);
    });
}

const AgendaKinds = new Set<AgentAgendaRecordKind>(Object.values(AgentAgendaRecordKinds));
const AgendaStatuses = new Set<AgentAgendaStatus>(Object.values(AgentAgendaStatuses));
const AgendaActorRoles = new Set<AgentAgendaActorRole>(Object.values(AgentAgendaActorRoles));
const OpenAgendaStatuses = new Set<AgentAgendaStatus>([
  AgentAgendaStatuses.Planned,
  AgentAgendaStatuses.Active,
  AgentAgendaStatuses.Paused,
]);

function readAgendaKind(entity: MutableEntityState): AgentAgendaRecordKind | undefined {
  const value = readStringAttribute(entity, "agendaKind");
  return value && AgendaKinds.has(value as AgentAgendaRecordKind) ? (value as AgentAgendaRecordKind) : undefined;
}

function readAgendaStatus(entity: MutableEntityState): AgentAgendaStatus | undefined {
  const value = readStringAttribute(entity, "status");
  return value && AgendaStatuses.has(value as AgentAgendaStatus) ? (value as AgentAgendaStatus) : undefined;
}

function readActorRole(entity: MutableEntityState | undefined): AgentAgendaActorRole | undefined {
  const value = readStringAttribute(entity, "role");
  return value && AgendaActorRoles.has(value as AgentAgendaActorRole) ? (value as AgentAgendaActorRole) : undefined;
}

function isOpenAgendaStatus(status: string): status is AgentAgendaStatus {
  return AgendaStatuses.has(status as AgentAgendaStatus) && OpenAgendaStatuses.has(status as AgentAgendaStatus);
}

function compareRecentlyChanged(left: MutableEntityState, right: MutableEntityState): number {
  return (right.lastChangedAt ?? "").localeCompare(left.lastChangedAt ?? "") || left.id.localeCompare(right.id);
}

function compareOptionalInstants(left: string | null, right: string | null): number {
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function readStringAttribute(entity: MutableEntityState | undefined, key: string): string | undefined {
  const value = entity?.attributes[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumberAttribute(entity: MutableEntityState | undefined, key: string): number | undefined {
  const value = entity?.attributes[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRequiredCommitmentRevision(entity: MutableEntityState): number {
  const revision = readNumberAttribute(entity, "revision");
  if (!revision || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(`World Goal entity is missing a valid Agenda revision: ${entity.id}`);
  }
  return revision;
}

function readStringArrayAttribute(entity: MutableEntityState | undefined, key: string): string[] | undefined {
  const value = entity?.attributes[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value.filter((item): item is string => item.trim().length > 0);
}

function changedEntityIds(changes: readonly AgentWorldEventChange[]): string[] {
  return uniqueStrings(
    changes.flatMap((change) => {
      switch (change.kind) {
        case "entity_upsert":
        case "entity_replace":
          return [change.entity.id];
        case "entity_patch":
        case "entity_retire":
          return [change.entityId];
        case "relation_assert":
          return [change.subject.id, change.object.id];
        case "relation_retract":
          return [change.subjectId, change.objectId];
        case "state_transition":
          return [change.actorId];
        case "state_machine_initialized":
          return [change.actorId];
        case "clock_advance":
          return [];
      }
    }),
  );
}

function relationKey(subjectId: string, relationId: string, objectId: string): string {
  return `senera://world-relation/${encodeURIComponent(subjectId)}/${relationId}/${encodeURIComponent(objectId)}`;
}
