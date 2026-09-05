import type Database from "better-sqlite3";
import { Temporal } from "@js-temporal/polyfill";
import RRulePackage from "rrule";
import type { RRule as RRuleInstance } from "rrule";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import type { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type {
  AgentWorldEntityDescriptor,
  AgentWorldEventChange,
  AgentWorldEventLedger,
} from "./AgentWorldEventLedger.js";
import type { AgentResidentStateMachine } from "./AgentResidentStateMachine.js";
import type { AgentWorldScheduleOccurrence, AgentWorldWakePlan } from "./AgentWorldTypes.js";
import { AgentAgendaActorRoles, type AgentAgendaActorRole } from "../Agenda/AgentAgendaTypes.js";

const RRule = RRulePackage.RRule as typeof RRuleInstance;

export const AgentHabitConditionOperators = ["exists", "equals", "not_equals", "gt", "gte", "lt", "lte"] as const;
export type AgentHabitConditionOperator = (typeof AgentHabitConditionOperators)[number];

export const AgentHabitDefinitionKinds = Object.freeze({
  Habit: "habit",
  Autonomy: "autonomy",
} as const);
export type AgentHabitDefinitionKind = (typeof AgentHabitDefinitionKinds)[keyof typeof AgentHabitDefinitionKinds];

export const AgentAutonomyModes = Object.freeze({
  Automatic: "automatic",
  Decision: "decision",
} as const);
export type AgentAutonomyMode = (typeof AgentAutonomyModes)[keyof typeof AgentAutonomyModes];

export const AgentHabitOccurrenceReasons = Object.freeze({
  DefinitionRevised: "habit_definition_revised",
  Disabled: "habit_disabled",
  Removed: "habit_removed",
  ConditionUnmet: "condition_unmet",
  AutonomyDecisionSkipped: "autonomy_decision_skipped",
} as const);

interface AgentWorldRoutineEventDescriptor {
  readonly occurrenceUriPrefix: string;
  readonly eventType: string;
  readonly idempotencyPrefix: string;
  readonly stateIdempotencyPrefix: string;
}

const AgentWorldRoutineEventDescriptors: Readonly<Record<AgentHabitDefinitionKind, AgentWorldRoutineEventDescriptor>> =
  Object.freeze({
    [AgentHabitDefinitionKinds.Habit]: {
      occurrenceUriPrefix: "world-habit-occurrence",
      eventType: "habit.occurred",
      idempotencyPrefix: "world-habit",
      stateIdempotencyPrefix: "world-habit-state",
    },
    [AgentHabitDefinitionKinds.Autonomy]: {
      occurrenceUriPrefix: "world-autonomy-occurrence",
      eventType: "autonomy.occurred",
      idempotencyPrefix: "world-autonomy",
      stateIdempotencyPrefix: "world-autonomy-state",
    },
  });

export interface AgentHabitCondition {
  readonly subjectId: string;
  readonly attribute: string;
  readonly operator: AgentHabitConditionOperator;
  readonly value?: string | number | boolean | null;
}

export interface AgentHabitDefinition {
  readonly id: string;
  readonly kind?: AgentHabitDefinitionKind;
  readonly autonomyMode?: AgentAutonomyMode;
  readonly actor: AgentWorldEntityDescriptor;
  readonly summary: string;
  /** RFC 5545 recurrence body without DTSTART or TZID; those have dedicated authoritative fields. */
  readonly rrule: string;
  readonly startsAt: string;
  readonly timeZone: string;
  readonly occurrenceWindowSeconds: number;
  readonly excludedLocalDates: readonly string[];
  readonly priority: number;
  readonly conditions: readonly AgentHabitCondition[];
  readonly effects: readonly AgentWorldEventChange[];
  readonly stateTransition?: {
    readonly machineId: string;
    readonly event: string;
  };
  readonly sourceRefs: readonly string[];
}

export interface AgentHabitConditionReader {
  read(subjectId: string, attribute: string, at: Temporal.Instant): unknown;
}

export interface AgentHabitAdvanceResult {
  readonly appliedEventUris: readonly string[];
  readonly pendingOccurrences: number;
  readonly nextWakeInstants: readonly Temporal.Instant[];
}

export interface AgentHabitOccurrenceCandidate {
  readonly definition: AgentHabitDefinition;
  readonly occurrenceAt: Temporal.Instant;
  readonly eligibleUntil: Temporal.Instant;
}

export interface AgentHabitOccurrencePage {
  readonly candidates: readonly AgentHabitOccurrenceCandidate[];
  readonly hasMore: boolean;
}

export interface AgentHabitOccurrenceResult {
  readonly outcome: "pending" | "applied" | "skipped";
  readonly eventUri?: string;
}

interface HabitDefinitionRow {
  readonly definition_json: string;
  readonly source_refs_json: string;
  readonly definition_revision: string;
}

interface HabitOccurrenceRow {
  readonly habit_id: string;
  readonly occurrence_at: string;
  readonly eligible_until: string;
  readonly outcome: "pending" | "applied" | "skipped";
  readonly event_uri: string | null;
}

interface LatestHabitOccurrenceRow {
  readonly occurrence_at: string | null;
}

/** RFC 5545 scheduler whose effects enter the world exclusively through the event ledger. */
export class AgentHabitScheduler {
  private readonly db: Database.Database;

  constructor(
    database: AgentSqliteDatabaseKernel | Database.Database,
    private readonly ledger: AgentWorldEventLedger,
    private readonly conditions: AgentHabitConditionReader,
    private readonly residentStates: AgentResidentStateMachine,
  ) {
    this.db = "connection" in database ? database.connection : database;
  }

  register(worldId: string, definition: AgentHabitDefinition, now = Temporal.Now.instant()): void {
    const world = this.ledger.snapshot(definition.timeZone).world;
    if (world.id !== requireText(worldId, "Habit world id")) {
      throw new Error(`Habit does not belong to the active world: ${worldId}`);
    }
    const normalized = validateDefinition(definition);
    const revision = habitDefinitionRevision(normalized);
    const sourceRefs = normalizeSourceRefs(normalized.sourceRefs);
    const write = this.db.transaction(() => {
      const previous = this.db
        .prepare<[string, string], Pick<HabitDefinitionRow, "definition_revision">>(
          `SELECT definition_revision
             FROM agent_world_habits
            WHERE world_id = ? AND habit_id = ?`,
        )
        .get(world.id, normalized.id);
      if (previous && previous.definition_revision !== revision) {
        this.db
          .prepare(
            `UPDATE agent_world_habit_occurrences
                SET outcome = 'skipped', reason = ?, recorded_at = ?
              WHERE world_id = ? AND habit_id = ? AND outcome = 'pending'`,
          )
          .run(AgentHabitOccurrenceReasons.DefinitionRevised, now.toString(), world.id, normalized.id);
      }
      this.db
        .prepare(
          `INSERT INTO agent_world_habits
            (world_id, habit_id, definition_json, definition_revision, source_refs_json, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(world_id, habit_id) DO UPDATE SET
             definition_json = excluded.definition_json,
             definition_revision = excluded.definition_revision,
             source_refs_json = excluded.source_refs_json,
             enabled = 1,
             updated_at = excluded.updated_at`,
        )
        .run(
          world.id,
          normalized.id,
          JSON.stringify(normalized),
          revision,
          JSON.stringify(sourceRefs),
          now.toString(),
          now.toString(),
        );
    });
    write();
  }

  disable(worldId: string, habitId: string, now = Temporal.Now.instant()): void {
    const normalizedWorldId = requireText(worldId, "Habit world id");
    const normalizedHabitId = requireText(habitId, "Habit id");
    const disable = this.db.transaction(() => {
      const result = this.db
        .prepare("UPDATE agent_world_habits SET enabled = 0, updated_at = ? WHERE world_id = ? AND habit_id = ?")
        .run(now.toString(), normalizedWorldId, normalizedHabitId);
      this.db
        .prepare(
          `UPDATE agent_world_habit_occurrences
              SET outcome = 'skipped', reason = ?, recorded_at = ?
            WHERE world_id = ? AND habit_id = ? AND outcome = 'pending'`,
        )
        .run(AgentHabitOccurrenceReasons.Disabled, now.toString(), normalizedWorldId, normalizedHabitId);
      return result;
    });
    const result = disable();
    if (result.changes !== 1) throw new Error(`Habit does not exist: ${habitId}`);
  }

  unregister(worldId: string, habitId: string, now = Temporal.Now.instant()): void {
    const normalizedWorldId = requireText(worldId, "Habit world id");
    const normalizedHabitId = requireText(habitId, "Habit id");
    const remove = this.db.transaction(() => {
      const result = this.db
        .prepare("UPDATE agent_world_habits SET enabled = 0, updated_at = ? WHERE world_id = ? AND habit_id = ?")
        .run(now.toString(), normalizedWorldId, normalizedHabitId);
      this.db
        .prepare(
          `UPDATE agent_world_habit_occurrences
              SET outcome = 'skipped', reason = ?, recorded_at = ?
            WHERE world_id = ? AND habit_id = ? AND outcome = 'pending'`,
        )
        .run(AgentHabitOccurrenceReasons.Removed, now.toString(), normalizedWorldId, normalizedHabitId);
      return result;
    });
    const result = remove();
    if (result.changes !== 1) throw new Error(`Habit does not exist: ${habitId}`);
  }

  list(worldId: string): AgentHabitDefinition[] {
    return this.db
      .prepare<[string], HabitDefinitionRow>(
        `SELECT definition_json, source_refs_json, definition_revision
           FROM agent_world_habits
          WHERE world_id = ? AND enabled = 1
          ORDER BY habit_id`,
      )
      .all(requireText(worldId, "Habit world id"))
      .map((row) => {
        const definition = validateDefinition(parseJsonText(row.definition_json, "World habit definition"));
        const persistedRefs = normalizeSourceRefs(parseJsonText(row.source_refs_json, "World habit source references"));
        if (JSON.stringify(definition.sourceRefs) !== JSON.stringify(persistedRefs)) {
          throw new Error(`Habit ${definition.id} source references diverged from its persisted envelope.`);
        }
        if (habitDefinitionRevision(definition) !== row.definition_revision) {
          throw new Error(`Habit ${definition.id} definition revision is invalid.`);
        }
        return definition;
      });
  }

  upcoming(
    worldId: string,
    after: Temporal.Instant,
    definitionKind?: AgentHabitDefinitionKind,
  ): AgentWorldScheduleOccurrence[] {
    const definitions = this.list(worldId).filter((definition) => matchesDefinitionKind(definition, definitionKind));
    const byId = new Map(definitions.map((definition) => [definition.id, definition] as const));
    const pending = this.listPending(worldId).flatMap((occurrence) => {
      const definition = byId.get(occurrence.habit_id);
      return definition ? [projectHabitSchedule(definition, occurrence.occurrence_at)] : [];
    });
    const future = definitions.flatMap((definition) => {
      const at = nextOccurrence(definition, after);
      return at ? [projectHabitSchedule(definition, at.toString())] : [];
    });
    return [
      ...new Map(
        [...pending, ...future].map((schedule) => [`${schedule.scheduleId}:${schedule.at}`, schedule]),
      ).values(),
    ].sort((left, right) => left.at.localeCompare(right.at) || left.scheduleId.localeCompare(right.scheduleId));
  }

  advance(input: {
    readonly worldId: string;
    readonly from: Temporal.Instant;
    readonly to: Temporal.Instant;
    readonly maximumOccurrences: number;
    readonly definitionKind?: AgentHabitDefinitionKind;
  }): AgentHabitAdvanceResult {
    const definitionKind = input.definitionKind ?? AgentHabitDefinitionKinds.Habit;
    const candidates = this.listCandidates({ ...input, definitionKind });
    const appliedEventUris: string[] = [];
    const nextWakeInstants: Temporal.Instant[] = [];
    for (const candidate of candidates) {
      const result = this.applyCandidate({
        worldId: input.worldId,
        definitionId: candidate.definition.id,
        occurrenceAt: candidate.occurrenceAt,
        evaluatedAt: input.to,
      });
      if (result.eventUri) appliedEventUris.push(result.eventUri);
      if (result.outcome === "pending") nextWakeInstants.push(candidate.eligibleUntil);
    }
    for (const definition of this.list(input.worldId).filter((candidate) =>
      matchesDefinitionKind(candidate, definitionKind),
    )) {
      const next = nextOccurrence(definition, input.to);
      if (next) nextWakeInstants.push(next);
    }
    return {
      appliedEventUris,
      pendingOccurrences: this.pendingCount(input.worldId, definitionKind),
      nextWakeInstants: uniqueInstants(nextWakeInstants).filter(
        (instant) => Temporal.Instant.compare(instant, input.to) > 0,
      ),
    };
  }

  listCandidates(input: {
    readonly worldId: string;
    readonly from: Temporal.Instant;
    readonly to: Temporal.Instant;
    readonly maximumOccurrences: number;
    readonly definitionKind: AgentHabitDefinitionKind;
  }): AgentHabitOccurrenceCandidate[] {
    if (Temporal.Instant.compare(input.to, input.from) < 0) {
      throw new Error("Habit scheduler cannot advance backwards.");
    }
    if (!Number.isSafeInteger(input.maximumOccurrences) || input.maximumOccurrences < 1) {
      throw new Error("Habit scheduler maximum occurrences must be a positive safe integer.");
    }
    const definitions = this.list(input.worldId)
      .filter((definition) => matchesDefinitionKind(definition, input.definitionKind))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    const byId = new Map(definitions.map((definition) => [definition.id, definition] as const));
    const pending = this.listPending(input.worldId).flatMap((row) => {
      const definition = byId.get(row.habit_id);
      return definition
        ? [
            {
              definition,
              occurrenceAt: Temporal.Instant.from(row.occurrence_at),
              eligibleUntil: Temporal.Instant.from(row.eligible_until),
            },
          ]
        : [];
    });
    const pendingKeys = new Set(
      pending.map((candidate) => occurrenceKey(candidate.definition.id, candidate.occurrenceAt)),
    );
    const due = definitions.flatMap((definition) =>
      recurrenceOccurrences(definition, input.from, input.to)
        .filter((occurrenceAt) => {
          const key = occurrenceKey(definition.id, occurrenceAt);
          return !pendingKeys.has(key) && !this.findOccurrence(input.worldId, definition.id, occurrenceAt.toString());
        })
        .map((occurrenceAt) => ({
          definition,
          occurrenceAt,
          eligibleUntil: occurrenceAt.add({ seconds: definition.occurrenceWindowSeconds }),
        })),
    );
    const candidates = [...pending, ...due].sort(
      (left, right) =>
        Temporal.Instant.compare(left.occurrenceAt, right.occurrenceAt) ||
        right.definition.priority - left.definition.priority ||
        left.definition.id.localeCompare(right.definition.id),
    );
    if (candidates.length > input.maximumOccurrences) {
      throw new Error(
        `Habit catch-up requires ${candidates.length} occurrences, exceeding the configured limit ${input.maximumOccurrences}.`,
      );
    }
    return candidates;
  }

  /**
   * Finds occurrences that have not been evaluated yet, independent of the
   * caller's in-memory clock cursor. This is the recovery path used by
   * background world participants after a restart or a long offline period.
   */
  listUnprocessedCandidates(input: {
    readonly worldId: string;
    readonly to: Temporal.Instant;
    readonly maximumOccurrences: number;
    readonly definitionKind: AgentHabitDefinitionKind;
  }): AgentHabitOccurrenceCandidate[] {
    const page = this.listUnprocessedCandidatePage(input);
    if (page.hasMore) {
      throw new Error(
        `Habit recovery requires more than the configured limit ${input.maximumOccurrences} occurrences.`,
      );
    }
    return [...page.candidates];
  }

  /**
   * Reads a bounded recovery page without treating the page size as an
   * execution budget. Callers can leave the remaining candidates durable and
   * request another wake after the shared arbiter's retry point.
   */
  listUnprocessedCandidatePage(input: {
    readonly worldId: string;
    readonly to: Temporal.Instant;
    readonly maximumOccurrences: number;
    readonly definitionKind: AgentHabitDefinitionKind;
  }): AgentHabitOccurrencePage {
    if (!Number.isSafeInteger(input.maximumOccurrences) || input.maximumOccurrences < 1) {
      throw new Error("Habit scheduler maximum occurrences must be a positive safe integer.");
    }
    const definitions = this.list(input.worldId)
      .filter((definition) => matchesDefinitionKind(definition, input.definitionKind))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    const byId = new Map(definitions.map((definition) => [definition.id, definition] as const));
    const pendingRows = this.listPending(input.worldId).filter((row) => byId.has(row.habit_id));
    const pending = pendingRows.slice(0, input.maximumOccurrences + 1).flatMap((row) => {
      const definition = byId.get(row.habit_id);
      return definition
        ? [
            {
              definition,
              occurrenceAt: Temporal.Instant.from(row.occurrence_at),
              eligibleUntil: Temporal.Instant.from(row.eligible_until),
            },
          ]
        : [];
    });
    const pendingKeys = new Set(
      pending.map((candidate) => occurrenceKey(candidate.definition.id, candidate.occurrenceAt)),
    );
    const due = definitions.flatMap((definition) => {
      const latest = this.latestOccurrenceAt(input.worldId, definition.id);
      const from = latest
        ? Temporal.Instant.from(latest)
        : Temporal.Instant.from(definition.startsAt).subtract({ nanoseconds: 1 });
      return recurrenceOccurrences(definition, from, input.to, input.maximumOccurrences + 1)
        .filter((occurrenceAt) => {
          const key = occurrenceKey(definition.id, occurrenceAt);
          return !pendingKeys.has(key) && !this.findOccurrence(input.worldId, definition.id, occurrenceAt.toString());
        })
        .map((occurrenceAt) => ({
          definition,
          occurrenceAt,
          eligibleUntil: occurrenceAt.add({ seconds: definition.occurrenceWindowSeconds }),
        }));
    });
    const candidates = [...pending, ...due].sort(
      (left, right) =>
        Temporal.Instant.compare(left.occurrenceAt, right.occurrenceAt) ||
        right.definition.priority - left.definition.priority ||
        left.definition.id.localeCompare(right.definition.id),
    );
    return {
      candidates: candidates.slice(0, input.maximumOccurrences),
      hasMore: pendingRows.length > input.maximumOccurrences || candidates.length > input.maximumOccurrences,
    };
  }

  /** Returns whether work is due now and the future points that need evaluation. */
  evaluationWakePlan(
    worldId: string,
    after: Temporal.Instant,
    definitionKind: AgentHabitDefinitionKind,
  ): AgentWorldWakePlan {
    const definitions = this.list(worldId).filter((definition) => matchesDefinitionKind(definition, definitionKind));
    const byId = new Map(definitions.map((definition) => [definition.id, definition] as const));
    const wakes: Temporal.Instant[] = [];
    let due = false;
    for (const row of this.listPending(worldId)) {
      const definition = byId.get(row.habit_id);
      if (!definition) continue;
      const occurrenceAt = Temporal.Instant.from(row.occurrence_at);
      const eligibleUntil = Temporal.Instant.from(row.eligible_until);
      if (Temporal.Instant.compare(occurrenceAt, after) > 0) {
        wakes.push(occurrenceAt);
      } else if (
        Temporal.Instant.compare(eligibleUntil, after) <= 0 ||
        conditionsMatch(definition.conditions, this.conditions, after)
      ) {
        due = true;
      } else {
        wakes.push(eligibleUntil);
      }
    }
    for (const definition of definitions) {
      const latest = this.latestOccurrenceAt(worldId, definition.id);
      const from = latest
        ? Temporal.Instant.from(latest)
        : Temporal.Instant.from(definition.startsAt).subtract({ nanoseconds: 1 });
      const next = nextOccurrence(definition, from);
      if (!next) continue;
      if (Temporal.Instant.compare(next, after) > 0) {
        wakes.push(next);
      } else {
        due = true;
      }
    }
    return { due, instants: uniqueInstants(wakes) };
  }

  applyCandidate(input: {
    readonly worldId: string;
    readonly definitionId: string;
    readonly occurrenceAt: Temporal.Instant;
    readonly evaluatedAt: Temporal.Instant;
  }): AgentHabitOccurrenceResult {
    const definition = this.list(input.worldId).find((candidate) => candidate.id === input.definitionId);
    if (!definition) throw new Error(`Habit does not exist: ${input.definitionId}`);
    const existing = this.findOccurrence(input.worldId, definition.id, input.occurrenceAt.toString());
    if (existing && existing.outcome !== "pending") {
      return {
        outcome: existing.outcome,
        ...(existing.event_uri ? { eventUri: existing.event_uri } : {}),
      };
    }
    const eventUri = this.evaluateOccurrence(input.worldId, definition, input.occurrenceAt, input.evaluatedAt);
    const persisted = this.findOccurrence(input.worldId, definition.id, input.occurrenceAt.toString());
    if (!persisted) throw new Error(`Habit occurrence was not persisted: ${definition.id}`);
    return {
      outcome: persisted.outcome,
      ...(eventUri ? { eventUri } : persisted.event_uri ? { eventUri: persisted.event_uri } : {}),
    };
  }

  skipCandidate(input: {
    readonly worldId: string;
    readonly definitionId: string;
    readonly occurrenceAt: Temporal.Instant;
    readonly evaluatedAt: Temporal.Instant;
    readonly reason: string;
  }): AgentHabitOccurrenceResult {
    const definition = this.list(input.worldId).find((candidate) => candidate.id === input.definitionId);
    if (!definition) throw new Error(`Habit does not exist: ${input.definitionId}`);
    const occurrenceAt = Temporal.Instant.from(input.occurrenceAt);
    const existing = this.findOccurrence(input.worldId, definition.id, occurrenceAt.toString());
    if (existing && existing.outcome !== "pending") {
      return {
        outcome: existing.outcome,
        ...(existing.event_uri ? { eventUri: existing.event_uri } : {}),
      };
    }
    const reason = requireText(input.reason, "Habit occurrence skip reason");
    this.recordOccurrence(
      input.worldId,
      definition.id,
      occurrenceAt,
      occurrenceAt.add({ seconds: definition.occurrenceWindowSeconds }),
      "skipped",
      undefined,
      reason,
      Temporal.Instant.from(input.evaluatedAt),
    );
    const persisted = this.findOccurrence(input.worldId, definition.id, occurrenceAt.toString());
    if (!persisted || persisted.outcome !== "skipped") {
      throw new Error(`Habit occurrence skip was not persisted: ${definition.id}`);
    }
    return { outcome: persisted.outcome };
  }

  private evaluateOccurrence(
    worldId: string,
    definition: AgentHabitDefinition,
    occurrenceAt: Temporal.Instant,
    evaluatedAt: Temporal.Instant,
  ): string | undefined {
    const eligibleUntil = occurrenceAt.add({ seconds: definition.occurrenceWindowSeconds });
    const unmet = definition.conditions.find((condition) => !conditionMatches(condition, this.conditions, evaluatedAt));
    if (unmet && Temporal.Instant.compare(evaluatedAt, eligibleUntil) < 0) {
      this.recordOccurrence(
        worldId,
        definition.id,
        occurrenceAt,
        eligibleUntil,
        "pending",
        undefined,
        undefined,
        evaluatedAt,
      );
      return undefined;
    }
    if (unmet) {
      this.recordOccurrence(
        worldId,
        definition.id,
        occurrenceAt,
        eligibleUntil,
        "skipped",
        undefined,
        `${AgentHabitOccurrenceReasons.ConditionUnmet}:${unmet.subjectId}:${unmet.attribute}`,
        evaluatedAt,
      );
      return undefined;
    }
    const eventDescriptor = routineEventDescriptor(definition);
    const occurrenceUri = `senera://${eventDescriptor.occurrenceUriPrefix}/${encodeURIComponent(definition.id)}/${encodeURIComponent(occurrenceAt.toString())}`;
    const timeUri = `senera://world-time/${encodeURIComponent(occurrenceAt.toString())}`;
    const apply = this.db.transaction(() => {
      const event = this.ledger.append({
        worldId,
        timeZone: definition.timeZone,
        subject: { id: occurrenceUri, kind: "event" },
        type: eventDescriptor.eventType,
        summary: definition.summary,
        changes: [
          { kind: "entity_upsert", entity: definition.actor },
          {
            kind: "entity_upsert",
            entity: {
              id: occurrenceUri,
              kind: "event",
              label: definition.summary,
              parentId: definition.actor.id,
              attributes: { habitId: definition.id, scheduledAt: occurrenceAt.toString() },
            },
          },
          {
            kind: "entity_upsert",
            entity: {
              id: timeUri,
              kind: "time",
              label: occurrenceAt.toZonedDateTimeISO(definition.timeZone).toString(),
              parentId: null,
              attributes: { instant: occurrenceAt.toString(), timeZone: definition.timeZone },
            },
          },
          {
            kind: "relation_assert",
            subject: { id: definition.actor.id, kind: definition.actor.kind },
            relationId: "participates_in",
            object: { id: occurrenceUri, kind: "event" },
          },
          {
            kind: "relation_assert",
            subject: { id: occurrenceUri, kind: "event" },
            relationId: "scheduled_for",
            object: { id: timeUri, kind: "time" },
          },
          ...definition.effects,
        ],
        evidenceRefs: [...definition.sourceRefs, occurrenceUri],
        occurredAt: occurrenceAt.toString(),
        recordedAt: evaluatedAt.toString(),
        idempotencyKey: `${eventDescriptor.idempotencyPrefix}:${worldId}:${definition.id}:${occurrenceAt.toString()}`,
      });
      if (definition.stateTransition) {
        this.residentStates.transition({
          worldId,
          timeZone: definition.timeZone,
          actor: definition.actor,
          machineId: definition.stateTransition.machineId,
          event: definition.stateTransition.event,
          evidenceRefs: [...definition.sourceRefs, event.uri],
          occurredAt: occurrenceAt.toString(),
          recordedAt: evaluatedAt.toString(),
          idempotencyKey: `${eventDescriptor.stateIdempotencyPrefix}:${worldId}:${definition.id}:${occurrenceAt.toString()}`,
        });
      }
      this.recordOccurrence(
        worldId,
        definition.id,
        occurrenceAt,
        eligibleUntil,
        "applied",
        event.uri,
        undefined,
        evaluatedAt,
      );
      return event.uri;
    });
    return apply();
  }

  private recordOccurrence(
    worldId: string,
    habitId: string,
    occurrenceAt: Temporal.Instant,
    eligibleUntil: Temporal.Instant,
    outcome: HabitOccurrenceRow["outcome"],
    eventUri: string | undefined,
    reason: string | undefined,
    recordedAt: Temporal.Instant,
  ): void {
    this.db
      .prepare(
        `INSERT INTO agent_world_habit_occurrences
          (world_id, habit_id, occurrence_at, eligible_until, outcome, event_uri, reason, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(world_id, habit_id, occurrence_at) DO UPDATE SET
           eligible_until = excluded.eligible_until,
           outcome = excluded.outcome,
           event_uri = excluded.event_uri,
           reason = excluded.reason,
           recorded_at = excluded.recorded_at`,
      )
      .run(
        worldId,
        habitId,
        occurrenceAt.toString(),
        eligibleUntil.toString(),
        outcome,
        eventUri ?? null,
        reason ?? null,
        recordedAt.toString(),
      );
  }

  private listPending(worldId: string): HabitOccurrenceRow[] {
    return this.db
      .prepare<[string], HabitOccurrenceRow>(
        `SELECT habit_id, occurrence_at, eligible_until, outcome, event_uri
           FROM agent_world_habit_occurrences
          WHERE world_id = ? AND outcome = 'pending'
          ORDER BY occurrence_at, habit_id`,
      )
      .all(worldId);
  }

  private pendingCount(worldId: string, definitionKind: AgentHabitDefinitionKind): number {
    const definitions = new Set(
      this.list(worldId)
        .filter((definition) => matchesDefinitionKind(definition, definitionKind))
        .map((definition) => definition.id),
    );
    return this.listPending(worldId).filter((occurrence) => definitions.has(occurrence.habit_id)).length;
  }

  private latestOccurrenceAt(worldId: string, habitId: string): string | undefined {
    const row = this.db
      .prepare<[string, string], LatestHabitOccurrenceRow>(
        `SELECT MAX(occurrence_at) AS occurrence_at
           FROM agent_world_habit_occurrences
          WHERE world_id = ? AND habit_id = ?`,
      )
      .get(worldId, habitId);
    return row?.occurrence_at ?? undefined;
  }

  private findOccurrence(worldId: string, habitId: string, occurrenceAt: string): HabitOccurrenceRow | undefined {
    return this.db
      .prepare<[string, string, string], HabitOccurrenceRow>(
        `SELECT habit_id, occurrence_at, eligible_until, outcome, event_uri
           FROM agent_world_habit_occurrences
          WHERE world_id = ? AND habit_id = ? AND occurrence_at = ?`,
      )
      .get(worldId, habitId, occurrenceAt);
  }
}

function habitDefinitionRevision(definition: AgentHabitDefinition): string {
  const { sourceRefs: _sourceRefs, ...semanticDefinition } = definition;
  return sha256HexOfCanonicalJson(semanticDefinition);
}

function projectHabitSchedule(definition: AgentHabitDefinition, at: string): AgentWorldScheduleOccurrence {
  const actorRole = definition.actor.attributes.role;
  if (
    typeof actorRole !== "string" ||
    !Object.values(AgentAgendaActorRoles).includes(actorRole as AgentAgendaActorRole)
  ) {
    throw new Error(`Habit ${definition.id} actor must declare a role attribute.`);
  }
  return {
    scheduleId: definition.id,
    label: definition.summary,
    at,
    actorId: definition.actor.id,
    actorRole: actorRole as AgentAgendaActorRole,
    kind: "habit",
    source: "habit",
  };
}

function routineEventDescriptor(definition: AgentHabitDefinition): AgentWorldRoutineEventDescriptor {
  const kind = definition.kind ?? AgentHabitDefinitionKinds.Habit;
  return AgentWorldRoutineEventDescriptors[kind];
}

function validateDefinition(value: unknown): AgentHabitDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Habit definition must be an object.");
  const definition = value as AgentHabitDefinition;
  const id = requireText(definition.id, "Habit id");
  const kind = definition.kind ?? AgentHabitDefinitionKinds.Habit;
  if (!Object.values(AgentHabitDefinitionKinds).includes(kind)) {
    throw new Error(`Habit ${id} has an unsupported definition kind: ${String(kind)}`);
  }
  const autonomyMode = definition.autonomyMode;
  if (autonomyMode !== undefined && !Object.values(AgentAutonomyModes).includes(autonomyMode)) {
    throw new Error(`Habit ${id} has an unsupported autonomy mode: ${String(autonomyMode)}`);
  }
  if (kind === AgentHabitDefinitionKinds.Autonomy && autonomyMode === undefined) {
    throw new Error(`Autonomy definition ${id} must declare an autonomy mode.`);
  }
  if (kind === AgentHabitDefinitionKinds.Habit && autonomyMode !== undefined) {
    throw new Error(`Habit ${id} cannot declare an autonomy mode.`);
  }
  const summary = requireText(definition.summary, "Habit summary");
  const rrule = requireText(definition.rrule, "Habit RRULE");
  if (/\b(?:DTSTART|TZID)\b/iu.test(rrule)) {
    throw new Error(`Habit ${id} RRULE must not repeat DTSTART or TZID fields.`);
  }
  const startsAt = Temporal.Instant.from(requireText(definition.startsAt, "Habit start time")).toString();
  const timeZone = normalizeTimeZone(definition.timeZone);
  const occurrenceWindowSeconds = requireNonNegativeInteger(
    definition.occurrenceWindowSeconds,
    "Habit occurrence window",
  );
  const priority = requireSafeInteger(definition.priority, "Habit priority");
  if (!Array.isArray(definition.excludedLocalDates)) throw new Error(`Habit ${id} excluded dates must be an array.`);
  if (!Array.isArray(definition.conditions)) throw new Error(`Habit ${id} conditions must be an array.`);
  const excludedLocalDates = uniqueStrings(
    definition.excludedLocalDates.map((date) => Temporal.PlainDate.from(date).toString()),
  );
  const conditions = definition.conditions.map(validateCondition);
  if (!Array.isArray(definition.effects)) throw new Error(`Habit ${id} effects must be an array.`);
  if (definition.effects.some((effect) => effect.kind === "state_transition" || effect.kind === "clock_advance")) {
    throw new Error(`Habit ${id} must use its registered stateTransition instead of raw runtime changes.`);
  }
  const stateTransition = definition.stateTransition
    ? {
        machineId: requireText(definition.stateTransition.machineId, `Habit ${id} state machine id`),
        event: requireText(definition.stateTransition.event, `Habit ${id} state machine event`),
      }
    : undefined;
  const sourceRefs = normalizeSourceRefs(definition.sourceRefs);
  const normalized = {
    ...definition,
    id,
    ...(kind !== AgentHabitDefinitionKinds.Habit ? { kind } : {}),
    ...(autonomyMode !== undefined ? { autonomyMode } : {}),
    summary,
    rrule,
    startsAt,
    timeZone,
    occurrenceWindowSeconds,
    excludedLocalDates,
    priority,
    conditions,
    effects: [...definition.effects],
    ...(stateTransition ? { stateTransition } : {}),
    sourceRefs,
  };
  recurrence(normalized);
  return normalized;
}

