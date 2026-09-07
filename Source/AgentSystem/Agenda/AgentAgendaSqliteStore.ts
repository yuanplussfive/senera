import type Database from "better-sqlite3";
import { Temporal } from "@js-temporal/polyfill";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { projectAgentAgendaSnapshot } from "./AgentAgendaProjection.js";
import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaIntentModes,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
  type AgentAgendaActor,
  type AgentAgendaActorRole,
  type AgentAgendaAppendEventInput,
  type AgentAgendaCommandEventInput,
  type AgentAgendaCommandReceipt,
  type AgentAgendaAuthority,
  type AgentAgendaIntentMode,
  type AgentAgendaCreateRecordInput,
  type AgentAgendaEvent,
  type AgentAgendaEventKind,
  type AgentAgendaHistory,
  type AgentAgendaMutation,
  type AgentAgendaRecordIdentity,
  type AgentAgendaRecordKind,
  type AgentAgendaSnapshot,
  type AgentAgendaStatus,
  type AgentAgendaWorld,
  type AgentAgendaWriteReceipt,
} from "./AgentAgendaTypes.js";

interface WorldRow {
  readonly id: string;
  readonly uri: string;
  readonly time_zone: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ActorRow {
  readonly id: string;
  readonly uri: string;
  readonly world_id: string;
  readonly role: AgentAgendaActorRole;
  readonly created_at: string;
}

interface RecordRow {
  readonly id: string;
  readonly uri: string;
  readonly world_id: string;
  readonly actor_id: string;
  readonly kind: AgentAgendaRecordKind;
  readonly created_at: string;
}

interface EventRow {
  readonly id: string;
  readonly uri: string;
  readonly record_id: string;
  readonly sequence: number;
  readonly idempotency_key: string;
  readonly event_kind: AgentAgendaEventKind;
  readonly mutation_json: string;
  readonly source_refs_json: string;
  readonly authority: AgentAgendaAuthority;
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly local_date: string;
}

interface CommandReceiptRow {
  readonly command_id: string;
  readonly operation_kind: string;
  readonly payload_hash: string;
  readonly record_id: string;
  readonly event_id: string;
  readonly revision: number;
  readonly created_at: string;
}

export class AgentAgendaCommandIdConflictError extends AgentBaseError {
  readonly code = "agenda_command_id_conflict";

  constructor(
    readonly commandId: string,
    readonly expected: { readonly operationKind: string; readonly payloadHash: string },
    readonly received: { readonly operationKind: string; readonly payloadHash: string },
  ) {
    super(`Agenda commandId was reused with a different command: ${commandId}`);
  }
}

export class AgentAgendaRevisionConflictError extends AgentBaseError {
  readonly code = "agenda_revision_conflict";

  constructor(
    readonly recordId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Agenda record revision conflict for ${recordId}: expected ${expectedRevision}, actual ${actualRevision}.`);
  }
}

export interface AgentAgendaWorldInput {
  readonly timeZone: string;
  readonly now?: Date;
}

/** Authoritative SQLite storage for one durable world agenda. */
export class AgentAgendaSqliteStore {
  private readonly db: Database.Database;

  constructor(database: AgentSqliteDatabaseKernel | Database.Database) {
    this.db = database instanceof AgentSqliteDatabaseKernel ? database.connection : database;
  }

  ensureWorld(input: AgentAgendaWorldInput): AgentAgendaWorld {
    const timeZone = normalizeTimeZone(input.timeZone);
    const existing = this.db
      .prepare<[], WorldRow>(
        `SELECT id, uri, time_zone, created_at, updated_at
           FROM agent_agenda_worlds
          ORDER BY created_at ASC, id ASC
          LIMIT 1`,
      )
      .get();
    if (existing) {
      const world = projectWorld(existing);
      if (world.timeZone !== timeZone) {
        throw new Error(
          `Agenda world time zone is immutable after creation: expected ${world.timeZone}, received ${timeZone}.`,
        );
      }
      return world;
    }

    const timestamp = normalizeInstant((input.now ?? new Date()).toISOString(), "Agenda world creation time");
    const id = createOpaqueId("world");
    this.db
      .prepare(
        `INSERT INTO agent_agenda_worlds (id, uri, time_zone, created_at, updated_at)
         VALUES (@id, @uri, @timeZone, @createdAt, @updatedAt)`,
      )
      .run({ id, uri: `senera://world/${id}`, timeZone, createdAt: timestamp, updatedAt: timestamp });
    return this.findWorld(id)!;
  }

