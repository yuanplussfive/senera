import type Database from "better-sqlite3";
import { Temporal } from "@js-temporal/polyfill";
import { createActor, createMachine } from "xstate";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import type { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { AgentWorldAttributes } from "./AgentWorldTypes.js";
import type { AgentWorldEntityDescriptor, AgentWorldEvent, AgentWorldEventLedger } from "./AgentWorldEventLedger.js";

export interface AgentResidentStateDefinition {
  readonly label: string;
  readonly on: Readonly<Record<string, string>>;
  readonly attributes?: AgentWorldAttributes;
}

export interface AgentResidentStateMachineDefinition {
  readonly id: string;
  readonly projection: {
    readonly attribute: string;
  };
  readonly initial: string;
  readonly states: Readonly<Record<string, AgentResidentStateDefinition>>;
}

export interface AgentResidentStateTransitionInput {
  readonly worldId: string;
  readonly timeZone: string;
  readonly actor: AgentWorldEntityDescriptor;
  readonly machineId: string;
  readonly event: string;
  readonly evidenceRefs: readonly string[];
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly idempotencyKey: string;
}

export interface AgentResidentStateTransitionResult {
  readonly from: string;
  readonly to: string;
  readonly eventUri: string;
}

interface MachineDefinitionRow {
  readonly definition_json: string;
  readonly definition_revision: string;
  readonly source_refs_json: string;
}

interface MachineSnapshotRow {
  readonly definition_revision: string;
  readonly history_revision: string;
  readonly through_sequence: number;
  readonly snapshot_json: string;
}

interface StateMachineEpoch {
  readonly initialization: AgentWorldEvent | undefined;
  readonly transitions: readonly AgentWorldEvent[];
}

/** Runs registered XState definitions while retaining the event ledger as the sole state authority. */
export class AgentResidentStateMachine {
  private readonly db: Database.Database;

  constructor(
    database: AgentSqliteDatabaseKernel | Database.Database,
    private readonly ledger: AgentWorldEventLedger,
  ) {
    this.db = "connection" in database ? database.connection : database;
  }

  register(input: {
    readonly worldId: string;
    readonly timeZone: string;
    readonly actor: AgentWorldEntityDescriptor;
    readonly definition: AgentResidentStateMachineDefinition;
    readonly sourceRefs: readonly string[];
    readonly now?: Temporal.Instant;
  }): void {
    const world = this.ledger.snapshot(input.timeZone).world;
    if (world.id !== requireText(input.worldId, "State machine world id")) {
      throw new Error(`State machine does not belong to the active world: ${input.worldId}`);
    }
    const definition = validateDefinition(input.definition);
    if (input.actor.kind !== "person") {
      throw new Error(`Resident state machine ${definition.id} actor must be a person.`);
    }
    const revision = sha256HexOfCanonicalJson(definition);
    const sourceRefs = normalizeSourceRefs(input.sourceRefs);
    const now = input.now ?? Temporal.Now.instant();
    const persist = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO agent_world_machine_definitions
          (world_id, machine_id, definition_json, definition_revision, source_refs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(world_id, machine_id) DO UPDATE SET
           definition_json = excluded.definition_json,
           definition_revision = excluded.definition_revision,
           source_refs_json = excluded.source_refs_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          world.id,
          definition.id,
          JSON.stringify(definition),
          revision,
          JSON.stringify(sourceRefs),
          now.toString(),
          now.toString(),
        );
      const initialState = definition.states[definition.initial]!;
      this.ledger.append({
        worldId: world.id,
        timeZone: input.timeZone,
        subject: { id: input.actor.id, kind: input.actor.kind },
        type: "resident.state_initialized",
        summary: `${input.actor.label}: ${initialState.label}`,
        changes: [
          {
            kind: "state_machine_initialized",
            actorId: input.actor.id,
            machineId: definition.id,
            definitionRevision: revision,
            initialState: definition.initial,
          },
          { kind: "entity_upsert", entity: input.actor },
          {
            kind: "entity_patch",
            entityId: input.actor.id,
            attributes: {
              ...initialState.attributes,
              [definition.projection.attribute]: initialState.label,
            },
          },
        ],
        evidenceRefs: sourceRefs,
        occurredAt: now.toString(),
        recordedAt: now.toString(),
        idempotencyKey: `resident-state-initialized:${world.id}:${input.actor.id}:${definition.id}:${revision}`,
      });
    });
    persist();
  }

  unregister(worldId: string, machineId: string): void {
    const normalizedWorldId = requireText(worldId, "State machine world id");
    const normalizedMachineId = requireText(machineId, "State machine id");
    const remove = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM agent_world_machine_snapshots WHERE world_id = ? AND machine_id = ?")
        .run(normalizedWorldId, normalizedMachineId);
      return this.db
        .prepare("DELETE FROM agent_world_machine_definitions WHERE world_id = ? AND machine_id = ?")
        .run(normalizedWorldId, normalizedMachineId);
    });
    const result = remove();
    if (result.changes !== 1) throw new Error(`Resident state machine is not registered: ${machineId}`);
  }

  transition(input: AgentResidentStateTransitionInput): AgentResidentStateTransitionResult {
    const existing = this.ledger.eventByIdempotencyKey(input.idempotencyKey);
    if (existing) return projectExistingTransition(existing, input.machineId, input.actor.id);
    const registered = this.readDefinition(input.worldId, input.machineId);
    const definition = registered.definition;
    const machine = createMachine({
      id: definition.id,
      initial: definition.initial,
      states: Object.fromEntries(
        Object.entries(definition.states).map(([stateId, state]) => [
          stateId,
          { on: Object.fromEntries(Object.entries(state.on).map(([event, target]) => [event, { target }])) },
        ]),
      ),
    });
    const worldEvents = this.ledger.snapshot(input.timeZone).events.filter((event) => event.source === "world");
    const epoch = selectCurrentEpoch(worldEvents, input.actor.id, definition.id, registered.revision);
    const history = epoch.transitions;
    const cached = this.readSnapshot(input.worldId, input.actor.id, definition.id);
    const cacheMatches =
      cached?.definitionRevision === registered.revision &&
      cached.historyRevision === stateHistoryRevision(epoch.initialization, history);
    const actor = cacheMatches ? createActor(machine, { snapshot: cached.snapshot as never }) : createActor(machine);
    actor.start();
    try {
      if (!cacheMatches) replayTransitions(actor, history, input.actor.id, definition.id);
      const from = String(actor.getSnapshot().value);
      const configuredTarget = definition.states[from]?.on[input.event];
      if (!configuredTarget) {
        throw new Error(`State machine ${definition.id} does not accept ${input.event} from ${from}.`);
      }
      actor.send({ type: input.event });
      const to = String(actor.getSnapshot().value);
      if (to !== configuredTarget) {
        throw new Error(
          `State machine ${definition.id} projected ${to}, expected configured target ${configuredTarget}.`,
        );
      }
      const targetAttributes = definition.states[to]?.attributes ?? {};
      const targetLabel = definition.states[to]!.label;
      const fromLabel = definition.states[from]!.label;
      const recorded = this.ledger.append({
        worldId: input.worldId,
        timeZone: input.timeZone,
        subject: { id: input.actor.id, kind: input.actor.kind },
        type: "resident.state_transition",
        summary: `${input.actor.label}: ${fromLabel} -> ${targetLabel}`,
        changes: [
          { kind: "entity_upsert", entity: input.actor },
          {
            kind: "state_transition",
            actorId: input.actor.id,
            machineId: definition.id,
            event: input.event,
            from,
            to,
          },
          {
            kind: "entity_patch" as const,
            entityId: input.actor.id,
            attributes: { ...targetAttributes, [definition.projection.attribute]: targetLabel },
          },
        ],
        evidenceRefs: normalizeSourceRefs(input.evidenceRefs),
        occurredAt: input.occurredAt,
        recordedAt: input.recordedAt,
        idempotencyKey: input.idempotencyKey,
      });
      const nextHistory = [...history, recorded].sort(compareEvents);
      const throughSequence = Math.max(
        epoch.initialization?.sequence ?? 0,
        ...nextHistory.map((event) => event.sequence),
      );
      this.writeSnapshot(
        input.worldId,
        input.actor.id,
        definition.id,
        registered.revision,
        stateHistoryRevision(epoch.initialization, nextHistory),
        throughSequence,
        actor.getPersistedSnapshot(),
        recorded.recordedAt,
      );
      return { from, to, eventUri: recorded.uri };
    } finally {
      actor.stop();
    }
  }

  private readDefinition(
    worldId: string,
    machineId: string,
  ): { readonly definition: AgentResidentStateMachineDefinition; readonly revision: string } {
    const row = this.db
      .prepare<[string, string], MachineDefinitionRow>(
        `SELECT definition_json, definition_revision, source_refs_json
           FROM agent_world_machine_definitions
          WHERE world_id = ? AND machine_id = ?`,
      )
      .get(requireText(worldId, "State machine world id"), requireText(machineId, "State machine id"));
    if (!row) throw new Error(`Resident state machine is not registered: ${machineId}`);
    const definition = validateDefinition(parseJsonText(row.definition_json, `State machine ${machineId} definition`));
    const revision = sha256HexOfCanonicalJson(definition);
    if (revision !== row.definition_revision) throw new Error(`State machine ${machineId} revision is invalid.`);
    normalizeSourceRefs(parseJsonText(row.source_refs_json, `State machine ${machineId} source references`));
    return { definition, revision };
  }

  private readSnapshot(
    worldId: string,
    actorId: string,
    machineId: string,
  ):
    | {
        readonly definitionRevision: string;
        readonly historyRevision: string;
        readonly throughSequence: number;
        readonly snapshot: unknown;
      }
    | undefined {
    const row = this.db
      .prepare<[string, string, string], MachineSnapshotRow>(
        `SELECT definition_revision, history_revision, through_sequence, snapshot_json FROM agent_world_machine_snapshots
          WHERE world_id = ? AND actor_id = ? AND machine_id = ?`,
      )
      .get(worldId, actorId, machineId);
    return row
      ? {
          definitionRevision: row.definition_revision,
          historyRevision: row.history_revision,
          throughSequence: row.through_sequence,
          snapshot: parseJsonText(row.snapshot_json, `World state machine ${machineId} snapshot`),
        }
      : undefined;
  }

  private writeSnapshot(
    worldId: string,
    actorId: string,
    machineId: string,
    definitionRevision: string,
    historyRevision: string,
    throughSequence: number,
    snapshot: unknown,
    updatedAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO agent_world_machine_snapshots
          (world_id, actor_id, machine_id, definition_revision, history_revision, through_sequence, snapshot_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(world_id, actor_id, machine_id) DO UPDATE SET
           definition_revision = excluded.definition_revision,
           history_revision = excluded.history_revision,
           through_sequence = excluded.through_sequence,
           snapshot_json = excluded.snapshot_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        worldId,
        actorId,
        machineId,
        definitionRevision,
        historyRevision,
        throughSequence,
        JSON.stringify(snapshot),
        updatedAt,
      );
  }
}

