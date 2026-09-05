import type Database from "better-sqlite3";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { isMissingFileError } from "../Core/AgentFs.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import type { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import {
  AgentContinuityEntityKinds,
  type AgentContinuityEntityKind,
} from "../Continuity/AgentContinuityRelationCatalog.js";
import type { ResolvedAgentWorldConfig } from "../Types/AgentRuntimeConfigTypes.js";
import { AgentAutonomyModes } from "./AgentHabitScheduler.js";
import type { AgentHabitCondition, AgentHabitScheduler } from "./AgentHabitScheduler.js";
import { AgentWorldAutonomyRuntime } from "./AgentWorldAutonomyRuntime.js";
import type { AgentResidentStateMachine, AgentResidentStateMachineDefinition } from "./AgentResidentStateMachine.js";
import type {
  AgentWorldEntityDescriptor,
  AgentWorldEventChange,
  AgentWorldEventLedger,
  AgentWorldEventSubject,
} from "./AgentWorldEventLedger.js";
import type { AgentWorldAttributes } from "./AgentWorldTypes.js";

export const AgentWorldPackageSchemaVersion = "senera.world/v2" as const;

const NonEmptyText = z.string().trim().min(1);
const EntityKindSchema = z.enum(AgentContinuityEntityKinds);
const ScalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const AttributesSchema = z.record(NonEmptyText, z.json());
const SubjectSchema = z
  .object({
    id: NonEmptyText,
    kind: EntityKindSchema,
  })
  .strict();
const EntitySchema = SubjectSchema.extend({
  label: NonEmptyText,
  parentId: NonEmptyText.nullable(),
  attributes: AttributesSchema,
}).strict();
const RelationSchema = z
  .object({
    subject: SubjectSchema,
    relationId: NonEmptyText,
    object: SubjectSchema,
    validFrom: NonEmptyText.optional(),
    validUntil: NonEmptyText.optional(),
  })
  .strict();
const HabitEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entity_upsert"), entity: EntitySchema }).strict(),
  z
    .object({
      kind: z.literal("entity_patch"),
      entityId: NonEmptyText,
      label: NonEmptyText.optional(),
      parentId: NonEmptyText.nullable().optional(),
      attributes: AttributesSchema,
    })
    .strict(),
  z.object({ kind: z.literal("entity_retire"), entityId: NonEmptyText }).strict(),
  z
    .object({
      kind: z.literal("relation_assert"),
      subject: SubjectSchema,
      relationId: NonEmptyText,
      object: SubjectSchema,
      validFrom: NonEmptyText.optional(),
      validUntil: NonEmptyText.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relation_retract"),
      subjectId: NonEmptyText,
      relationId: NonEmptyText,
      objectId: NonEmptyText,
    })
    .strict(),
]);
const HabitConditionSchema = z
  .object({
    subjectId: NonEmptyText,
    attribute: NonEmptyText,
    operator: z.enum(["exists", "equals", "not_equals", "gt", "gte", "lt", "lte"]),
    value: ScalarSchema.optional(),
  })
  .strict();
