import type Database from "better-sqlite3";
import { Temporal } from "@js-temporal/polyfill";
import { createOpaqueId } from "../Core/AgentIds.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import type { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import type {
  AgentAgendaEvent,
  AgentAgendaHistory,
  AgentAgendaRecordIdentity,
  AgentAgendaWorld,
} from "../Agenda/AgentAgendaTypes.js";
import {
  AgentContinuityEntityKinds,
  getAgentContinuityRelationDefinition,
  type AgentContinuityEntityKind,
} from "../Continuity/AgentContinuityRelationCatalog.js";
import { assertAgentContinuityRelationEndpoints } from "../Continuity/AgentContinuityRelationCatalog.js";
import type { AgentWorldAttributes } from "./AgentWorldTypes.js";
import { parseAgentTextParts, projectLegacyIdentityText, type AgentTextParts } from "../Text/AgentTextParts.js";

export interface AgentWorldEventSubject {
  readonly id: string;
  readonly kind: AgentContinuityEntityKind;
}

export interface AgentWorldEntityDescriptor extends AgentWorldEventSubject {
  readonly label: string;
  readonly parentId: string | null;
  readonly attributes: AgentWorldAttributes;
}

export type AgentWorldEventChange =
  | { readonly kind: "entity_upsert"; readonly entity: AgentWorldEntityDescriptor }
  | { readonly kind: "entity_replace"; readonly entity: AgentWorldEntityDescriptor }
  | {
      readonly kind: "entity_patch";
      readonly entityId: string;
      readonly label?: string;
      readonly parentId?: string | null;
      readonly attributes: AgentWorldAttributes;
    }
  | { readonly kind: "entity_retire"; readonly entityId: string }
  | {
      readonly kind: "relation_assert";
      readonly subject: AgentWorldEventSubject;
      readonly relationId: string;
      readonly object: AgentWorldEventSubject;
      readonly validFrom?: string;
      readonly validUntil?: string;
    }
  | {
      readonly kind: "relation_retract";
      readonly subjectId: string;
      readonly relationId: string;
      readonly objectId: string;
    }
  | {
      readonly kind: "state_transition";
      readonly actorId: string;
      readonly machineId: string;
      readonly event: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly kind: "state_machine_initialized";
      readonly actorId: string;
      readonly machineId: string;
      readonly definitionRevision: string;
      readonly initialState: string;
    }
  | {
      readonly kind: "clock_advance";
      readonly from: string;
      readonly to: string;
      readonly previousPhaseId: string;
      readonly phaseId: string;
      readonly crossedLocalDates: readonly string[];
    };

export interface AgentWorldEvent {
  readonly id: string;
  readonly uri: string;
  readonly worldId: string;
  readonly sequence: number;
  readonly subject: AgentWorldEventSubject;
  readonly type: string;
  readonly summary: string;
  readonly summaryParts?: AgentTextParts;
  readonly changes: readonly AgentWorldEventChange[];
  readonly evidenceRefs: readonly string[];
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly localDate: string;
  readonly source: "agenda" | "world";
}

export interface AgentWorldEventAppendInput {
  readonly worldId: string;
  readonly timeZone: string;
  readonly subject: AgentWorldEventSubject;
  readonly type: string;
  readonly summary: string;
  readonly summaryParts?: AgentTextParts;
  readonly changes: readonly AgentWorldEventChange[];
  readonly evidenceRefs: readonly string[];
  readonly occurredAt: string;
  readonly recordedAt?: string;
  readonly idempotencyKey: string;
}

export interface AgentWorldEventLedgerSnapshot {
  readonly world: AgentAgendaWorld;
  readonly events: readonly AgentWorldEvent[];
}

interface WorldEventRow {
  readonly id: string;
  readonly uri: string;
  readonly world_id: string;
  readonly sequence: number;
  readonly subject_id: string;
  readonly subject_kind: AgentContinuityEntityKind;
  readonly event_type: string;
  readonly summary: string;
  readonly summary_parts_json: string;
  readonly changes_json: string;
  readonly evidence_refs_json: string;
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly local_date: string;
}