function validateCondition(condition: AgentHabitCondition): AgentHabitCondition {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    throw new Error("Habit condition must be an object.");
  }
  if (!AgentHabitConditionOperators.includes(condition.operator)) {
    throw new Error(`Unknown habit condition operator: ${String(condition.operator)}`);
  }
  if (condition.operator !== "exists" && condition.value === undefined) {
    throw new Error(`Habit condition ${condition.subjectId}:${condition.attribute} requires a comparison value.`);
  }
  return {
    subjectId: requireText(condition.subjectId, "Habit condition subject id"),
    attribute: requireText(condition.attribute, "Habit condition attribute"),
    operator: condition.operator,
    ...(condition.value !== undefined ? { value: condition.value } : {}),
  };
}

function recurrenceOccurrences(
  definition: AgentHabitDefinition,
  from: Temporal.Instant,
  to: Temporal.Instant,
  maximum?: number,
): Temporal.Instant[] {
  const occurrences: Temporal.Instant[] = [];
  const limit = maximum === undefined ? Number.MAX_SAFE_INTEGER : maximum;
  const timezone = definition.timeZone;
  recurrence(definition).between(toFloatingDate(from, timezone), toFloatingDate(to, timezone), false, (date) => {
    const instant = floatingDateToInstant(date, timezone);
    if (!isExcluded(definition, instant)) occurrences.push(instant);
    return occurrences.length < limit;
  });
  return occurrences;
}