const StateMachineDefinitionSchema = z
  .object({
    id: NonEmptyText,
    actorId: NonEmptyText,
    projection: z.object({ attribute: NonEmptyText }).strict(),
    initial: NonEmptyText,
    states: z.record(
      NonEmptyText,
      z
        .object({
          label: NonEmptyText,
          on: z.record(NonEmptyText, NonEmptyText),
          attributes: AttributesSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();
const HabitSchema = z
  .object({
    id: NonEmptyText,
    actorId: NonEmptyText,
    summary: NonEmptyText,
    rrule: NonEmptyText,
    startsAt: NonEmptyText,
    occurrenceWindowSeconds: z.number().int().nonnegative(),
    excludedLocalDates: z.array(NonEmptyText).default([]),
    priority: z.number().int(),
    conditions: z.array(HabitConditionSchema).default([]),
    effects: z.array(HabitEffectSchema).default([]),
    stateTransition: z
      .object({
        machineId: NonEmptyText,
        event: NonEmptyText,
      })
      .strict()
      .optional(),
  })
  .strict();
const AutonomySchema = HabitSchema.extend({
  mode: z.enum([AgentAutonomyModes.Automatic, AgentAutonomyModes.Decision]),
}).strict();

export const AgentWorldPackageSchema = z
  .object({
    schemaVersion: z.literal(AgentWorldPackageSchemaVersion),
    id: NonEmptyText,
    title: NonEmptyText,
    entities: z.array(EntitySchema).default([]),
    relations: z.array(RelationSchema).default([]),
    stateMachines: z.array(StateMachineDefinitionSchema).default([]),
    habits: z.array(HabitSchema).default([]),
    autonomy: z.array(AutonomySchema).default([]),
  })
  .strict();

export interface AgentWorldPackageLoadResult {
  readonly rootDir: string;
  readonly packages: readonly AgentWorldPackageLoadItem[];
}

export interface AgentWorldPackageCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly entityCount: number;
  readonly relationCount: number;
  readonly stateMachineCount: number;
  readonly habitCount: number;
  readonly autonomyCount: number;
}

export interface AgentWorldPackageLoadItem {
  readonly id: string;
  readonly title: string;
  readonly revision: string;
  readonly sourceUri: string;
  readonly eventUri: string;
  readonly entityIds: readonly string[];
  readonly relationIds: readonly string[];
  readonly stateMachineIds: readonly string[];
  readonly habitIds: readonly string[];
  readonly autonomyIds: readonly string[];
}

type ParsedAgentWorldPackage = z.infer<typeof AgentWorldPackageSchema>;

interface AgentWorldPackageRegistryRow {
  readonly package_id: string;
  readonly definition_json: string;
  readonly definition_revision: string;
  readonly source_uri: string;
  readonly applied_event_uri: string;
  readonly applied_at: string;
}

interface RegisteredAgentWorldPackage {
  readonly document: ParsedAgentWorldPackage;
  readonly revision: string;
  readonly sourceUri: string;
  readonly eventUri: string;
}

/**
 * Loads declarative world packages as audited world events. Packages define
 * entities, relations, state-machine definitions, and RFC 5545 habits; the
 * runtime never invents a resident's life when this directory is empty.
 */
export class AgentWorldPackageLoader {
  private readonly db: Database.Database;

  constructor(
    private readonly options: {
      readonly workspaceRoot: string;
      readonly rootDir: string;
      readonly database: AgentSqliteDatabaseKernel | Database.Database;
      readonly agenda: AgentAgendaService;
      readonly ledger: AgentWorldEventLedger;
      readonly residentStates: AgentResidentStateMachine;
      readonly habits: AgentHabitScheduler;
      readonly autonomy: AgentWorldAutonomyRuntime;
      readonly config: () => ResolvedAgentWorldConfig;
      readonly now?: () => Temporal.Instant;
    },
  ) {
    this.db = "connection" in options.database ? options.database.connection : options.database;
  }

  async catalog(): Promise<readonly AgentWorldPackageCatalogItem[]> {
    const packages = await this.readPackages(this.resolveRootDir());
    assertUnique(packages, (entry) => entry.id, "world package id");
    for (const packageDocument of packages) validatePackageDocument(packageDocument);
    return packages.map((packageDocument) => ({
      id: packageDocument.id,
      title: packageDocument.title,
      entityCount: packageDocument.entities.length,
      relationCount: packageDocument.relations.length,
      stateMachineCount: packageDocument.stateMachines.length,
      habitCount: packageDocument.habits.length,
      autonomyCount: packageDocument.autonomy.length,
    }));
  }

  async synchronize(packageIds: readonly string[]): Promise<AgentWorldPackageLoadResult> {
    assertUnique(packageIds, (id) => id, "selected world package id");
    const rootDir = this.resolveRootDir();
    const available = await this.readPackages(rootDir);
    assertUnique(available, (entry) => entry.id, "world package id");
    const availableById = new Map(available.map((packageDocument) => [packageDocument.id, packageDocument] as const));
    const selected = packageIds.map((id) => {
      const packageDocument = availableById.get(id);
      if (!packageDocument) throw new Error(`Selected world package does not exist: ${id}`);
      return packageDocument;
    });
    validatePackageSet(selected);
    return this.synchronizePackages(rootDir, selected);
  }

  private synchronizePackages(
    rootDir: string,
    packages: readonly ParsedAgentWorldPackage[],
  ): AgentWorldPackageLoadResult {
    const stateMachineIds = packages.flatMap((packageDocument) =>
      packageDocument.stateMachines.map((definition) => definition.id),
    );
    const config = this.options.config();
    const now = this.options.now?.() ?? Temporal.Now.instant();
    const world = this.options.agenda.snapshot(config.TimeZone, new Date(now.epochMilliseconds)).world;
    const registered = this.readRegisteredPackages(world.id);
    const selectedPackages = packages.map((document) => ({
      document,
      revision: worldPackageRevision(document),
    }));
    const synchronize = this.db.transaction(() => {
      const currentById = new Map(selectedPackages.map(({ document }) => [document.id, document] as const));
      const changedPackages = selectedPackages.filter(({ document, revision }) => {
        const previous = registered.get(document.id);
        return previous?.revision !== revision;
      });
      const desiredMachineIds = new Set(stateMachineIds);
      const desiredHabitIds = new Set(
        packages.flatMap((packageDocument) => packageDocument.habits.map((habit) => habit.id)),
      );
      const desiredAutonomyIds = new Set(
        packages.flatMap((packageDocument) => packageDocument.autonomy.map((routine) => routine.id)),
      );

      for (const previous of registered.values()) {
        if (!currentById.has(previous.document.id)) this.removePackage(previous, world.id, config, now);
        for (const habit of previous.document.habits) {
          if (!desiredHabitIds.has(habit.id)) this.options.habits.unregister(world.id, habit.id, now);
        }
        for (const routine of previous.document.autonomy) {
          if (!desiredAutonomyIds.has(routine.id)) this.options.autonomy.unregister(world.id, routine.id, now);
        }
        for (const definition of previous.document.stateMachines) {
          if (!desiredMachineIds.has(definition.id)) this.options.residentStates.unregister(world.id, definition.id);
        }
      }

      const items = selectedPackages.map(({ document: packageDocument, revision }) => {
        const previous = registered.get(packageDocument.id);
        return previous?.revision === revision
          ? toLoadItem(packageDocument, previous.revision, previous.sourceUri, previous.eventUri)
          : this.applyPackage(packageDocument, revision, previous, world.id, config, now);
      });

      for (const { document: packageDocument, revision } of changedPackages) {
        const sourceUri = worldPackageRevisionUri(packageDocument.id, revision);
        this.registerStateMachines(packageDocument, world.id, config, sourceUri, now);
      }
      for (const { document: packageDocument, revision } of changedPackages) {
        const sourceUri = worldPackageRevisionUri(packageDocument.id, revision);
        this.registerHabits(packageDocument, world.id, config, sourceUri, now);
      }
      for (const { document: packageDocument, revision } of changedPackages) {
        const sourceUri = worldPackageRevisionUri(packageDocument.id, revision);
        this.registerAutonomy(packageDocument, world.id, config, sourceUri, now);
      }
      return items;
    });
    return { rootDir, packages: synchronize() };
  }

  private async readPackages(rootDir: string): Promise<ParsedAgentWorldPackage[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
    const fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".json"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    return Promise.all(fileNames.map((fileName) => this.readPackage(path.join(rootDir, fileName), fileName)));
  }

  private async readPackage(filePath: string, displayName: string): Promise<ParsedAgentWorldPackage> {
    const source = await fs.readFile(filePath, "utf8");
    const parsed = AgentWorldPackageSchema.safeParse(parseJsonText(source, `World package ${displayName}`));
    if (parsed.success) return parsed.data;
    throw new Error(
      `World package ${displayName} is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  private applyPackage(
    packageDocument: ParsedAgentWorldPackage,
    revision: string,
    previous: RegisteredAgentWorldPackage | undefined,
    worldId: string,
    config: ResolvedAgentWorldConfig,
    now: Temporal.Instant,
  ): AgentWorldPackageLoadItem {
    const packageEntityId = worldPackageEntityId(packageDocument.id);
    const sourceUri = worldPackageRevisionUri(packageDocument.id, revision);
    const entitiesById = new Map(packageDocument.entities.map((entity) => [entity.id, toEntity(entity)] as const));
    if (entitiesById.has(packageEntityId)) {
      throw new Error(`World package ${packageDocument.id} uses the reserved package entity id.`);
    }
    const currentEntityIds = new Set(entitiesById.keys());
    const previousEntitiesById = new Map(previous?.document.entities.map((entity) => [entity.id, entity] as const));
    const changedEntities = packageDocument.entities.filter((entity) => {
      const prior = previousEntitiesById.get(entity.id);
      return !prior || sha256HexOfCanonicalJson(prior) !== sha256HexOfCanonicalJson(entity);
    });
    const previousRelationKeys = new Set(previous?.document.relations.map(relationDefinitionKey));
    const currentRelationKeys = new Set(packageDocument.relations.map(relationDefinitionKey));
    const event = this.options.ledger.append({
      worldId,
      timeZone: config.TimeZone,
      subject: { id: packageEntityId, kind: "artifact" },
      type: previous ? "world.package_revised" : "world.package_applied",
      summary: packageDocument.title,
      changes: [
        ...(previous?.document.relations
          .filter((relation) => !currentRelationKeys.has(relationDefinitionKey(relation)))
          .map((relation) => ({
            kind: "relation_retract" as const,
            subjectId: relation.subject.id,
            relationId: relation.relationId,
            objectId: relation.object.id,
          })) ?? []),
        ...(previous?.document.entities
          .filter((entity) => !currentEntityIds.has(entity.id))
          .map((entity) => ({ kind: "entity_retire" as const, entityId: entity.id })) ?? []),
        {
          kind: "entity_replace",
          entity: {
            id: packageEntityId,
            kind: "artifact",
            label: packageDocument.title,
            parentId: null,
            attributes: { packageId: packageDocument.id, revision },
          },
        },
        ...changedEntities.map((entity) => ({ kind: "entity_replace" as const, entity: toEntity(entity) })),
        ...packageDocument.relations
          .filter((relation) => !previousRelationKeys.has(relationDefinitionKey(relation)))
          .map((relation) => ({
            kind: "relation_assert" as const,
            subject: toSubject(relation.subject),
            relationId: relation.relationId,
            object: toSubject(relation.object),
            ...(relation.validFrom ? { validFrom: relation.validFrom } : {}),
            ...(relation.validUntil ? { validUntil: relation.validUntil } : {}),
          })),
      ],
      evidenceRefs: previous ? [previous.sourceUri, sourceUri] : [sourceUri],
      occurredAt: now.toString(),
      recordedAt: now.toString(),
      idempotencyKey: `world-package:${worldId}:${packageDocument.id}:${revision}`,
    });
    this.db
      .prepare(
        `INSERT INTO agent_world_packages
          (world_id, package_id, definition_json, definition_revision, source_uri, applied_event_uri, applied_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(world_id, package_id) DO UPDATE SET
           definition_json = excluded.definition_json,
           definition_revision = excluded.definition_revision,
           source_uri = excluded.source_uri,
           applied_event_uri = excluded.applied_event_uri,
           applied_at = excluded.applied_at`,
      )
      .run(
        worldId,
        packageDocument.id,
        JSON.stringify(packageDocument),
        revision,
        sourceUri,
        event.uri,
        now.toString(),
      );
    return toLoadItem(packageDocument, revision, sourceUri, event.uri);
  }

  private removePackage(
    previous: RegisteredAgentWorldPackage,
    worldId: string,
    config: ResolvedAgentWorldConfig,
    now: Temporal.Instant,
  ): void {
    const packageEntityId = worldPackageEntityId(previous.document.id);
    this.options.ledger.append({
      worldId,
      timeZone: config.TimeZone,
      subject: { id: packageEntityId, kind: "artifact" },
      type: "world.package_removed",
      summary: previous.document.title,
      changes: [
        ...previous.document.relations.map((relation) => ({
          kind: "relation_retract" as const,
          subjectId: relation.subject.id,
          relationId: relation.relationId,
          objectId: relation.object.id,
        })),
        ...previous.document.entities.map((entity) => ({ kind: "entity_retire" as const, entityId: entity.id })),
        { kind: "entity_retire", entityId: packageEntityId },
      ],
      evidenceRefs: [previous.sourceUri],
      occurredAt: now.toString(),
      recordedAt: now.toString(),
      idempotencyKey: `world-package-removed:${worldId}:${previous.document.id}:${previous.revision}`,
    });
    this.db
      .prepare("DELETE FROM agent_world_packages WHERE world_id = ? AND package_id = ?")
      .run(worldId, previous.document.id);
  }

  private registerStateMachines(
    packageDocument: ParsedAgentWorldPackage,
    worldId: string,
    config: ResolvedAgentWorldConfig,
    sourceUri: string,
    now: Temporal.Instant,
  ): void {
    const entitiesById = new Map(packageDocument.entities.map((entity) => [entity.id, toEntity(entity)] as const));
    for (const definition of packageDocument.stateMachines) {
      const actor = entitiesById.get(definition.actorId);
      if (!actor) {
        throw new Error(
          `World package state machine ${definition.id} references an unknown actor: ${definition.actorId}`,
        );
      }
      this.options.residentStates.register({
        worldId,
        timeZone: config.TimeZone,
        actor,
        definition: toStateMachineDefinition(definition),
        sourceRefs: [sourceUri],
        now,
      });
    }
  }

  private registerHabits(
    packageDocument: ParsedAgentWorldPackage,
    worldId: string,
    config: ResolvedAgentWorldConfig,
    sourceUri: string,
    now: Temporal.Instant,
  ): void {
    const entitiesById = new Map(packageDocument.entities.map((entity) => [entity.id, toEntity(entity)] as const));
    for (const habit of packageDocument.habits) {
      const actor = entitiesById.get(habit.actorId);
      if (!actor) throw new Error(`World package habit ${habit.id} references an unknown actor: ${habit.actorId}`);
      this.options.habits.register(
        worldId,
        {
          id: habit.id,
          actor,
          summary: habit.summary,
          rrule: habit.rrule,
          startsAt: habit.startsAt,
          timeZone: config.TimeZone,
          occurrenceWindowSeconds: habit.occurrenceWindowSeconds,
          excludedLocalDates: habit.excludedLocalDates,
          priority: habit.priority,
          conditions: habit.conditions.map(toHabitCondition),
          effects: habit.effects.map(toHabitEffect),
          ...(habit.stateTransition ? { stateTransition: habit.stateTransition } : {}),
          sourceRefs: [sourceUri],
        },
        now,
      );
    }
  }

  private registerAutonomy(
    packageDocument: ParsedAgentWorldPackage,
    worldId: string,
    config: ResolvedAgentWorldConfig,
    sourceUri: string,
    now: Temporal.Instant,
  ): void {
    const entitiesById = new Map(packageDocument.entities.map((entity) => [entity.id, toEntity(entity)] as const));
    for (const routine of packageDocument.autonomy) {
      const actor = entitiesById.get(routine.actorId);
      if (!actor) {
        throw new Error(`World package autonomy routine ${routine.id} references an unknown actor: ${routine.actorId}`);
      }
      this.options.autonomy.register(
        worldId,
        {
          id: routine.id,
          actor,
          summary: routine.summary,
          rrule: routine.rrule,
          startsAt: routine.startsAt,
          timeZone: config.TimeZone,
          occurrenceWindowSeconds: routine.occurrenceWindowSeconds,
          excludedLocalDates: routine.excludedLocalDates,
          priority: routine.priority,
          conditions: routine.conditions.map(toHabitCondition),
          effects: routine.effects.map(toHabitEffect),
          ...(routine.stateTransition ? { stateTransition: routine.stateTransition } : {}),
          sourceRefs: [sourceUri],
          mode: routine.mode,
        },
        now,
      );
    }
  }

  private readRegisteredPackages(worldId: string): Map<string, RegisteredAgentWorldPackage> {
    const rows = this.db
      .prepare<[string], AgentWorldPackageRegistryRow>(
        `SELECT package_id, definition_json, definition_revision, source_uri, applied_event_uri, applied_at
           FROM agent_world_packages
          WHERE world_id = ?
          ORDER BY package_id`,
      )
      .all(worldId);
    return new Map(
      rows.map((row) => {
        const parsed = AgentWorldPackageSchema.safeParse(
          parseJsonText(row.definition_json, `Registered world package ${row.package_id}`),
        );
        if (!parsed.success) {
          throw new Error(
            `Registered world package ${row.package_id} is invalid: ${parsed.error.issues
              .map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`)
              .join("; ")}`,
          );
        }
        if (parsed.data.id !== row.package_id) {
          throw new Error(`Registered world package id does not match its envelope: ${row.package_id}`);
        }
        const revision = worldPackageRevision(parsed.data);
        if (revision !== row.definition_revision) {
          throw new Error(`Registered world package revision is invalid: ${row.package_id}`);
        }
        const sourceUri = worldPackageRevisionUri(row.package_id, revision);
        if (sourceUri !== row.source_uri) {
          throw new Error(`Registered world package source URI is invalid: ${row.package_id}`);
        }
        Temporal.Instant.from(row.applied_at);
        const event = this.options.ledger.eventByIdempotencyKey(
          `world-package:${worldId}:${row.package_id}:${revision}`,
        );
        if (event?.uri !== row.applied_event_uri) {
          throw new Error(`Registered world package event is missing or inconsistent: ${row.package_id}`);
        }
        return [
          row.package_id,
          {
            document: parsed.data,
            revision,
            sourceUri,
            eventUri: row.applied_event_uri,
          },
        ] as const;
      }),
    );
  }

  private resolveRootDir(): string {
    const workspaceRoot = path.resolve(this.options.workspaceRoot);
    const rootDir = path.resolve(this.options.rootDir);
    const relative = path.relative(workspaceRoot, rootDir);
    if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`World package root must be a child of the workspace: ${rootDir}`);
    }
    return rootDir;
  }
}