interface ActiveWorldRelation {
  readonly subjectId: string;
  readonly relationId: string;
  readonly objectId: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
}

/** Single read/write boundary for every event that may alter the materialized world. */
export class AgentWorldEventLedger {
  private readonly db: Database.Database;

  constructor(
    database: AgentSqliteDatabaseKernel | Database.Database,
    private readonly agenda: AgentAgendaService,
  ) {
    this.db = "connection" in database ? database.connection : database;
  }

  snapshot(timeZone: string): AgentWorldEventLedgerSnapshot {
    const agendaHistory = this.agenda.history(timeZone);
    const events = [...projectAgendaWorldEvents(agendaHistory), ...this.listRecorded(agendaHistory.world.id)].sort(
      compareWorldEvents,
    );
    return { world: agendaHistory.world, events };
  }

  append(input: AgentWorldEventAppendInput): AgentWorldEvent {
    const world = this.agenda.history(input.timeZone).world;
    if (world.id !== requireText(input.worldId, "World event world id")) {
      throw new Error(`World event does not belong to the active world: ${input.worldId}`);
    }
    const idempotencyKey = requireText(input.idempotencyKey, "World event idempotency key");
    const existing = this.findByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
    const subject = normalizeSubject(input.subject);
    const type = requireText(input.type, "World event type");
    const summary = requireText(input.summary, "World event summary");
    const summaryParts = input.summaryParts ? parseAgentTextParts(input.summaryParts, "World event summary parts") : [];
    const changes = validateChanges(input.changes);
    const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs);
    const occurredAt = normalizeInstant(input.occurredAt, "World event occurrence time");
    const recordedAt = normalizeInstant(input.recordedAt ?? new Date().toISOString(), "World event recording time");
    if (Temporal.Instant.compare(Temporal.Instant.from(recordedAt), Temporal.Instant.from(occurredAt)) < 0) {
      throw new Error("World event cannot be recorded before it occurred.");
    }
    const localDate = Temporal.Instant.from(occurredAt).toZonedDateTimeISO(world.timeZone).toPlainDate().toString();
    const id = createOpaqueId("world_event");
    const insert = this.db.transaction(() => {
      const replay = this.findByIdempotencyKey(idempotencyKey);
      if (replay) return replay;
      this.assertRelationCardinality(world.id, input.timeZone, changes);
      const sequence = this.nextSequence(world.id);
      this.db
        .prepare(
          `INSERT INTO agent_world_events
            (id, uri, world_id, sequence, idempotency_key, subject_id, subject_kind, event_type, summary,
             summary_parts_json, changes_json, evidence_refs_json, occurred_at, recorded_at, local_date)
           VALUES
           (@id, @uri, @worldId, @sequence, @idempotencyKey, @subjectId, @subjectKind, @eventType, @summary,
             @summaryPartsJson, @changesJson, @evidenceRefsJson, @occurredAt, @recordedAt, @localDate)`,
        )
        .run({
          id,
          uri: `senera://world-event/${id}`,
          worldId: world.id,
          sequence,
          idempotencyKey,
          subjectId: subject.id,
          subjectKind: subject.kind,
          eventType: type,
          summary,
          summaryPartsJson: JSON.stringify(summaryParts),
          changesJson: JSON.stringify(changes),
          evidenceRefsJson: JSON.stringify(evidenceRefs),
          occurredAt,
          recordedAt,
          localDate,
        });
      return this.findByIdempotencyKey(idempotencyKey)!;
    });
    return insert();
  }

  eventByIdempotencyKey(idempotencyKey: string): AgentWorldEvent | undefined {
    return this.findByIdempotencyKey(requireText(idempotencyKey, "World event idempotency key"));
  }

  deleteDerivedEvents(input: {
    readonly worldId: string;
    readonly eventType?: string;
    readonly eventTypePrefix?: string;
    readonly subjectIds?: readonly string[];
    readonly evidenceRefs?: readonly string[];
  }): number {
    const subjectIds = new Set(normalizeStringArray(input.subjectIds ?? [], "Derived world event subjects"));
    const evidenceRefs = new Set(normalizeStringArray(input.evidenceRefs ?? [], "Derived world event evidence"));
    const eventType = input.eventType?.trim();
    const eventTypePrefix = input.eventTypePrefix?.trim();
    if (Boolean(eventType) === Boolean(eventTypePrefix)) {
      throw new Error("Derived world event deletion requires exactly one event type selector.");
    }
    if (subjectIds.size === 0 && evidenceRefs.size === 0) {
      throw new Error("Derived world event deletion requires a subject or evidence reference.");
    }
    const eventTypeClause = eventType ? "event_type = ?" : "event_type LIKE ?";
    const rows = this.db
      .prepare<
        [string, string],
        { readonly id: string; readonly subject_id: string; readonly evidence_refs_json: string }
      >(
        `SELECT id, subject_id, evidence_refs_json FROM agent_world_events
          WHERE world_id = ? AND ${eventTypeClause}`,
      )
      .all(
        requireText(input.worldId, "Derived world event world id"),
        eventType ?? `${requireText(eventTypePrefix ?? "", "Derived world event type prefix")}%`,
      );
    const ids = rows
      .filter(
        (row) =>
          subjectIds.has(row.subject_id) ||
          normalizeEvidenceRefs(
            parseJsonText(row.evidence_refs_json, `World event ${row.id} evidence references`),
          ).some((ref) => evidenceRefs.has(ref)),
      )
      .map((row) => row.id);
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(", ");
    return this.db.prepare(`DELETE FROM agent_world_events WHERE id IN (${placeholders})`).run(...ids).changes;
  }

  private listRecorded(worldId: string): AgentWorldEvent[] {
    return this.db
      .prepare<[string], WorldEventRow>(
        `SELECT id, uri, world_id, sequence, subject_id, subject_kind, event_type, summary, summary_parts_json, changes_json,
                evidence_refs_json, occurred_at, recorded_at, local_date
           FROM agent_world_events
          WHERE world_id = ?
          ORDER BY occurred_at, recorded_at, sequence`,
      )
      .all(worldId)
      .map(projectWorldEventRow);
  }

  private findByIdempotencyKey(idempotencyKey: string): AgentWorldEvent | undefined {
    const row = this.db
      .prepare<[string], WorldEventRow>(
        `SELECT id, uri, world_id, sequence, subject_id, subject_kind, event_type, summary, summary_parts_json, changes_json,
                evidence_refs_json, occurred_at, recorded_at, local_date
           FROM agent_world_events WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey);
    return row ? projectWorldEventRow(row) : undefined;
  }

  private nextSequence(worldId: string): number {
    const row = this.db
      .prepare<[string], { readonly next_sequence: number }>(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM agent_world_events WHERE world_id = ?",
      )
      .get(worldId);
    if (!row || !Number.isSafeInteger(row.next_sequence) || row.next_sequence < 1) {
      throw new Error(`Cannot allocate a world event sequence for world: ${worldId}`);
    }
    return row.next_sequence;
  }

  private assertRelationCardinality(
    worldId: string,
    timeZone: string,
    changes: readonly AgentWorldEventChange[],
  ): void {
    const snapshot = this.snapshot(timeZone);
    if (snapshot.world.id !== worldId) {
      throw new Error(`World relation validation received a different active world: ${worldId}`);
    }
    const relations = new Map<string, ActiveWorldRelation>();
    for (const event of snapshot.events) applyRelationChanges(relations, event.changes);
    applyRelationChanges(relations, changes);

    for (const change of changes) {
      if (change.kind !== "relation_assert") continue;
      const definition = getAgentContinuityRelationDefinition(change.relationId);
      if (definition.cardinality !== "single_subject") continue;
      const conflicts = [...relations.values()].filter(
        (relation) =>
          relation.subjectId === change.subject.id &&
          relation.relationId === definition.id &&
          relation.objectId !== change.object.id &&
          relationValidityOverlaps(relation, change),
      );
      if (conflicts.length > 0) {
        throw new Error(
          `World relation ${definition.id} permits one object for ${change.subject.id}; ` +
            `it conflicts with ${conflicts.map((relation) => relation.objectId).join(", ")}.`,
        );
      }
    }
  }
}

function projectAgendaWorldEvents(history: AgentAgendaHistory): AgentWorldEvent[] {
  const actors = new Map(history.actors.map((actor) => [actor.id, actor] as const));
  const identities = new Map(history.identities.map((identity) => [identity.id, identity] as const));
  const seenRecords = new Set<string>();
  return history.events.map((event) => {
    const identity = identities.get(event.recordId);
    if (!identity) throw new Error(`Agenda world event references unknown record: ${event.recordId}`);
    const actor = actors.get(identity.actorId);
    if (!actor) throw new Error(`Agenda world event references unknown actor: ${identity.actorId}`);
    const first = !seenRecords.has(identity.id);
    seenRecords.add(identity.id);
    const subjectKind = agendaEntityKind(identity);
    const changes: AgentWorldEventChange[] = [
      {
        kind: "entity_upsert",
        entity: {
          id: actor.id,
          kind: "person",
          label: actor.role,
          parentId: null,
          attributes: { role: actor.role },
        },
      },
      first
        ? {
            kind: "entity_upsert",
            entity: {
              id: identity.id,
              kind: subjectKind,
              label: event.mutation.summary!,
              parentId: actor.id,
              attributes: agendaMutationAttributes(identity, event),
            },
          }
        : {
            kind: "entity_patch",
            entityId: identity.id,
            ...(event.mutation.summary ? { label: event.mutation.summary } : {}),
            attributes: agendaMutationAttributes(identity, event),
          },
      {
        kind: "relation_assert",
        subject: { id: actor.id, kind: "person" },
        relationId: "participates_in",
        object: { id: identity.id, kind: subjectKind },
      },
      ...projectAgendaRelations(identity, event, identities),
    ];
    return {
      id: event.id,
      uri: event.uri,
      worldId: history.world.id,
      sequence: event.sequence,
      subject: { id: identity.id, kind: subjectKind },
      type: `agenda.${event.kind}`,
      summary: event.mutation.summary ?? `${identity.kind}:${event.kind}`,
      changes: validateChanges(changes),
      evidenceRefs: event.sourceRefs,
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
      localDate: event.localDate,
      source: "agenda",
    };
  });
}

function projectAgendaRelations(
  identity: AgentAgendaRecordIdentity,
  event: AgentAgendaEvent,
  identities: ReadonlyMap<string, AgentAgendaRecordIdentity>,
): AgentWorldEventChange[] {
  const subject = { id: identity.id, kind: agendaEntityKind(identity) } as const;
  const changes: AgentWorldEventChange[] = [];
  if (event.mutation.relatedRecordId) {
    const related = identities.get(event.mutation.relatedRecordId);
    if (!related) throw new Error(`Agenda relation references unknown record: ${event.mutation.relatedRecordId}`);
    changes.push({
      kind: "relation_assert",
      subject,
      relationId: related.kind === "goal" ? "contributes_to" : "depends_on",
      object: { id: related.id, kind: agendaEntityKind(related) },
    });
  }
  const scheduledAt = event.mutation.dueAt ?? event.mutation.startsAt;
  if (scheduledAt) {
    const instant = normalizeInstant(scheduledAt, "Agenda world schedule time");
    const timeId = `senera://world-time/${encodeURIComponent(instant)}`;
    changes.push(
      {
        kind: "entity_upsert",
        entity: { id: timeId, kind: "time", label: instant, parentId: null, attributes: { instant } },
      },
      { kind: "relation_assert", subject, relationId: "scheduled_for", object: { id: timeId, kind: "time" } },
    );
  }
  return changes;
}

