import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import type { ResolvedAgentWorldConfig } from "../../../Source/AgentSystem/Types/AgentRuntimeConfigTypes.js";
import { AgentHabitScheduler } from "../../../Source/AgentSystem/World/AgentHabitScheduler.js";
import type { AgentHabitOccurrenceCandidate } from "../../../Source/AgentSystem/World/AgentHabitScheduler.js";
import { AgentWorldAutonomyRuntime } from "../../../Source/AgentSystem/World/AgentWorldAutonomyRuntime.js";
import { AgentWorldClock } from "../../../Source/AgentSystem/World/AgentWorldClock.js";
import { AgentWorldEventLedger } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { AgentWorldMaterializer } from "../../../Source/AgentSystem/World/AgentWorldMaterializer.js";
import { AgentWorldRuntime } from "../../../Source/AgentSystem/World/AgentWorldRuntime.js";
import { AgentResidentStateMachine } from "../../../Source/AgentSystem/World/AgentResidentStateMachine.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const timeZone = "Asia/Shanghai";
const initial = Temporal.Instant.from("2026-08-29T12:59:00Z");
const due = Temporal.Instant.from("2026-08-29T13:01:00Z");
const worldConfig: ResolvedAgentWorldConfig = {
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
};

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("world autonomy runtime", () => {
  test("recovers a crossed routine after a snapshot and remains idempotent", async () => {
    const workspace = createTemporaryDirectory("senera-world-autonomy");
    workspaces.add(workspace);
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({
        store: new AgentAgendaSqliteStore(database),
        now: () => new Date(initial.epochMilliseconds),
      });
      const ledger = new AgentWorldEventLedger(database, agenda);
      const states = new AgentResidentStateMachine(database, ledger);
      const materializer = new AgentWorldMaterializer({
        ledger,
        graphSnapshot: () => ({ scope: [], entities: [], relations: [] }),
        config: () => worldConfig,
      });
      const habits = new AgentHabitScheduler(
        database,
        ledger,
        { read: (subjectId, attribute, at) => materializer.readAttribute(subjectId, attribute, at) },
        states,
      );
      const autonomy = new AgentWorldAutonomyRuntime({ habits, config: () => worldConfig });
      const world = agenda.snapshot(timeZone, new Date(initial.epochMilliseconds)).world;
      const actor = {
        id: "senera://world-person/resident",
        kind: "person" as const,
        label: "居住者",
        parentId: null,
        attributes: { role: "resident" },
      };

      autonomy.register(
        world.id,
        {
          id: "daily-reset",
          actor,
          summary: "整理今天的工作台",
          rrule: "FREQ=DAILY;COUNT=2",
          startsAt: "2026-08-29T13:00:00Z",
          timeZone,
          occurrenceWindowSeconds: 1_800,
          excludedLocalDates: [],
          priority: 1,
          conditions: [],
          effects: [],
          sourceRefs: ["senera://world-package/test/autonomy"],
          mode: "automatic",
        },
        initial,
      );

      expect(autonomy.wakePlan({ worldId: world.id, after: initial })).toEqual({
        due: false,
        instants: [Temporal.Instant.from("2026-08-29T13:00:00Z")],
      });
      const runtime = new AgentWorldRuntime({
        agenda,
        ledger,
        clock: new AgentWorldClock(database, ledger),
        habits,
        residentStates: states,
        materializer,
        config: () => worldConfig,
        errorSink: (error) => {
          throw error;
        },
        wakeSources: [autonomy],
      });
      runtime.snapshot(due);
      expect(ledger.snapshot(timeZone).events.filter((event) => event.type === "autonomy.occurred")).toHaveLength(0);
      expect(new AgentWorldClock(database, ledger).state(world.id)?.nextWakeAt).toEqual(due);

      const firstWake = runtime.wake(due);
      const secondWake = runtime.wake(due);
      expect(secondWake).toBe(firstWake);
      const first = await firstWake;
      expect(ledger.snapshot(timeZone).events.filter((event) => event.type === "autonomy.occurred")).toHaveLength(1);
      expect(first.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ type: "autonomy.occurred" })]));

      const second = await runtime.wake(due);
      expect(second.timeline).toEqual(first.timeline);
      expect(ledger.snapshot(timeZone).events.filter((event) => event.type === "autonomy.occurred")).toHaveLength(1);
      expect(autonomy.wakePlan({ worldId: world.id, after: due })).toEqual({
        due: false,
        instants: [Temporal.Instant.from("2026-08-30T13:00:00Z")],
      });

      let releaseWake!: () => void;
      const wakeGate = new Promise<void>((resolve) => {
        releaseWake = resolve;
      });
      const observedWakeTimes: Temporal.Instant[] = [];
      const blockingSource = {
        wakePlan: vi.fn(() => ({ due: false, instants: [] })),
        upcomingSchedules: vi.fn(() => []),
        onWake: vi.fn(async (input: { readonly to: Temporal.Instant }) => {
          observedWakeTimes.push(input.to);
          if (observedWakeTimes.length === 1) await wakeGate;
          return { changed: false as const };
        }),
      };
      const queuedRuntime = new AgentWorldRuntime({
        agenda,
        ledger,
        clock: new AgentWorldClock(database, ledger),
        habits,
        residentStates: states,
        materializer,
        config: () => worldConfig,
        errorSink: (error) => {
          throw error;
        },
        wakeSources: [blockingSource],
      });
      const later = due.add({ seconds: 1 });
      const queuedWake = queuedRuntime.wake(due);
      expect(blockingSource.onWake).toHaveBeenCalledTimes(1);
      expect(queuedRuntime.wake(later)).toBe(queuedWake);
      releaseWake();
      await queuedWake;
      expect(observedWakeTimes).toEqual([due, later]);

      vi.useFakeTimers();
      try {
        const failingSource = {
          wakePlan: vi.fn(() => ({ due: true, instants: [] })),
          upcomingSchedules: vi.fn(() => []),
          onWake: vi.fn(async () => {
            throw new Error("wake source failed");
          }),
        };
        const errors = vi.fn();
        const failingRuntime = new AgentWorldRuntime({
          agenda,
          ledger,
          clock: new AgentWorldClock(database, ledger),
          habits,
          residentStates: states,
          materializer,
          config: () => worldConfig,
          now: () => later,
          errorSink: errors,
          wakeSources: [failingSource],
        });
        failingRuntime.start(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(failingSource.onWake).toHaveBeenCalledTimes(1);
        expect(errors).toHaveBeenCalledTimes(1);
        failingRuntime.stop();

        const stalledSource = {
          wakePlan: vi.fn(() => ({ due: true, instants: [] })),
          upcomingSchedules: vi.fn(() => []),
          onWake: vi.fn(async () => ({ changed: false as const })),
        };
        const stalledErrors = vi.fn();
        const stalledRuntime = new AgentWorldRuntime({
          agenda,
          ledger,
          clock: new AgentWorldClock(database, ledger),
          habits,
          residentStates: states,
          materializer,
          config: () => worldConfig,
          now: () => later,
          errorSink: stalledErrors,
          wakeSources: [stalledSource],
        });
        stalledRuntime.start(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(stalledSource.onWake).toHaveBeenCalledTimes(1);
        expect(stalledErrors).toHaveBeenCalledTimes(1);
        stalledRuntime.stop();
      } finally {
        vi.useRealTimers();
      }
    } finally {
      database.close();
    }
  });

  test("requires an exhaustive decision and persists an explicit skip", async () => {
    const occurrenceAt = Temporal.Instant.from("2026-08-29T13:00:00Z");
    const candidate = {
      definition: {
        id: "optional-break",
        kind: "autonomy" as const,
        autonomyMode: "decision" as const,
        actor: {
          id: "senera://world-person/resident",
          kind: "person" as const,
          label: "居住者",
          parentId: null,
          attributes: { role: "resident" },
        },
        summary: "休息一下",
        rrule: "FREQ=DAILY",
        startsAt: occurrenceAt.toString(),
        timeZone,
        occurrenceWindowSeconds: 1_800,
        excludedLocalDates: [],
        priority: 1,
        conditions: [],
        effects: [],
        sourceRefs: ["senera://world-package/test/autonomy"],
      },
      occurrenceAt,
      eligibleUntil: occurrenceAt.add({ seconds: 1_800 }),
    } satisfies AgentHabitOccurrenceCandidate;
    const skipCandidate = vi.fn(() => ({ outcome: "skipped" as const }));
    const applyCandidate = vi.fn(() => ({ outcome: "applied" as const, eventUri: "senera://world-event/applied" }));
    const habits = {
      listUnprocessedCandidates: vi.fn(() => [candidate]),
      applyCandidate,
      skipCandidate,
    } as unknown as AgentHabitScheduler;
    const decisionPort = {
      select: vi.fn(async () => [
        {
          routineId: candidate.definition.id,
          occurrenceAt: candidate.occurrenceAt.toString(),
          disposition: "skip" as const,
        },
      ]),
    };
    const autonomy = new AgentWorldAutonomyRuntime({ habits, config: () => worldConfig, decisionPort });
    const wake = {
      worldId: "world",
      from: occurrenceAt,
      to: occurrenceAt.add({ seconds: 1 }),
      snapshot: {} as never,
    };

    await expect(autonomy.onWake(wake)).resolves.toEqual({ changed: true });
    expect(skipCandidate).toHaveBeenCalledWith({
      worldId: "world",
      definitionId: candidate.definition.id,
      occurrenceAt,
      evaluatedAt: wake.to,
      reason: "autonomy_decision_skipped",
    });
    expect(applyCandidate).not.toHaveBeenCalled();

    decisionPort.select.mockResolvedValueOnce([]);
    await expect(autonomy.onWake(wake)).rejects.toThrow("must resolve every candidate");
    expect(skipCandidate).toHaveBeenCalledTimes(1);
  });
});