  ensureActor(worldId: string, role: AgentAgendaActorRole, now = new Date()): AgentAgendaActor {
    const normalizedWorldId = requireText(worldId, "Agenda world id");
    assertActorRole(role);
    const existing = this.db
      .prepare<[string, AgentAgendaActorRole], ActorRow>(
        `SELECT id, uri, world_id, role, created_at
           FROM agent_agenda_actors
          WHERE world_id = ? AND role = ?`,
      )
      .get(normalizedWorldId, role);
    if (existing) return projectActor(existing);
    if (!this.findWorld(normalizedWorldId)) throw new Error(`Agenda world does not exist: ${normalizedWorldId}`);

    const id = createOpaqueId("agenda_actor");
    const createdAt = normalizeInstant(now.toISOString(), "Agenda actor creation time");
    this.db
      .prepare(
        `INSERT INTO agent_agenda_actors (id, uri, world_id, role, created_at)
         VALUES (@id, @uri, @worldId, @role, @createdAt)`,
      )
      .run({ id, uri: `senera://agenda-actor/${id}`, worldId: normalizedWorldId, role, createdAt });
    return this.findActor(id)!;
  }

  createRecord(input: AgentAgendaCreateRecordInput): {
    record: AgentAgendaRecordIdentity;
    event: AgentAgendaEvent;
    receipt: AgentAgendaWriteReceipt;
  } {
    const create = this.db.transaction((value: AgentAgendaCreateRecordInput) => {
      const existing = this.findEventByIdempotencyKey(
        requireText(value.idempotencyKey, "Agenda event idempotency key"),
      );
      if (existing) {
        const record = this.findRecordIdentity(existing.recordId);
        if (!record) throw new Error(`Agenda idempotency event has no record: ${existing.id}`);
        return { record, event: existing, receipt: { disposition: "idempotent" as const } };
      }
      const world = this.findWorld(requireText(value.worldId, "Agenda record world id"));
      if (!world) throw new Error(`Agenda world does not exist: ${value.worldId}`);
      const actor = this.findActor(requireText(value.actorId, "Agenda record actor id"));
      if (!actor || actor.worldId !== world.id) throw new Error("Agenda record actor must belong to its world.");
      assertRecordKind(value.kind);
      assertEventKind(value.eventKind);
      const mutation = validateInitialMutation(value.mutation);
      assertInitialEvent(value.kind, value.eventKind, mutation.status);
      const id = createOpaqueId("agenda_record");
      const createdAt = normalizeInstant(value.recordedAt, "Agenda record creation time");
      this.db
        .prepare(
          `INSERT INTO agent_agenda_records (id, uri, world_id, actor_id, kind, created_at)
           VALUES (@id, @uri, @worldId, @actorId, @kind, @createdAt)`,
        )
        .run({ id, uri: `senera://agenda/${id}`, worldId: world.id, actorId: actor.id, kind: value.kind, createdAt });
      const record = this.findRecordIdentity(id)!;
      const { event } = this.appendEvent({
        recordId: id,
        kind: value.eventKind,
        mutation,
        sourceRefs: value.sourceRefs,
        authority: value.authority,
        occurredAt: value.occurredAt,
        recordedAt: value.recordedAt,
        idempotencyKey: value.idempotencyKey,
      });
      return { record, event, receipt: { disposition: "created" as const } };
    });
    return create(input);
  }