function agendaMutationAttributes(identity: AgentAgendaRecordIdentity, event: AgentAgendaEvent): AgentWorldAttributes {
  const attributes: Record<string, AgentWorldAttributes[string]> = {
    agendaKind: identity.kind,
    revision: event.sequence,
  };
  if (event.mutation.status !== undefined) attributes.status = event.mutation.status;
  if (event.mutation.dueAt !== undefined) attributes.dueAt = event.mutation.dueAt;
  if (event.mutation.startsAt !== undefined) attributes.startsAt = event.mutation.startsAt;
  if (event.mutation.endsAt !== undefined) attributes.endsAt = event.mutation.endsAt;
  if (event.mutation.detail !== undefined) attributes.detail = event.mutation.detail;
  if (event.mutation.intentMode !== undefined) attributes.intentMode = event.mutation.intentMode;
  if (event.mutation.priority !== undefined) attributes.priority = event.mutation.priority;
  if (event.mutation.progress !== undefined) attributes.progress = event.mutation.progress;
  if (event.mutation.successCriteria !== undefined) attributes.successCriteria = [...event.mutation.successCriteria];
  if (event.mutation.nextReviewAt !== undefined) attributes.nextReviewAt = event.mutation.nextReviewAt;
  if (event.mutation.blockedReason !== undefined) attributes.blockedReason = event.mutation.blockedReason;
  if (event.mutation.statusReason !== undefined) attributes.statusReason = event.mutation.statusReason;
  if (event.mutation.parentGoalId !== undefined) attributes.parentGoalId = event.mutation.parentGoalId;
  if (event.mutation.ownerSessionId !== undefined) attributes.ownerSessionId = event.mutation.ownerSessionId;
  if (event.mutation.lastDecisionKey !== undefined) attributes.lastDecisionKey = event.mutation.lastDecisionKey;
  return attributes;
}