function validatePackageSet(packages: readonly ParsedAgentWorldPackage[]): void {
  assertUnique(packages, (entry) => entry.id, "world package id");
  assertUnique(
    packages.flatMap((packageDocument) => packageDocument.entities),
    (entity) => entity.id,
    "world package entity id",
  );
  assertUnique(
    packages.flatMap((packageDocument) => packageDocument.stateMachines),
    (definition) => definition.id,
    "world package state machine id",
  );
  assertUnique(
    packages.flatMap((packageDocument) => [...packageDocument.habits, ...packageDocument.autonomy]),
    (definition) => definition.id,
    "world package habit or autonomy id",
  );
  for (const packageDocument of packages) validatePackageDocument(packageDocument);
  const entityIds = new Set(packages.flatMap((packageDocument) => packageDocument.entities.map((entity) => entity.id)));
  for (const packageDocument of packages) {
    for (const relation of packageDocument.relations) {
      if (!entityIds.has(relation.subject.id) || !entityIds.has(relation.object.id)) {
        throw new Error(
          `World package relation ${relation.subject.id} ${relation.relationId} ${relation.object.id} must reference entities in the selected package set.`,
        );
      }
    }
    for (const definition of [...packageDocument.habits, ...packageDocument.autonomy]) {
      for (const condition of definition.conditions) {
        if (!entityIds.has(condition.subjectId)) {
          throw new Error(
            `World package routine ${definition.id} condition references an entity outside the selected package set: ${condition.subjectId}`,
          );
        }
      }
    }
  }
}