function nextOccurrence(definition: AgentHabitDefinition, after: Temporal.Instant): Temporal.Instant | undefined {
  let cursor = recurrence(definition).after(toFloatingDate(after, definition.timeZone), false);
  while (cursor) {
    const instant = floatingDateToInstant(cursor, definition.timeZone);
    if (!isExcluded(definition, instant)) return instant;
    cursor = recurrence(definition).after(cursor, false);
  }
  return undefined;
}

function recurrence(definition: AgentHabitDefinition): RRuleInstance {
  const options = RRule.parseString(definition.rrule);
  const localStart = Temporal.Instant.from(definition.startsAt).toZonedDateTimeISO(definition.timeZone);
  return new RRule({
    ...options,
    // RRule's TZID implementation interprets Date fields in the host
    // timezone. Keep the rule floating and convert its wall-clock values
    // through Temporal so the scheduler is independent of the OS timezone.
    dtstart: toFloatingDate(localStart.toInstant(), definition.timeZone),
  });
}

function toFloatingDate(instant: Temporal.Instant, timeZone: string): Date {
  const local = instant.toZonedDateTimeISO(timeZone);
  const plain = local.toPlainDateTime();
  return new Date(
    Date.UTC(
      plain.year,
      plain.month - 1,
      plain.day,
      plain.hour,
      plain.minute,
      plain.second,
      Math.trunc(plain.millisecond),
    ),
  );
}

