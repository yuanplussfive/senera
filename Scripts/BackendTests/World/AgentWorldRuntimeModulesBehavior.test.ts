import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentHabitScheduler } from "../../../Source/AgentSystem/World/AgentHabitScheduler.js";
import { AgentResidentStateMachine } from "../../../Source/AgentSystem/World/AgentResidentStateMachine.js";
import { AgentWorldClock } from "../../../Source/AgentSystem/World/AgentWorldClock.js";
import { AgentWorldEventLedger } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { AgentWorldGraphView } from "../../../Source/AgentSystem/World/AgentWorldGraphView.js";
import { AgentWorldMaterializer } from "../../../Source/AgentSystem/World/AgentWorldMaterializer.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("world runtime modules", () => {
  test("advances a conditional habit through XState and materializes its graph after offline time", () => {
    const workspace = createTemporaryDirectory("senera-world-modules");
    workspaces.add(workspace);
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const timeZone = "Asia/Shanghai";
      const agenda = new AgentAgendaService({ store: new AgentAgendaSqliteStore(database) });
      const world = agenda.snapshot(timeZone, new Date("2026-08-29T23:59:00Z")).world;
      const ledger = new AgentWorldEventLedger(database, agenda);
      const states = new AgentResidentStateMachine(database, ledger);
      const actor = {
        id: "senera://world-person/resident",
        kind: "person" as const,
        label: "失语症",
        parentId: null,
        attributes: { role: "resident" },
      };
      states.register({
        worldId: world.id,
        timeZone,
        actor,
        definition: {
          id: "daily_activity",
          projection: { attribute: "activity" },
          initial: "idle",
          states: {
            idle: { label: "空闲", on: { begin: "working" } },
            working: { label: "工作中", on: { finish: "resting" }, attributes: { emotionState: "focused" } },
            resting: { label: "休息中", on: { reset: "idle" }, attributes: { bodyState: "recovering" } },
          },
        },
        sourceRefs: ["senera://world-package/test"],
        now: Temporal.Instant.from("2026-08-29T23:59:00Z"),
      });
      const signals = new Map<string, unknown>([[`${actor.id}:workspace.ready`, false]]);
      const scheduler = new AgentHabitScheduler(
        database,
        ledger,
        { read: (subjectId, attribute) => signals.get(`${subjectId}:${attribute}`) },
        states,
      );
      scheduler.register(
        world.id,
        {
          id: "morning_work",
          actor,
          summary: "开始晨间工作",
          rrule: "FREQ=DAILY",
          startsAt: "2026-08-30T00:00:00Z",
          timeZone,
          occurrenceWindowSeconds: 3_600,
          excludedLocalDates: [],
          priority: 10,
          conditions: [{ subjectId: actor.id, attribute: "workspace.ready", operator: "equals", value: true }],
          effects: [],
          stateTransition: { machineId: "daily_activity", event: "begin" },
          sourceRefs: ["senera://world-package/test/habit"],
        },
        Temporal.Instant.from("2026-08-29T23:59:00Z"),
      );

      const pending = scheduler.advance({
        worldId: world.id,
        from: Temporal.Instant.from("2026-08-29T23:59:00Z"),
        to: Temporal.Instant.from("2026-08-30T00:01:00Z"),
        maximumOccurrences: 16,
      });
      expect(pending).toMatchObject({ appliedEventUris: [], pendingOccurrences: 1 });
      expect(scheduler.evaluationWakePlan(world.id, Temporal.Instant.from("2026-08-30T00:01:00Z"), "habit")).toEqual({
        due: false,
        instants: [Temporal.Instant.from("2026-08-30T01:00:00Z"), Temporal.Instant.from("2026-08-31T00:00:00Z")],
      });
      expect(scheduler.evaluationWakePlan(world.id, Temporal.Instant.from("2026-08-30T02:00:00Z"), "habit")).toEqual({
        due: true,
        instants: [Temporal.Instant.from("2026-08-31T00:00:00Z")],
      });

      signals.set(`${actor.id}:workspace.ready`, true);
      const applied = scheduler.advance({
        worldId: world.id,
        from: Temporal.Instant.from("2026-08-30T00:01:00Z"),
        to: Temporal.Instant.from("2026-08-30T00:30:00Z"),
        maximumOccurrences: 16,
      });
      expect(applied.appliedEventUris).toHaveLength(1);
      expect(applied.pendingOccurrences).toBe(0);

      const materializer = new AgentWorldMaterializer({
        ledger,
        graphSnapshot: () => ({ scope: [], entities: [], relations: [] }),
        config: () => ({
          Name: "Senera",
          TimeZone: timeZone,
          DayPhases: [
            { Id: "night", Label: "深夜", StartsAt: "00:00", EndsAt: "06:00" },
            { Id: "day", Label: "白天", StartsAt: "06:00", EndsAt: "18:00" },
            { Id: "evening", Label: "晚上", StartsAt: "18:00", EndsAt: "00:00" },
          ],
          RecordLimit: 64,
          TimelineLimit: 64,
          HabitCatchUpLimit: 16,
        }),
      });
      const materializedAt = Temporal.Instant.from("2026-08-30T00:30:00Z");
      const snapshot = materializer.materialize(materializedAt, scheduler.upcoming(world.id, materializedAt));
      expect(snapshot.resident).toMatchObject({
        residentId: actor.id,
        activity: "工作中",
        emotionState: "focused",
        nextPlan: expect.objectContaining({ scheduleId: "morning_work" }),
      });
      const graph = new AgentWorldGraphView(snapshot);
      const nextTime = snapshot.edges.find(
        (edge) => edge.subjectId.includes("world-habit-occurrence") && edge.relation === "scheduled_for",
      )?.objectId;
      expect(nextTime).toBeTruthy();
      expect(graph.shortestPath(actor.id, nextTime!)).toHaveLength(3);

      database.connection.prepare("DELETE FROM agent_world_machine_snapshots WHERE world_id = ?").run(world.id);
      const replayed = states.transition({
        worldId: world.id,
        timeZone,
        actor,
        machineId: "daily_activity",
        event: "finish",
        evidenceRefs: ["senera://world-test/finish"],
        occurredAt: "2026-08-30T01:00:00Z",
        recordedAt: "2026-08-30T01:00:00Z",
        idempotencyKey: "world-test:finish",
      });
      expect(replayed).toMatchObject({ from: "working", to: "resting" });

      states.register({
        worldId: world.id,
        timeZone,
        actor,
        definition: {
          id: "daily_activity",
          projection: { attribute: "activity" },
          initial: "fresh",
          states: {
            fresh: { label: "新版空闲", on: { begin: "legacy_busy", start_new: "new_working" } },
            legacy_busy: { label: "旧版工作", on: { finish: "legacy_resting" } },
            legacy_resting: { label: "旧版休息", on: {} },
            new_working: { label: "新版工作", on: { finish_new: "fresh" } },
          },
        },
        sourceRefs: ["senera://world-package/test/revision-2"],
        now: Temporal.Instant.from("2026-08-30T01:30:00Z"),
      });
      const revisedTransition = states.transition({
        worldId: world.id,
        timeZone,
        actor,
        machineId: "daily_activity",
        event: "start_new",
        evidenceRefs: ["senera://world-test/revision-2"],
        occurredAt: "2026-08-30T01:31:00Z",
        recordedAt: "2026-08-30T01:31:00Z",
        idempotencyKey: "world-test:revision-2",
      });
      expect(revisedTransition).toMatchObject({ from: "fresh", to: "new_working" });

      const clock = new AgentWorldClock(database, ledger);
      const phases = [
        { id: "night", label: "深夜", startsAt: "00:00", endsAt: "06:00" },
        { id: "day", label: "白天", startsAt: "06:00", endsAt: "18:00" },
        { id: "evening", label: "晚上", startsAt: "18:00", endsAt: "00:00" },
      ];
      clock.advance({
        worldId: world.id,
        timeZone,
        dayPhases: phases,
        now: Temporal.Instant.from("2026-08-30T01:00:00Z"),
      });
      const offline = clock.advance({
        worldId: world.id,
        timeZone,
        dayPhases: phases,
        now: Temporal.Instant.from("2026-09-01T10:00:00Z"),
      });
      expect(offline.changed).toBe(true);
      const clockEvent = ledger.snapshot(timeZone).events.find((event) => event.type === "clock.boundary_crossed");
      expect(clockEvent?.changes).toContainEqual(
        expect.objectContaining({
          kind: "clock_advance",
          crossedLocalDates: ["2026-08-30", "2026-08-31", "2026-09-01"],
        }),
      );
    } finally {
      database.close();
    }
  });
});