function validatePackageDocument(packageDocument: ParsedAgentWorldPackage): void {
  assertUnique(packageDocument.entities, (entity) => entity.id, `entities in world package ${packageDocument.id}`);
  assertUnique(
    packageDocument.stateMachines,
    (definition) => definition.id,
    `state machines in world package ${packageDocument.id}`,
  );
  assertUnique(
    packageDocument.stateMachines,
    (definition) => `${definition.actorId}\u0000${definition.projection.attribute}`,
    `state machine projections in world package ${packageDocument.id}`,
  );
  assertUnique(packageDocument.habits, (habit) => habit.id, `habits in world package ${packageDocument.id}`);
  assertUnique(
    packageDocument.autonomy,
    (routine) => routine.id,
    `autonomy routines in world package ${packageDocument.id}`,
  );
  assertUnique(
    [...packageDocument.habits, ...packageDocument.autonomy],
    (definition) => definition.id,
    `habit or autonomy definitions in world package ${packageDocument.id}`,
  );
  assertUnique(
    packageDocument.relations,
    (relation) => `${relation.subject.id}\u0000${relation.relationId}\u0000${relation.object.id}`,
    `relations in world package ${packageDocument.id}`,
  );
  const entityIds = new Set(packageDocument.entities.map((entity) => entity.id));
  const stateMachineIds = new Set(packageDocument.stateMachines.map((definition) => definition.id));
  for (const definition of packageDocument.stateMachines) {
    if (!entityIds.has(definition.actorId)) {
      throw new Error(
        `World package state machine ${definition.id} must reference an entity declared by the same package.`,
      );
    }
  }
  for (const habit of packageDocument.habits) {
    if (!entityIds.has(habit.actorId)) {
      throw new Error(`World package habit ${habit.id} must reference an entity declared by the same package.`);
    }
    if (habit.stateTransition && !stateMachineIds.has(habit.stateTransition.machineId)) {
      throw new Error(`World package habit ${habit.id} must reference a state machine declared by the same package.`);
    }
  }
  for (const routine of packageDocument.autonomy) {
    if (!entityIds.has(routine.actorId)) {
      throw new Error(
        `World package autonomy routine ${routine.id} must reference an entity declared by the same package.`,
      );
    }
    if (routine.stateTransition && !stateMachineIds.has(routine.stateTransition.machineId)) {
      throw new Error(
        `World package autonomy routine ${routine.id} must reference a state machine declared by the same package.`,
      );
    }
  }
}

