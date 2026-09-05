import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentWorldResidentWakeRuntime } from "../../../Source/AgentSystem/World/AgentWorldResidentWakeRuntime.js";
import { AgentWorldResidentWakeEventActionPort } from "../../../Source/AgentSystem/World/AgentWorldResidentWakeEventActionPort.js";
import { AgentWorldEventLedger } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { AgentWorldWorkLedger } from "../../../Source/AgentSystem/World/AgentWorldWorkLedger.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const now = Temporal.Instant.from("2026-09-02T00:00:00Z");

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("resident wake runtime", () => {
  test("only executes explicitly requested resident work and acknowledges evidence", async () => {
    const workspace = createTemporaryDirectory("senera-resident-wake");
    workspaces.add(workspace);
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({
        store: new AgentAgendaSqliteStore(database),
        now: () => new Date(now.epochMilliseconds),
      });
      const worldId = agenda.snapshot("Asia/Shanghai", new Date(now.epochMilliseconds)).world.id;
      const ledger = new AgentWorldWorkLedger(database);
      const runtime = new AgentWorldResidentWakeRuntime({
        workLedger: ledger,
        maxPending: 8,
        leaseDurationMs: 60_000,
        retryDelayMs: 30_000,
        actionPort: {
          async execute(input) {
            return { evidenceRefs: [`resident:${input.request.id}`], result: { reason: input.request.reason } };
          },
        },
      });
      expect(runtime.wakePlan({ worldId, after: now })).toEqual({ due: false, instants: [] });
      runtime.request({
        worldId,
        now,
        request: { id: "wake-1", reason: "notice", priority: 10, payload: { source: "test" } },
      });
      expect(runtime.wakePlan({ worldId, after: now })).toEqual({ due: true, instants: [] });
      const result = await runtime.onWake({
        worldId,
        from: now,
        to: now,
        snapshot: {} as never,
      });
      expect(result).toEqual({ changed: true });
      expect(ledger.nextDueAt(worldId)).toBeUndefined();
      expect(ledger.listDue({ worldId, now, limit: 8 })).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  test("persists the default explicit wake action as a world event", async () => {
    const workspace = createTemporaryDirectory("senera-resident-wake-event");
    workspaces.add(workspace);
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({
        store: new AgentAgendaSqliteStore(database),
        now: () => new Date(now.epochMilliseconds),
      });
      const worldId = agenda.snapshot("Asia/Shanghai", new Date(now.epochMilliseconds)).world.id;
      const ledger = new AgentWorldEventLedger(database, agenda);
      const action = new AgentWorldResidentWakeEventActionPort({ ledger, timeZone: () => "Asia/Shanghai" });
      const result = await action.execute({
        worldId,
        now,
        snapshot: {} as never,
        request: {
          id: "wake-event-1",
          reason: "explicit test wake",
          priority: 20,
          payload: { source: "test" },
          requestedAt: now.toString(),
        },
      });
      expect(result.result).toMatchObject({ requestId: "wake-event-1" });
      expect(result.evidenceRefs).toEqual([expect.stringContaining("senera://world-event/")]);
      expect(ledger.snapshot("Asia/Shanghai").events.some((event) => event.type === "resident.explicit_wake")).toBe(
        true,
      );
    } finally {
      database.close();
    }
  });
});