function agendaEntityKind(identity: AgentAgendaRecordIdentity): AgentContinuityEntityKind {
  switch (identity.kind) {
    case "goal":
      return "goal";
    case "activity":
      return "task";
    case "event":
    case "schedule":
      return "event";
  }
}

function projectWorldEventRow(row: WorldEventRow): AgentWorldEvent {
  const subject = normalizeSubject({ id: row.subject_id, kind: row.subject_kind });
  const storedParts = parseAgentTextParts(
    parseJsonText(row.summary_parts_json, `World event ${row.id} summary parts`),
    `World event ${row.id} summary parts`,
  );
  const summaryParts = storedParts.length > 0 ? storedParts : projectLegacyIdentityText(row.summary);
  return {
    id: row.id,
    uri: row.uri,
    worldId: row.world_id,
    sequence: row.sequence,
    subject,
    type: requireText(row.event_type, "Stored world event type"),
    summary: requireText(row.summary, "Stored world event summary"),
    ...(summaryParts.length > 0 ? { summaryParts } : {}),
    changes: validateChanges(parseJsonText(row.changes_json, `World event ${row.id} changes`)),
    evidenceRefs: normalizeEvidenceRefs(
      parseJsonText(row.evidence_refs_json, `World event ${row.id} evidence references`),
    ),
    occurredAt: normalizeInstant(row.occurred_at, "Stored world event occurrence time"),
    recordedAt: normalizeInstant(row.recorded_at, "Stored world event recording time"),
    localDate: row.local_date,
    source: "world",
  };
}

