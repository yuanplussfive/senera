import fs from "node:fs";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import type { ResolvedAgentWorldConfig } from "../../../Source/AgentSystem/Types/AgentRuntimeConfigTypes.js";
import { AgentHabitScheduler } from "../../../Source/AgentSystem/World/AgentHabitScheduler.js";
import { AgentWorldAutonomyRuntime } from "../../../Source/AgentSystem/World/AgentWorldAutonomyRuntime.js";
import { AgentResidentStateMachine } from "../../../Source/AgentSystem/World/AgentResidentStateMachine.js";
import { AgentWorldEventLedger } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { AgentWorldMaterializer } from "../../../Source/AgentSystem/World/AgentWorldMaterializer.js";
import { AgentWorldPackageLoader } from "../../../Source/AgentSystem/World/AgentWorldPackageLoader.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const TimeZone = "Asia/Shanghai";
const InitialInstant = Temporal.Instant.from("2026-08-29T12:59:00Z");
const WorldConfig: ResolvedAgentWorldConfig = {
  Name: "Senera",
  TimeZone,
  DayPhases: [
    { Id: "night", Label: "深夜", StartsAt: "00:00", EndsAt: "06:00" },
    { Id: "day", Label: "白天", StartsAt: "06:00", EndsAt: "18:00" },
    { Id: "evening", Label: "晚上", StartsAt: "18:00", EndsAt: "00:00" },
  ],
  RecordLimit: 64,
  TimelineLimit: 64,
  HabitCatchUpLimit: 32,
};

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("world package loader", () => {
  test("applies a declarative resident package once, then drives its registered habit", async () => {
    const workspace = createTemporaryDirectory("senera-world-package");
    workspaces.add(workspace);
    const packageRoot = path.join(workspace, ".senera", "worlds");
    const packagePath = path.join(packageRoot, "night-life.json");
    let currentInstant = InitialInstant;
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(
      packagePath,
      `${JSON.stringify(
        {
          schemaVersion: "senera.world/v2",
          id: "night-life",
          title: "夜间生活",
          entities: [
            {
              id: "senera://world-person/resident",
              kind: "person",
              label: "失语症",
              parentId: null,
              attributes: { role: "resident" },
            },
            {
              id: "senera://world-person/user",
              kind: "person",
              label: "来客",
              parentId: null,
              attributes: { role: "user" },
            },
            {
              id: "senera://world-place/studio",
              kind: "place",
              label: "画室",
              parentId: null,
              attributes: {},
            },
          ],
          relations: [
            {
              subject: { id: "senera://world-person/resident", kind: "person" },
              relationId: "located_at",
              object: { id: "senera://world-place/studio", kind: "place" },
            },
            {
              subject: { id: "senera://world-person/resident", kind: "person" },
              relationId: "knows",
              object: { id: "senera://world-person/user", kind: "person" },
            },
          ],
          stateMachines: [
            {
              id: "resident_activity",
              actorId: "senera://world-person/resident",
              projection: { attribute: "activity" },
              initial: "resting",
              states: {
                resting: { label: "休息中", on: { begin_drawing: "drawing" } },
                drawing: {
                  label: "画画中",
                  on: { finish_drawing: "resting" },
                  attributes: { emotionState: "focused" },
                },
              },
            },
          ],
          habits: [
            {
              id: "nightly_drawing",
              actorId: "senera://world-person/resident",
              summary: "开始画画",
              rrule: "FREQ=DAILY;COUNT=2",
              startsAt: "2026-08-29T13:00:00Z",
              occurrenceWindowSeconds: 1800,
              excludedLocalDates: [],
              priority: 10,
              conditions: [],
              effects: [],
              stateTransition: { machineId: "resident_activity", event: "begin_drawing" },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({
        store: new AgentAgendaSqliteStore(database),
        now: () => new Date(currentInstant.epochMilliseconds),
      });
      const ledger = new AgentWorldEventLedger(database, agenda);
      const materializer = new AgentWorldMaterializer({
        ledger,
        graphSnapshot: () => ({ scope: [], entities: [], relations: [] }),
        config: () => WorldConfig,
      });
      const states = new AgentResidentStateMachine(database, ledger);
      const habits = new AgentHabitScheduler(
        database,
        ledger,
        { read: (subjectId, attribute, at) => materializer.readAttribute(subjectId, attribute, at) },
        states,
      );
      const autonomy = new AgentWorldAutonomyRuntime({ habits, config: () => WorldConfig });
      const loader = new AgentWorldPackageLoader({
        workspaceRoot: workspace,
        rootDir: packageRoot,
        database,
        agenda,
        ledger,
        residentStates: states,
        habits,
        autonomy,
        config: () => WorldConfig,
        now: () => currentInstant,
      });

      const firstLoad = await loader.synchronize(["night-life"]);
      expect(firstLoad.packages).toEqual([
        expect.objectContaining({
          id: "night-life",
          stateMachineIds: ["resident_activity"],
          habitIds: ["nightly_drawing"],
        }),
      ]);

      const world = agenda.snapshot(TimeZone, new Date(InitialInstant.epochMilliseconds)).world;
      expect(materializer.materialize(InitialInstant, []).resident.activity).toBe("休息中");
      const advancement = habits.advance({
        worldId: world.id,
        from: InitialInstant,
        to: Temporal.Instant.from("2026-08-29T13:01:00Z"),
        maximumOccurrences: 16,
      });
      expect(advancement.appliedEventUris).toHaveLength(1);
      const snapshot = materializer.materialize(
        Temporal.Instant.from("2026-08-29T13:01:00Z"),
        habits.upcoming(world.id, Temporal.Instant.from("2026-08-29T13:01:00Z")),
      );
      expect(snapshot.resident).toMatchObject({
        residentId: "senera://world-person/resident",
        location: "画室",
        activity: "画画中",
        emotionState: "focused",
        relationship: "认识",
      });

      const secondLoad = await loader.synchronize(["night-life"]);
      expect(secondLoad.packages[0]?.eventUri).toBe(firstLoad.packages[0]?.eventUri);
      expect(ledger.snapshot(TimeZone).events.filter((event) => event.type === "world.package_applied")).toHaveLength(
        1,
      );

      const revisedDocument = JSON.parse(fs.readFileSync(packagePath, "utf8")) as Record<string, unknown>;
      revisedDocument.title = "夜间生活设定";
      fs.writeFileSync(packagePath, `${JSON.stringify(revisedDocument, null, 2)}\n`, "utf8");
      currentInstant = Temporal.Instant.from("2026-08-29T13:02:00Z");
      const revisedLoad = await loader.synchronize(["night-life"]);
      expect(revisedLoad.packages[0]?.eventUri).not.toBe(firstLoad.packages[0]?.eventUri);
      expect(ledger.snapshot(TimeZone).events.filter((event) => event.type === "world.package_revised")).toHaveLength(
        1,
      );
      expect(
        materializer.materialize(currentInstant, habits.upcoming(world.id, currentInstant)).resident?.activity,
      ).toBe("画画中");

      fs.unlinkSync(packagePath);
      currentInstant = Temporal.Instant.from("2026-08-29T13:03:00Z");
      await expect(loader.synchronize([])).resolves.toEqual({ rootDir: packageRoot, packages: [] });
      expect(habits.list(world.id)).toEqual([]);
      expect(() =>
        states.transition({
          worldId: world.id,
          timeZone: TimeZone,
          actor: {
            id: "senera://world-person/resident",
            kind: "person",
            label: "失语症",
            parentId: null,
            attributes: {},
          },
          machineId: "resident_activity",
          event: "finish_drawing",
          evidenceRefs: ["senera://world-test/package-removed"],
          occurredAt: currentInstant.toString(),
          recordedAt: currentInstant.toString(),
          idempotencyKey: "world-test:transition-after-package-removal",
        }),
      ).toThrow("not registered");
      const removedSnapshot = materializer.materialize(currentInstant, []);
      expect(removedSnapshot.resident.residentId).toBeNull();
      expect(removedSnapshot.nodes.some((node) => node.id === "senera://world-person/resident")).toBe(false);
      expect(ledger.snapshot(TimeZone).events.filter((event) => event.type === "world.package_removed")).toHaveLength(
        1,
      );
      expect(await loader.synchronize([])).toEqual({ rootDir: packageRoot, packages: [] });
      expect(ledger.snapshot(TimeZone).events.filter((event) => event.type === "world.package_removed")).toHaveLength(
        1,
      );
    } finally {
      database.close();
    }
  });

  test("atomically switches explicitly selected persona packages", async () => {
    const workspace = createTemporaryDirectory("senera-world-selection");
    workspaces.add(workspace);
    const packageRoot = path.join(workspace, ".senera", "worlds");
    fs.mkdirSync(packageRoot, { recursive: true });
    const writePackage = (id: string, title: string, residentLabel: string) =>
      fs.writeFileSync(
        path.join(packageRoot, `${id}.json`),
        `${JSON.stringify({
          schemaVersion: "senera.world/v2",
          id,
          title,
          entities: [
            {
              id: "senera://world-person/resident",
              kind: "person",
              label: residentLabel,
              parentId: null,
              attributes: { role: "resident" },
            },
          ],
          relations: [],
          stateMachines: [],
          habits: [],
        })}\n`,
        "utf8",
      );
    writePackage("resident-a", "角色世界 A", "角色 A");
    writePackage("resident-b", "角色世界 B", "角色 B");

    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({
        store: new AgentAgendaSqliteStore(database),
        now: () => new Date(InitialInstant.epochMilliseconds),
      });
      const ledger = new AgentWorldEventLedger(database, agenda);
      const materializer = new AgentWorldMaterializer({
        ledger,
        graphSnapshot: () => ({ scope: [], entities: [], relations: [] }),
        config: () => WorldConfig,
      });
      const states = new AgentResidentStateMachine(database, ledger);
      const habits = new AgentHabitScheduler(
        database,
        ledger,
        { read: (subjectId, attribute, at) => materializer.readAttribute(subjectId, attribute, at) },
        states,
      );
      const autonomy = new AgentWorldAutonomyRuntime({ habits, config: () => WorldConfig });
      const loader = new AgentWorldPackageLoader({
        workspaceRoot: workspace,
        rootDir: packageRoot,
        database,
        agenda,
        ledger,
        residentStates: states,
        habits,
        autonomy,
        config: () => WorldConfig,
        now: () => InitialInstant,
      });

      await expect(loader.catalog()).resolves.toEqual([
        expect.objectContaining({ id: "resident-a", entityCount: 1 }),
        expect.objectContaining({ id: "resident-b", entityCount: 1 }),
      ]);
      await loader.synchronize(["resident-a"]);
      expect(materializer.materialize(InitialInstant, []).nodes).toContainEqual(
        expect.objectContaining({ id: "senera://world-person/resident", label: "角色 A" }),
      );

      await loader.synchronize(["resident-b"]);
      expect(materializer.materialize(InitialInstant, []).nodes).toContainEqual(
        expect.objectContaining({ id: "senera://world-person/resident", label: "角色 B" }),
      );
      await expect(loader.synchronize(["missing"])).rejects.toThrow("Selected world package does not exist");
      expect(materializer.materialize(InitialInstant, []).nodes).toContainEqual(
        expect.objectContaining({ id: "senera://world-person/resident", label: "角色 B" }),
      );
    } finally {
      database.close();
    }
  });

  test("rejects overlapping single-subject world relations but permits adjacent intervals", () => {
    const workspace = createTemporaryDirectory("senera-world-cardinality");
    workspaces.add(workspace);
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({
        store: new AgentAgendaSqliteStore(database),
        now: () => new Date("2026-08-29T00:00:00Z"),
      });
      const ledger = new AgentWorldEventLedger(database, agenda);
      const world = agenda.snapshot(TimeZone, new Date("2026-08-29T00:00:00Z")).world;
      const resident = { id: "senera://world-person/resident", kind: "person" as const };
      const firstPlace = { id: "senera://world-place/first", kind: "place" as const };
      const secondPlace = { id: "senera://world-place/second", kind: "place" as const };
      const append = (idempotencyKey: string, object: typeof firstPlace, validFrom?: string, validUntil?: string) =>
        ledger.append({
          worldId: world.id,
          timeZone: TimeZone,
          subject: resident,
          type: "world.location_changed",
          summary: "位置变化",
          changes: [
            {
              kind: "relation_assert",
              subject: resident,
              relationId: "located_at",
              object,
              ...(validFrom ? { validFrom } : {}),
              ...(validUntil ? { validUntil } : {}),
            },
          ],
          evidenceRefs: [`senera://world-test/${idempotencyKey}`],
          occurredAt: validFrom ?? "2026-08-29T00:00:00Z",
          recordedAt: validFrom ?? "2026-08-29T00:00:00Z",
          idempotencyKey,
        });

      append("first", firstPlace, "2026-08-29T00:00:00Z", "2026-08-30T00:00:00Z");
      expect(() => append("second", secondPlace, "2026-08-30T00:00:00Z")).not.toThrow();
      expect(() => append("overlap", firstPlace, "2026-08-30T01:00:00Z")).toThrow("permits one object");
    } finally {
      database.close();
    }
  });
});