function selectCurrentEpoch(
  events: readonly AgentWorldEvent[],
  actorId: string,
  machineId: string,
  definitionRevision: string,
): StateMachineEpoch {
  const initializations = events
    .filter((event) =>
      event.changes.some(
        (change) =>
          change.kind === "state_machine_initialized" &&
          change.actorId === actorId &&
          change.machineId === machineId &&
          change.definitionRevision === definitionRevision,
      ),
    )
    .sort(compareEvents);
  const initialization = initializations[initializations.length - 1];
  if (!initialization) return { initialization: undefined, transitions: [] };
  return {
    initialization,
    transitions: events
      .filter(
        (event) =>
          event.sequence > initialization.sequence &&
          event.changes.some(
            (change) =>
              change.kind === "state_transition" && change.actorId === actorId && change.machineId === machineId,
          ),
      )
      .sort(compareEvents),
  };
}

function replayTransitions(
  actor: { send(event: { readonly type: string }): void; getSnapshot(): { readonly value: unknown } },
  history: readonly AgentWorldEvent[],
  actorId: string,
  machineId: string,
): void {
  for (const event of history) {
    const transition = event.changes.find(
      (change) => change.kind === "state_transition" && change.actorId === actorId && change.machineId === machineId,
    );
    if (transition?.kind !== "state_transition") continue;
    const current = String(actor.getSnapshot().value);
    if (current !== transition.from) {
      throw new Error(
        `State machine ${machineId} history expected ${transition.from} before ${transition.event}, received ${current}.`,
      );
    }
    actor.send({ type: transition.event });
    const next = String(actor.getSnapshot().value);
    if (next !== transition.to) {
      throw new Error(
        `State machine ${machineId} history projected ${next} for ${transition.event}, expected ${transition.to}.`,
      );
    }
  }
}