  appendEvent(input: AgentAgendaAppendEventInput): { event: AgentAgendaEvent; receipt: AgentAgendaWriteReceipt } {
    const record = this.findRecordIdentity(requireText(input.recordId, "Agenda event record id"));
    if (!record) throw new Error(`Agenda record does not exist: ${input.recordId}`);
    const idempotencyKey = requireText(input.idempotencyKey, "Agenda event idempotency key");
    const existing = this.findEventByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.recordId !== record.id) {
        throw new Error(`Agenda idempotency key is already bound to another record: ${idempotencyKey}`);
      }
      return { event: existing, receipt: { disposition: "idempotent" } };
    }
    assertEventKind(input.kind);
    const mutation = validateMutation(input.mutation);
    const sourceRefs = normalizeSourceRefs(input.sourceRefs);
    assertAuthority(input.authority);
    const occurredAt = normalizeInstant(input.occurredAt, "Agenda event occurrence time");
    const recordedAt = normalizeInstant(input.recordedAt, "Agenda event recording time");
    if (Temporal.Instant.compare(Temporal.Instant.from(recordedAt), Temporal.Instant.from(occurredAt)) < 0) {
      throw new Error("Agenda event cannot be recorded before it occurred.");
    }
    const world = this.findWorld(record.worldId);
    if (!world) throw new Error(`Agenda record world does not exist: ${record.worldId}`);
    if (mutation.relatedRecordId !== undefined && mutation.relatedRecordId !== null) {
      const related = this.findRecordIdentity(mutation.relatedRecordId);
      if (!related || related.worldId !== world.id) {
        throw new Error(`Agenda related record is not in the active world: ${mutation.relatedRecordId}`);
      }
    }
    const id = createOpaqueId("agenda_event");
    const sequence = this.nextEventSequence(record.id);
    const localDate = Temporal.Instant.from(occurredAt).toZonedDateTimeISO(world.timeZone).toPlainDate().toString();
    this.db
      .prepare(
        `INSERT INTO agent_agenda_events
          (id, uri, record_id, sequence, idempotency_key, event_kind, mutation_json, source_refs_json, authority, occurred_at, recorded_at, local_date)
         VALUES
          (@id, @uri, @recordId, @sequence, @idempotencyKey, @eventKind, @mutationJson, @sourceRefsJson, @authority, @occurredAt, @recordedAt, @localDate)`,
      )
      .run({
        id,
        uri: `senera://agenda-event/${id}`,
        recordId: record.id,
        sequence,
        idempotencyKey,
        eventKind: input.kind,
        mutationJson: JSON.stringify(mutation),
        sourceRefsJson: JSON.stringify(sourceRefs),
        authority: input.authority,
        occurredAt,
        recordedAt,
        localDate,
      });
    this.db
      .prepare("UPDATE agent_agenda_worlds SET updated_at = @updatedAt WHERE id = @worldId")
      .run({ worldId: world.id, updatedAt: recordedAt });
    return { event: this.findEvent(id)!, receipt: { disposition: "created" } };
  }

  appendCommandEvent(input: AgentAgendaCommandEventInput): {
    event: AgentAgendaEvent;
    receipt: AgentAgendaWriteReceipt;
  } {
    const execute = this.db.transaction(() => {
      const commandId = requireText(input.commandId, "Agenda command id");
      const operationKind = requireText(input.operationKind, "Agenda command operation kind");
      const payloadHash = requireText(input.payloadHash, "Agenda command payload hash");
      const existing = this.commandReceipt(commandId);
      if (existing) {
        if (existing.operationKind !== operationKind || existing.payloadHash !== payloadHash) {
          throw new AgentAgendaCommandIdConflictError(
            commandId,
            { operationKind: existing.operationKind, payloadHash: existing.payloadHash },
            { operationKind, payloadHash },
          );
        }
        const event = this.findEvent(existing.eventId);
        if (!event) throw new Error(`Agenda command receipt references missing event: ${existing.eventId}`);
        return { event, receipt: { disposition: "idempotent" as const } };
      }

      const expectedRevision = readPositiveSafeInteger(input.expectedRevision, "Agenda expected revision");
      const actualRevision = this.latestEventSequence(input.recordId);
      if (actualRevision !== expectedRevision) {
        throw new AgentAgendaRevisionConflictError(input.recordId, expectedRevision, actualRevision);
      }
      const appended = this.appendEvent(input);
      if (appended.receipt.disposition !== "created") {
        throw new Error(`Agenda command event exists without a command receipt: ${commandId}`);
      }
      this.db
        .prepare(
          `INSERT INTO agent_agenda_command_receipts
            (command_id, operation_kind, payload_hash, record_id, event_id, revision, created_at)
           VALUES
            (@commandId, @operationKind, @payloadHash, @recordId, @eventId, @revision, @createdAt)`,
        )
        .run({
          commandId,
          operationKind,
          payloadHash,
          recordId: input.recordId,
          eventId: appended.event.id,
          revision: appended.event.sequence,
          createdAt: appended.event.recordedAt,
        });
      return appended;
    });
    return execute();
  }

  snapshot(worldId: string, now = new Date()): AgentAgendaSnapshot {
    const world = this.findWorld(requireText(worldId, "Agenda snapshot world id"));
    if (!world) throw new Error(`Agenda world does not exist: ${worldId}`);
    return projectAgentAgendaSnapshot({
      world,
      actors: this.listActors(world.id),
      identities: this.listRecordIdentities(world.id),
      events: this.listEvents(world.id),
      now,
    });
  }

  history(worldId: string): AgentAgendaHistory {
    const world = this.findWorld(requireText(worldId, "Agenda history world id"));
    if (!world) throw new Error(`Agenda world does not exist: ${worldId}`);
    return {
      world,
      actors: this.listActors(world.id),
      identities: this.listRecordIdentities(world.id),
      events: this.listEvents(world.id),
    };
  }

  findWorld(worldId: string): AgentAgendaWorld | undefined {
    const row = this.db
      .prepare<[string], WorldRow>(
        "SELECT id, uri, time_zone, created_at, updated_at FROM agent_agenda_worlds WHERE id = ?",
      )
      .get(worldId);
    return row ? projectWorld(row) : undefined;
  }

  findActor(actorId: string): AgentAgendaActor | undefined {
    const row = this.db
      .prepare<[string], ActorRow>("SELECT id, uri, world_id, role, created_at FROM agent_agenda_actors WHERE id = ?")
      .get(actorId);
    return row ? projectActor(row) : undefined;
  }

  findRecordIdentity(recordId: string): AgentAgendaRecordIdentity | undefined {
    const row = this.db
      .prepare<[string], RecordRow>(
        "SELECT id, uri, world_id, actor_id, kind, created_at FROM agent_agenda_records WHERE id = ?",
      )
      .get(recordId);
    return row ? projectRecordIdentity(row) : undefined;
  }

  findEvent(eventId: string): AgentAgendaEvent | undefined {
    const row = this.db
      .prepare<[string], EventRow>(
        `SELECT id, uri, record_id, sequence, idempotency_key, event_kind, mutation_json, source_refs_json, authority, occurred_at, recorded_at, local_date
           FROM agent_agenda_events WHERE id = ?`,
      )
      .get(eventId);
    return row ? projectEvent(row) : undefined;
  }

  commandReceipt(commandId: string): AgentAgendaCommandReceipt | undefined {
    const row = this.db
      .prepare<[string], CommandReceiptRow>(
        `SELECT command_id, operation_kind, payload_hash, record_id, event_id, revision, created_at
           FROM agent_agenda_command_receipts
          WHERE command_id = ?`,
      )
      .get(requireText(commandId, "Agenda command id"));
    return row
      ? {
          commandId: row.command_id,
          operationKind: row.operation_kind,
          payloadHash: row.payload_hash,
          recordId: row.record_id,
          eventId: row.event_id,
          revision: readPositiveSafeInteger(row.revision, "Agenda command revision"),
          createdAt: normalizeInstant(row.created_at, "Agenda command creation time"),
        }
      : undefined;
  }

  private findEventByIdempotencyKey(idempotencyKey: string): AgentAgendaEvent | undefined {
    const row = this.db
      .prepare<[string], EventRow>(
        `SELECT id, uri, record_id, sequence, idempotency_key, event_kind, mutation_json, source_refs_json,
                authority, occurred_at, recorded_at, local_date
           FROM agent_agenda_events WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey);
    return row ? projectEvent(row) : undefined;
  }

  private listActors(worldId: string): AgentAgendaActor[] {
    return this.db
      .prepare<[string], ActorRow>(
        `SELECT id, uri, world_id, role, created_at
           FROM agent_agenda_actors WHERE world_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(worldId)
      .map(projectActor);
  }

  private listRecordIdentities(worldId: string): AgentAgendaRecordIdentity[] {
    return this.db
      .prepare<[string], RecordRow>(
        `SELECT id, uri, world_id, actor_id, kind, created_at
           FROM agent_agenda_records WHERE world_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(worldId)
      .map(projectRecordIdentity);
  }

  private listEvents(worldId: string): AgentAgendaEvent[] {
    return this.db
      .prepare<[string], EventRow>(
        `SELECT event.id, event.uri, event.record_id, event.sequence, event.idempotency_key, event.event_kind, event.mutation_json, event.source_refs_json,
                event.authority, event.occurred_at, event.recorded_at, event.local_date
           FROM agent_agenda_events AS event
           JOIN agent_agenda_records AS record ON record.id = event.record_id
          WHERE record.world_id = ?
          ORDER BY event.occurred_at ASC, event.recorded_at ASC, event.record_id ASC, event.sequence ASC`,
      )
      .all(worldId)
      .map(projectEvent);
  }

  private nextEventSequence(recordId: string): number {
    const row = this.db
      .prepare<[string], { readonly next_sequence: number }>(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM agent_agenda_events WHERE record_id = ?",
      )
      .get(recordId);
    if (!row || !Number.isSafeInteger(row.next_sequence) || row.next_sequence < 1) {
      throw new Error(`Cannot allocate an agenda event sequence for record: ${recordId}`);
    }
    return row.next_sequence;
  }

  private latestEventSequence(recordId: string): number {
    const row = this.db
      .prepare<[string], { readonly revision: number }>(
        "SELECT COALESCE(MAX(sequence), 0) AS revision FROM agent_agenda_events WHERE record_id = ?",
      )
      .get(recordId);
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) {
      throw new Error(`Cannot read the agenda event sequence for record: ${recordId}`);
    }
    return row.revision;
  }
}

function projectWorld(row: WorldRow): AgentAgendaWorld {
  return {
    id: row.id,
    uri: row.uri,
    timeZone: normalizeTimeZone(row.time_zone),
    createdAt: normalizeInstant(row.created_at, "Agenda world creation time"),
    updatedAt: normalizeInstant(row.updated_at, "Agenda world update time"),
  };
}

function projectActor(row: ActorRow): AgentAgendaActor {
  assertActorRole(row.role);
  return {
    id: row.id,
    uri: row.uri,
    worldId: row.world_id,
    role: row.role,
    createdAt: normalizeInstant(row.created_at, "Agenda actor creation time"),
  };
}

function projectRecordIdentity(row: RecordRow): AgentAgendaRecordIdentity {
  assertRecordKind(row.kind);
  return {
    id: row.id,
    uri: row.uri,
    worldId: row.world_id,
    actorId: row.actor_id,
    kind: row.kind,
    createdAt: normalizeInstant(row.created_at, "Agenda record creation time"),
  };
}

function projectEvent(row: EventRow): AgentAgendaEvent {
  assertEventKind(row.event_kind);
  assertAuthority(row.authority);
  return {
    id: row.id,
    uri: row.uri,
    recordId: row.record_id,
    sequence: readPositiveSafeInteger(row.sequence, "Agenda event sequence"),
    kind: row.event_kind,
    mutation: validateMutation(parseObjectJson(row.mutation_json, "Agenda event mutation")),
    sourceRefs: normalizeSourceRefs(parseStringArrayJson(row.source_refs_json, "Agenda event source references")),
    authority: row.authority,
    occurredAt: normalizeInstant(row.occurred_at, "Agenda event occurrence time"),
    recordedAt: normalizeInstant(row.recorded_at, "Agenda event recording time"),
    localDate: requireText(row.local_date, "Agenda event local date"),
  };
}

function readPositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function validateInitialMutation(
  value: AgentAgendaMutation,
): Required<Pick<AgentAgendaMutation, "summary" | "status">> & AgentAgendaMutation {
  const mutation = validateMutation(value);
  if (!mutation.summary || !mutation.status) throw new Error("An initial agenda event requires summary and status.");
  return mutation as Required<Pick<AgentAgendaMutation, "summary" | "status">> & AgentAgendaMutation;
}

function validateMutation(value: unknown): AgentAgendaMutation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Agenda mutation must be an object.");
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "summary",
    "status",
    "dueAt",
    "startsAt",
    "endsAt",
    "relatedRecordId",
    "detail",
    "intentMode",
    "priority",
    "progress",
    "successCriteria",
    "nextReviewAt",
    "blockedReason",
    "statusReason",
    "parentGoalId",
    "ownerSessionId",
    "lastDecisionKey",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`Agenda mutation contains unknown field: ${key}`);
  }
  const text = (name: string): string | undefined => {
    const item = record[name];
    if (item === undefined) return undefined;
    if (typeof item !== "string") throw new Error(`Agenda mutation ${name} must be a string.`);
    return requireText(item, `Agenda mutation ${name}`);
  };
  const nullableInstant = (name: string): string | null | undefined => {
    const item = record[name];
    if (item === undefined || item === null) return item;
    if (typeof item !== "string") throw new Error(`Agenda mutation ${name} must be an ISO timestamp or null.`);
    return normalizeInstant(item, `Agenda mutation ${name}`);
  };
  const status = record.status;
  if (status !== undefined) assertStatus(status);
  const intentMode = record.intentMode;
  if (
    intentMode !== undefined &&
    !Object.values(AgentAgendaIntentModes).includes(intentMode as AgentAgendaIntentMode)
  ) {
    throw new Error(`Agenda mutation intentMode is unsupported: ${String(intentMode)}.`);
  }
  const priority = record.priority;
  if (
    priority !== undefined &&
    (!Number.isSafeInteger(priority) || (priority as number) < 0 || (priority as number) > 100)
  ) {
    throw new Error("Agenda mutation priority must be an integer between 0 and 100.");
  }
  const progress = record.progress;
  if (
    progress !== undefined &&
    (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 1)
  ) {
    throw new Error("Agenda mutation progress must be a finite number between 0 and 1.");
  }
  const successCriteria = record.successCriteria;
  if (
    successCriteria !== undefined &&
    (!Array.isArray(successCriteria) ||
      successCriteria.some((criterion) => typeof criterion !== "string" || criterion.trim().length === 0))
  ) {
    throw new Error("Agenda mutation successCriteria must be a string array with non-empty entries.");
  }
  return {
    ...(text("summary") !== undefined ? { summary: text("summary") } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(nullableInstant("dueAt") !== undefined ? { dueAt: nullableInstant("dueAt") } : {}),
    ...(nullableInstant("startsAt") !== undefined ? { startsAt: nullableInstant("startsAt") } : {}),
    ...(nullableInstant("endsAt") !== undefined ? { endsAt: nullableInstant("endsAt") } : {}),
    ...(record.relatedRecordId !== undefined
      ? {
          relatedRecordId:
            record.relatedRecordId === null
              ? null
              : requireTextValue(record.relatedRecordId, "Agenda mutation relatedRecordId"),
        }
      : {}),
    ...(record.detail !== undefined
      ? { detail: record.detail === null ? null : requireTextValue(record.detail, "Agenda mutation detail") }
      : {}),
    ...(intentMode !== undefined ? { intentMode: intentMode as AgentAgendaIntentMode } : {}),
    ...(priority !== undefined ? { priority: priority as number } : {}),
    ...(progress !== undefined ? { progress: progress as number } : {}),
    ...(successCriteria !== undefined
      ? { successCriteria: (successCriteria as string[]).map((item) => item.trim()) }
      : {}),
    ...(nullableInstant("nextReviewAt") !== undefined ? { nextReviewAt: nullableInstant("nextReviewAt") } : {}),
    ...(record.blockedReason !== undefined
      ? {
          blockedReason:
            record.blockedReason === null
              ? null
              : requireTextValue(record.blockedReason, "Agenda mutation blockedReason"),
        }
      : {}),
    ...(record.statusReason !== undefined
      ? {
          statusReason:
            record.statusReason === null ? null : requireTextValue(record.statusReason, "Agenda mutation statusReason"),
        }
      : {}),
    ...(record.parentGoalId !== undefined
      ? {
          parentGoalId:
            record.parentGoalId === null ? null : requireTextValue(record.parentGoalId, "Agenda mutation parentGoalId"),
        }
      : {}),
    ...(record.ownerSessionId !== undefined
      ? {
          ownerSessionId:
            record.ownerSessionId === null
              ? null
              : requireTextValue(record.ownerSessionId, "Agenda mutation ownerSessionId"),
        }
      : {}),
    ...(record.lastDecisionKey !== undefined
      ? {
          lastDecisionKey:
            record.lastDecisionKey === null
              ? null
              : requireTextValue(record.lastDecisionKey, "Agenda mutation lastDecisionKey"),
        }
      : {}),
  };
}

function parseObjectJson(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be an object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function parseStringArrayJson(value: string, label: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
      throw new Error("must be a string array");
    return parsed;
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function normalizeSourceRefs(values: readonly string[]): string[] {
  const sourceRefs = [...new Set(values.map((value) => requireText(value, "Agenda source reference")))].sort();
  if (sourceRefs.length === 0) throw new Error("Agenda event requires at least one source reference.");
  return sourceRefs;
}

function assertInitialEvent(
  kind: AgentAgendaRecordKind,
  eventKind: AgentAgendaEventKind,
  status: AgentAgendaStatus,
): void {
  const expected =
    kind === AgentAgendaRecordKinds.Goal || kind === AgentAgendaRecordKinds.Schedule
      ? AgentAgendaEventKinds.Declared
      : kind === AgentAgendaRecordKinds.Activity
        ? AgentAgendaEventKinds.Started
        : AgentAgendaEventKinds.Occurred;
  if (eventKind !== expected) {
    throw new Error(`Initial ${kind} agenda record must use ${expected}, received ${eventKind}.`);
  }
  const allowedStatuses: readonly AgentAgendaStatus[] =
    kind === AgentAgendaRecordKinds.Goal
      ? [AgentAgendaStatuses.Planned, AgentAgendaStatuses.Active]
      : kind === AgentAgendaRecordKinds.Schedule
        ? [AgentAgendaStatuses.Planned]
        : kind === AgentAgendaRecordKinds.Activity
          ? [AgentAgendaStatuses.Active]
          : [AgentAgendaStatuses.Recorded];
  if (!allowedStatuses.includes(status)) {
    throw new Error(`Initial ${kind} agenda record cannot use ${status} status.`);
  }
}

function normalizeTimeZone(value: string): string {
  const timeZone = requireText(value, "Agenda world time zone");
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new RangeError(`Unsupported agenda time zone: ${timeZone}`);
  }
}

function normalizeInstant(value: string, label: string): string {
  try {
    return Temporal.Instant.from(requireText(value, label)).toString();
  } catch {
    throw new Error(`${label} must use an ISO timestamp with an explicit offset.`);
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}

function requireTextValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return requireText(value, label);
}

function assertActorRole(value: unknown): asserts value is AgentAgendaActorRole {
  if (!Object.values(AgentAgendaActorRoles).includes(value as AgentAgendaActorRole)) {
    throw new Error(`Unsupported agenda actor role: ${String(value)}`);
  }
}

function assertRecordKind(value: unknown): asserts value is AgentAgendaRecordKind {
  if (!Object.values(AgentAgendaRecordKinds).includes(value as AgentAgendaRecordKind)) {
    throw new Error(`Unsupported agenda record kind: ${String(value)}`);
  }
}

function assertStatus(value: unknown): asserts value is AgentAgendaStatus {
  if (!Object.values(AgentAgendaStatuses).includes(value as AgentAgendaStatus)) {
    throw new Error(`Unsupported agenda status: ${String(value)}`);
  }
}

function assertEventKind(value: unknown): asserts value is AgentAgendaEventKind {
  if (!Object.values(AgentAgendaEventKinds).includes(value as AgentAgendaEventKind)) {
    throw new Error(`Unsupported agenda event kind: ${String(value)}`);
  }
}

function assertAuthority(value: unknown): asserts value is AgentAgendaAuthority {
  if (!Object.values(AgentAgendaAuthorities).includes(value as AgentAgendaAuthority)) {
    throw new Error(`Unsupported agenda authority: ${String(value)}`);
  }
}