function validateChanges(value: unknown): AgentWorldEventChange[] {
  if (!Array.isArray(value)) throw new Error("World event changes must be an array.");
  return value.map((change): AgentWorldEventChange => {
    if (!change || typeof change !== "object" || Array.isArray(change) || typeof change.kind !== "string") {
      throw new Error("World event change must be a discriminated object.");
    }
    const candidate = change as Record<string, unknown>;
    switch (candidate.kind) {
      case "entity_upsert": {
        const entity = normalizeEntity(candidate.entity);
        return { kind: "entity_upsert", entity };
      }
      case "entity_replace": {
        const entity = normalizeEntity(candidate.entity);
        return { kind: "entity_replace", entity };
      }
      case "entity_patch":
        return {
          kind: "entity_patch",
          entityId: requireUnknownText(candidate.entityId, "World entity patch id"),
          ...(candidate.label !== undefined
            ? { label: requireUnknownText(candidate.label, "World entity patch label") }
            : {}),
          ...(candidate.parentId !== undefined
            ? {
                parentId:
                  candidate.parentId === null
                    ? null
                    : requireUnknownText(candidate.parentId, "World entity patch parent id"),
              }
            : {}),
          attributes: normalizeAttributes(candidate.attributes, "World entity patch attributes"),
        };
      case "entity_retire":
        return { kind: "entity_retire", entityId: requireUnknownText(candidate.entityId, "Retired entity id") };
      case "relation_assert": {
        const subject = normalizeSubject(candidate.subject as AgentWorldEventSubject);
        const object = normalizeSubject(candidate.object as AgentWorldEventSubject);
        const relationId = getAgentContinuityRelationDefinition(
          requireUnknownText(candidate.relationId, "World relation id"),
        ).id;
        assertAgentContinuityRelationEndpoints({
          relationId,
          subject: { uri: subject.id, kind: subject.kind },
          object: { uri: object.id, kind: object.kind },
        });
        const validFrom = optionalInstant(candidate.validFrom, "World relation validity start");
        const validUntil = optionalInstant(candidate.validUntil, "World relation validity end");
        if (
          validFrom &&
          validUntil &&
          Temporal.Instant.compare(Temporal.Instant.from(validUntil), Temporal.Instant.from(validFrom)) <= 0
        ) {
          throw new Error("World relation validity end must be later than its start.");
        }
        return {
          kind: "relation_assert",
          subject,
          relationId,
          object,
          ...(validFrom ? { validFrom } : {}),
          ...(validUntil ? { validUntil } : {}),
        };
      }
      case "relation_retract":
        return {
          kind: "relation_retract",
          subjectId: requireUnknownText(candidate.subjectId, "Retracted relation subject id"),
          relationId: getAgentContinuityRelationDefinition(
            requireUnknownText(candidate.relationId, "Retracted relation id"),
          ).id,
          objectId: requireUnknownText(candidate.objectId, "Retracted relation object id"),
        };
      case "state_transition":
        return {
          kind: "state_transition",
          actorId: requireUnknownText(candidate.actorId, "State transition actor id"),
          machineId: requireUnknownText(candidate.machineId, "State transition machine id"),
          event: requireUnknownText(candidate.event, "State transition event"),
          from: requireUnknownText(candidate.from, "State transition source"),
          to: requireUnknownText(candidate.to, "State transition target"),
        };
      case "state_machine_initialized":
        return {
          kind: "state_machine_initialized",
          actorId: requireUnknownText(candidate.actorId, "State machine initialization actor id"),
          machineId: requireUnknownText(candidate.machineId, "State machine initialization machine id"),
          definitionRevision: requireUnknownText(
            candidate.definitionRevision,
            "State machine initialization definition revision",
          ),
          initialState: requireUnknownText(candidate.initialState, "State machine initialization initial state"),
        };
      case "clock_advance":
        return {
          kind: "clock_advance",
          from: normalizeInstant(requireUnknownText(candidate.from, "Clock advance source"), "Clock advance source"),
          to: normalizeInstant(requireUnknownText(candidate.to, "Clock advance target"), "Clock advance target"),
          previousPhaseId: requireUnknownText(candidate.previousPhaseId, "Previous world phase"),
          phaseId: requireUnknownText(candidate.phaseId, "Current world phase"),
          crossedLocalDates: normalizeStringArray(candidate.crossedLocalDates, "Crossed local dates"),
        };
      default:
        throw new Error(`Unknown world event change kind: ${String(candidate.kind)}`);
    }
  });
}