function stateHistoryRevision(
  initialization: AgentWorldEvent | undefined,
  history: readonly AgentWorldEvent[],
): string {
  return sha256HexOfCanonicalJson({
    initialization: initialization ? { uri: initialization.uri, sequence: initialization.sequence } : null,
    transitions: history.map((event) => ({
      uri: event.uri,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      changes: event.changes.filter((change) => change.kind === "state_transition"),
    })),
  });
}

function compareEvents(left: AgentWorldEvent, right: AgentWorldEvent): number {
  return (
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.recordedAt.localeCompare(right.recordedAt) ||
    left.sequence - right.sequence
  );
}

function projectExistingTransition(
  event: AgentWorldEvent,
  machineId: string,
  actorId: string,
): AgentResidentStateTransitionResult {
  const transition = event.changes.find(
    (change) => change.kind === "state_transition" && change.machineId === machineId && change.actorId === actorId,
  );
  if (transition?.kind !== "state_transition") {
    throw new Error(`World event idempotency key is not bound to state machine ${machineId}.`);
  }
  return { from: transition.from, to: transition.to, eventUri: event.uri };
}

function validateDefinition(value: unknown): AgentResidentStateMachineDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Resident state machine definition must be an object.");
  }
  const definition = value as AgentResidentStateMachineDefinition;
  const id = requireText(definition.id, "Resident state machine id");
  const projectionAttribute = requireText(
    definition.projection?.attribute,
    `Resident state machine ${id} projection attribute`,
  );
  const initial = requireText(definition.initial, `Resident state machine ${id} initial state`);
  if (!definition.states || typeof definition.states !== "object" || Array.isArray(definition.states)) {
    throw new Error(`Resident state machine ${id} states must be a record.`);
  }
  const stateIds = Object.keys(definition.states);
  if (!stateIds.includes(initial))
    throw new Error(`Resident state machine ${id} initial state does not exist: ${initial}.`);
  for (const [stateId, state] of Object.entries(definition.states)) {
    requireText(stateId, `Resident state machine ${id} state id`);
    if (!state || typeof state !== "object" || Array.isArray(state) || !state.on) {
      throw new Error(`Resident state machine ${id}/${stateId} must define an event map.`);
    }
    requireText(state.label, `Resident state machine ${id}/${stateId} label`);
    for (const [event, target] of Object.entries(state.on)) {
      requireText(event, `Resident state machine ${id}/${stateId} event id`);
      if (!stateIds.includes(target)) {
        throw new Error(`Resident state machine ${id}/${stateId} targets an unknown state: ${target}.`);
      }
    }
  }
  return {
    id,
    projection: { attribute: projectionAttribute },
    initial,
    states: Object.fromEntries(
      Object.entries(definition.states).map(([stateId, state]) => [
        stateId,
        {
          label: state.label.trim(),
          on: Object.fromEntries(Object.entries(state.on).map(([event, target]) => [event.trim(), target.trim()])),
          ...(state.attributes ? { attributes: { ...state.attributes } } : {}),
        },
      ]),
    ),
  };
}

function normalizeSourceRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("State machine evidence references must be a string array.");
  }
  const refs = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
  if (refs.length === 0) throw new Error("State machine transition requires at least one evidence reference.");
  return refs;
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}