function floatingDateToInstant(value: Date, timeZone: string): Temporal.Instant {
  const utc = Temporal.Instant.fromEpochMilliseconds(value.getTime()).toZonedDateTimeISO("UTC");
  return utc.toPlainDateTime().toZonedDateTime(timeZone).toInstant();
}

function isExcluded(definition: AgentHabitDefinition, instant: Temporal.Instant): boolean {
  const localDate = instant.toZonedDateTimeISO(definition.timeZone).toPlainDate().toString();
  return definition.excludedLocalDates.includes(localDate);
}

function conditionMatches(
  condition: AgentHabitCondition,
  reader: AgentHabitConditionReader,
  at: Temporal.Instant,
): boolean {
  const actual = reader.read(condition.subjectId, condition.attribute, at);
  switch (condition.operator) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "equals":
      return actual === condition.value;
    case "not_equals":
      return actual !== condition.value;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof condition.value !== "number") return false;
      if (condition.operator === "gt") return actual > condition.value;
      if (condition.operator === "gte") return actual >= condition.value;
      if (condition.operator === "lt") return actual < condition.value;
      return actual <= condition.value;
    }
  }
}

function conditionsMatch(
  conditions: readonly AgentHabitCondition[],
  reader: AgentHabitConditionReader,
  at: Temporal.Instant,
): boolean {
  return conditions.every((condition) => conditionMatches(condition, reader, at));
}

function normalizeSourceRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Habit source references must be a string array.");
  }
  const refs = uniqueStrings(value).sort();
  if (refs.length === 0) throw new Error("Habit requires at least one source reference.");
  return refs;
}

function normalizeTimeZone(value: string): string {
  const timeZone = requireText(value, "Habit time zone");
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch (error) {
    throw new Error(`Unsupported habit time zone: ${timeZone}`, { cause: error });
  }
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function requireSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
  return value;
}

function requireNonNegativeInteger(value: number, label: string): number {
  const normalized = requireSafeInteger(value, label);
  if (normalized < 0) throw new Error(`${label} must not be negative.`);
  return normalized;
}

function uniqueInstants(values: readonly Temporal.Instant[]): Temporal.Instant[] {
  return [...new Map(values.map((value) => [value.toString(), value] as const)).values()].sort(
    Temporal.Instant.compare,
  );
}

function matchesDefinitionKind(
  definition: AgentHabitDefinition,
  requestedKind: AgentHabitDefinitionKind | undefined,
): boolean {
  return requestedKind === undefined || (definition.kind ?? AgentHabitDefinitionKinds.Habit) === requestedKind;
}

function occurrenceKey(definitionId: string, occurrenceAt: Temporal.Instant): string {
  return `${definitionId}\u0000${occurrenceAt.toString()}`;
}