function normalizeSubject(subject: AgentWorldEventSubject): AgentWorldEventSubject {
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) {
    throw new Error("World event subject must be an object.");
  }
  if (!AgentContinuityEntityKinds.includes(subject.kind)) {
    throw new Error(`Unknown world entity kind: ${String(subject.kind)}`);
  }
  return { id: requireText(subject.id, "World event subject id"), kind: subject.kind };
}

function normalizeEntity(value: unknown): AgentWorldEntityDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("World entity descriptor must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  const subject = normalizeSubject(candidate as unknown as AgentWorldEventSubject);
  return {
    ...subject,
    label: requireUnknownText(candidate.label, "World entity label"),
    parentId: candidate.parentId === null ? null : requireUnknownText(candidate.parentId, "World entity parent id"),
    attributes: normalizeAttributes(candidate.attributes, "World entity attributes"),
  };
}

function normalizeAttributes(value: unknown, label: string): AgentWorldAttributes {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  try {
    return JSON.parse(JSON.stringify(value)) as AgentWorldAttributes;
  } catch (error) {
    throw new Error(`${label} must be JSON serializable.`, { cause: error });
  }
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be a string array.`);
  }
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
}

function optionalInstant(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : normalizeInstant(requireUnknownText(value, label), label);
}

function normalizeEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("World event evidence references must be a string array.");
  }
  const refs = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
  if (refs.length === 0) throw new Error("World event requires at least one evidence reference.");
  return refs;
}

function normalizeInstant(value: string, label: string): string {
  try {
    return Temporal.Instant.from(requireText(value, label)).toString();
  } catch (error) {
    throw new Error(`${label} must use an ISO timestamp with an explicit offset.`, { cause: error });
  }
}

function applyRelationChanges(
  relations: Map<string, ActiveWorldRelation>,
  changes: readonly AgentWorldEventChange[],
): void {
  for (const change of changes) {
    switch (change.kind) {
      case "relation_assert": {
        const relationId = getAgentContinuityRelationDefinition(change.relationId).id;
        const relation: ActiveWorldRelation = {
          subjectId: change.subject.id,
          relationId,
          objectId: change.object.id,
          ...(change.validFrom ? { validFrom: change.validFrom } : {}),
          ...(change.validUntil ? { validUntil: change.validUntil } : {}),
        };
        relations.set(worldRelationKey(relation.subjectId, relation.relationId, relation.objectId), relation);
        break;
      }
      case "relation_retract":
        relations.delete(worldRelationKey(change.subjectId, change.relationId, change.objectId));
        break;
      case "entity_retire":
        for (const [key, relation] of relations) {
          if (relation.subjectId === change.entityId || relation.objectId === change.entityId) relations.delete(key);
        }
        break;
      default:
        break;
    }
  }
}

function relationValidityOverlaps(
  existing: ActiveWorldRelation,
  candidate: Extract<AgentWorldEventChange, { readonly kind: "relation_assert" }>,
): boolean {
  const existingStarts = existing.validFrom ? Temporal.Instant.from(existing.validFrom) : undefined;
  const existingEnds = existing.validUntil ? Temporal.Instant.from(existing.validUntil) : undefined;
  const candidateStarts = candidate.validFrom ? Temporal.Instant.from(candidate.validFrom) : undefined;
  const candidateEnds = candidate.validUntil ? Temporal.Instant.from(candidate.validUntil) : undefined;
  return (
    (!existingEnds || !candidateStarts || Temporal.Instant.compare(existingEnds, candidateStarts) > 0) &&
    (!candidateEnds || !existingStarts || Temporal.Instant.compare(candidateEnds, existingStarts) > 0)
  );
}

function worldRelationKey(subjectId: string, relationId: string, objectId: string): string {
  return `${subjectId}\u0000${relationId}\u0000${objectId}`;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function requireUnknownText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return requireText(value, label);
}

function compareWorldEvents(left: AgentWorldEvent, right: AgentWorldEvent): number {
  const chronological =
    left.occurredAt.localeCompare(right.occurredAt) || left.recordedAt.localeCompare(right.recordedAt);
  if (chronological) return chronological;

  // Recorded world events have one global, monotonic sequence. That sequence
  // is the causal order for derived events sharing a physical occurrence time;
  // a URI is only an identity, never an ordering mechanism.
  if (left.source === "world" && right.source === "world") return left.sequence - right.sequence;
  if (left.source !== right.source) return left.source === "agenda" ? -1 : 1;
  return left.uri.localeCompare(right.uri);
}
