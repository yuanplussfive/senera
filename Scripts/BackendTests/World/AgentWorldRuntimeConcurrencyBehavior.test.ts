import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import type { ResolvedAgentWorldConfig } from "../../../Source/AgentSystem/Types/AgentRuntimeConfigTypes.js";
import { AgentHabitScheduler } from "../../../Source/AgentSystem/World/AgentHabitScheduler.js";
import { AgentResidentStateMachine } from "../../../Source/AgentSystem/World/AgentResidentStateMachine.js";
import { AgentWorldClock } from "../../../Source/AgentSystem/World/AgentWorldClock.js";
import { AgentWorldEventLedger } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { AgentWorldMaterializer } from "../../../Source/AgentSystem/World/AgentWorldMaterializer.js";
import { AgentWorldRuntime } from "../../../Source/AgentSystem/World/AgentWorldRuntime.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const timeZone = "UTC";
const initial = Temporal.Instant.from("2026-09-13T00:00:00Z");
const firstWake = initial.add({ seconds: 1 });
const laterObservation = initial.add({ seconds: 2 });
const worldConfig: ResolvedAgentWorldConfig = {
  Name: "Senera",
  TimeZone: timeZone,
  DayPhases: [
    { Id: "night", Label: "Night", StartsAt: "00:00", EndsAt: "06:00" },
    { Id: "day", Label: "Day", StartsAt: "06:00", EndsAt: "18:00" },
    { Id: "evening", Label: "Evening", StartsAt: "18:00", EndsAt: "00:00" },
  ],
  RecordLimit: 64,
  TimelineLimit: 64,
  HabitCatchUpLimit: 16,
};

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("world runtime clock serialization", () => {
  test("coalesces a snapshot observed while a wake pass is in flight", async () => {
    const workspace = createTemporaryDirectory("senera-world-runtime-concurrency");
    workspaces.add(workspace);
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    let runtime: AgentWorldRuntime | undefined;
    try {
      const agenda = new AgentAgendaService({
        store: new AgentAgendaSqliteStore(database),
        now: () => new Date(initial.epochMilliseconds),
      });
      const ledger = new AgentWorldEventLedger(database, agenda);
      const residentStates = new AgentResidentStateMachine(database, ledger);
      const materializer = new AgentWorldMaterializer({
        ledger,
        graphSnapshot: () => ({ scope: [], entities: [], relations: [] }),
        config: () => worldConfig,
      });
      const habits = new AgentHabitScheduler(
        database,
        ledger,
        { read: (subjectId, attribute, at) => materializer.readAttribute(subjectId, attribute, at) },
        residentStates,
      );
      const observedWakeTimes: Temporal.Instant[] = [];
      const wakeSource = {
        wakePlan: () => ({ due: false, instants: [] }),
        upcomingSchedules: () => [],
        onWake: async (input: { readonly to: Temporal.Instant }) => {
          observedWakeTimes.push(input.to);
          return { changed: false as const };
        },
      };
      runtime = new AgentWorldRuntime({
        agenda,
        ledger,
        clock: new AgentWorldClock(database, ledger),
        habits,
        residentStates,
        materializer,
        config: () => worldConfig,
        now: () => initial,
        errorSink: (error) => {
          throw error;
        },
        wakeSources: [wakeSource],
      });
      const world = agenda.snapshot(timeZone, new Date(initial.epochMilliseconds)).world;

      runtime.start(() => undefined);
      const pendingWake = runtime.wake(firstWake);
      const projectedDuringWake = runtime.snapshot(laterObservation);

      expect(projectedDuringWake.time.instant.toString()).toBe(laterObservation.toString());
      const result = await pendingWake;
      expect(result.time.instant.toString()).toBe(laterObservation.toString());
      expect(observedWakeTimes.map((instant) => instant.toString())).toEqual([
        firstWake.toString(),
        laterObservation.toString(),
      ]);
      expect(new AgentWorldClock(database, ledger).state(world.id)?.lastAdvancedAt.toString()).toBe(
        laterObservation.toString(),
      );
    } finally {
      runtime?.stop();
      database.close();
    }
  });
});