function assertUnique<T>(values: readonly T[], identity: (value: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const id = identity(value);
    if (seen.has(id)) throw new Error(`Duplicate ${label}: ${id}`);
    seen.add(id);
  }
}

function toSubject(value: { readonly id: string; readonly kind: AgentContinuityEntityKind }): AgentWorldEventSubject {
  return { id: value.id, kind: value.kind };
}

function toEntity(value: z.infer<typeof EntitySchema>): AgentWorldEntityDescriptor {
  return {
    id: value.id,
    kind: value.kind,
    label: value.label,
    parentId: value.parentId,
    attributes: value.attributes as AgentWorldAttributes,
  };
}

function toStateMachineDefinition(
  value: z.infer<typeof StateMachineDefinitionSchema>,
): AgentResidentStateMachineDefinition {
  return {
    id: value.id,
    projection: { attribute: value.projection.attribute },
    initial: value.initial,
    states: Object.fromEntries(
      Object.entries(value.states).map(([stateId, state]) => [
        stateId,
        {
          label: state.label,
          on: { ...state.on },
          ...(state.attributes ? { attributes: state.attributes as AgentWorldAttributes } : {}),
        },
      ]),
    ),
  };
}

function toHabitCondition(value: z.infer<typeof HabitConditionSchema>): AgentHabitCondition {
  return {
    subjectId: value.subjectId,
    attribute: value.attribute,
    operator: value.operator,
    ...(value.value !== undefined ? { value: value.value } : {}),
  };
}

function toHabitEffect(value: z.infer<typeof HabitEffectSchema>): AgentWorldEventChange {
  switch (value.kind) {
    case "entity_upsert":
      return { kind: "entity_upsert", entity: toEntity(value.entity) };
    case "entity_patch":
      return {
        kind: "entity_patch",
        entityId: value.entityId,
        ...(value.label ? { label: value.label } : {}),
        ...(value.parentId !== undefined ? { parentId: value.parentId } : {}),
        attributes: value.attributes as AgentWorldAttributes,
      };
    case "entity_retire":
      return { kind: "entity_retire", entityId: value.entityId };
    case "relation_assert":
      return {
        kind: "relation_assert",
        subject: toSubject(value.subject),
        relationId: value.relationId,
        object: toSubject(value.object),
        ...(value.validFrom ? { validFrom: value.validFrom } : {}),
        ...(value.validUntil ? { validUntil: value.validUntil } : {}),
      };
    case "relation_retract":
      return {
        kind: "relation_retract",
        subjectId: value.subjectId,
        relationId: value.relationId,
        objectId: value.objectId,
      };
  }
}

function worldPackageEntityId(packageId: string): string {
  return `senera://world-package/${encodeURIComponent(packageId)}`;
}

function worldPackageRevisionUri(packageId: string, revision: string): string {
  return `${worldPackageEntityId(packageId)}/revision/${revision}`;
}

function relationDefinitionKey(relation: z.infer<typeof RelationSchema>): string {
  return sha256HexOfCanonicalJson(relation);
}

function worldPackageRevision(document: ParsedAgentWorldPackage): string {
  return sha256HexOfCanonicalJson(document);
}

function toLoadItem(
  packageDocument: ParsedAgentWorldPackage,
  revision: string,
  sourceUri: string,
  eventUri: string,
): AgentWorldPackageLoadItem {
  return {
    id: packageDocument.id,
    title: packageDocument.title,
    revision,
    sourceUri,
    eventUri,
    entityIds: packageDocument.entities.map((entity) => entity.id),
    relationIds: packageDocument.relations.map((relation) => relation.relationId),
    stateMachineIds: packageDocument.stateMachines.map((definition) => definition.id),
    habitIds: packageDocument.habits.map((habit) => habit.id),
    autonomyIds: packageDocument.autonomy.map((routine) => routine.id),
  };
}
