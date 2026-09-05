import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentWorldWorkLedger } from "../../../Source/AgentSystem/World/AgentWorldWorkLedger.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const now = Temporal.Instant.from("2026-09-02T00:00:00Z");
const nextMinute = now.add({ minutes: 1 });
const halfMinute = now.add({ seconds: 30 });

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

function openLedger(workspace: string): {
  readonly database: AgentSqliteDatabaseKernel;
  readonly ledger: AgentWorldWorkLedger;
  readonly worldId: string;
} {
  const database = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const agenda = new AgentAgendaService({
    store: new AgentAgendaSqliteStore(database),
    now: () => new Date(now.epochMilliseconds),
  });
  const worldId = agenda.snapshot("Asia/Shanghai", new Date(now.epochMilliseconds)).world.id;
  return { database, ledger: new AgentWorldWorkLedger(database), worldId };
}

describe("world work ledger", () => {
  test("persists an idempotent canonical work item across database reopen", () => {
    const workspace = createTemporaryDirectory("senera-world-work-ledger");
    workspaces.add(workspace);
    const first = openLedger(workspace);
    const created = first.ledger.enqueue({
      worldId: first.worldId,
      sourceId: "world.habit",
      candidateId: "habit\u00002026-09-02T00:00:00Z",
      requestId: "world-habit:habit:2026-09-02T00:00:00Z",
      payload: { z: true, a: "stable" },
      nextAttemptAt: now,
      now,
    });
    expect(
      first.ledger.enqueue({
        worldId: first.worldId,
        sourceId: "world.habit",
        candidateId: "habit\u00002026-09-02T00:00:00Z",
        requestId: "world-habit:habit:2026-09-02T00:00:00Z",
        payload: { a: "stable", z: true },
        nextAttemptAt: now,
        now,
      }),
    ).toEqual(created);
    expect(() =>
      first.ledger.enqueue({
        worldId: first.worldId,
        sourceId: "world.habit",
        candidateId: "habit\u00002026-09-02T00:00:00Z",
        requestId: "world-habit:habit:2026-09-02T00:00:00Z",
        payload: { a: "changed" },
        nextAttemptAt: now,
        now,
      }),
    ).toThrow(/identity conflict/);
    first.database.close();

    const reopened = openLedger(workspace);
    try {
      expect(reopened.ledger.get(created.id)).toMatchObject({
        id: created.id,
        payload: { a: "stable", z: true },
        status: "pending",
        leaseGeneration: 0,
      });
    } finally {
      reopened.database.close();
    }
  });

  test("fences acknowledgement and recovers leased versus running work differently", () => {
    const workspace = createTemporaryDirectory("senera-world-work-recovery");
    workspaces.add(workspace);
    const { database, ledger, worldId } = openLedger(workspace);
    try {
      const item = ledger.enqueue({
        worldId,
        sourceId: "world.habit",
        candidateId: "candidate-1",
        requestId: "request-1",
        payload: { candidate: 1 },
        nextAttemptAt: now,
        now,
      });
      const lease = ledger.claim({ id: item.id, owner: "worker-a", now, leaseUntil: nextMinute });
      expect(lease?.generation).toBe(1);
      expect(() => ledger.ack({ id: item.id, owner: "worker-b", generation: 1, now, evidenceRefs: [] })).toThrow(
        /stale/,
      );
      const running = ledger.markRunning({ id: item.id, owner: "worker-a", generation: 1, now });
      expect(running.item.status).toBe("running");
      expect(
        ledger.ack({
          id: item.id,
          owner: "worker-a",
          generation: 1,
          now: halfMinute,
          result: { event: "ok" },
          evidenceRefs: ["event:1"],
        }),
      ).toMatchObject({
        status: "acknowledged",
        result: { event: "ok" },
      });
      expect(
        ledger.ack({ id: item.id, owner: "worker-a", generation: 1, now: halfMinute, evidenceRefs: [] }).status,
      ).toBe("acknowledged");

      const leasedItem = ledger.enqueue({
        worldId,
        sourceId: "world.habit",
        candidateId: "candidate-2",
        requestId: "request-2",
        payload: {},
        nextAttemptAt: now,
        now,
      });
      ledger.claim({ id: leasedItem.id, owner: "worker-a", now, leaseUntil: nextMinute });
      const runningItem = ledger.enqueue({
        worldId,
        sourceId: "world.habit",
        candidateId: "candidate-3",
        requestId: "request-3",
        payload: {},
        nextAttemptAt: now,
        now,
      });
      ledger.claim({ id: runningItem.id, owner: "worker-a", now, leaseUntil: nextMinute });
      ledger.markRunning({ id: runningItem.id, owner: "worker-a", generation: 1, now });

      expect(ledger.recoverExpired(nextMinute.add({ seconds: 1 }))).toEqual({
        releasedLeases: 1,
        reconciliationRequired: 1,
      });
      expect(ledger.get(leasedItem.id)?.status).toBe("pending");
      expect(ledger.get(runningItem.id)?.status).toBe("reconciliation_required");
    } finally {
      database.close();
    }
  });

  test("failed work remains retryable at its explicit next attempt time", () => {
    const workspace = createTemporaryDirectory("senera-world-work-retry");
    workspaces.add(workspace);
    const { database, ledger, worldId } = openLedger(workspace);
    try {
      const item = ledger.enqueue({
        worldId,
        sourceId: "world.goal",
        candidateId: "candidate-1",
        requestId: "request-1",
        payload: [],
        nextAttemptAt: now,
        now,
      });
      const lease = ledger.claim({ id: item.id, owner: "worker-a", now, leaseUntil: nextMinute });
      expect(lease).toBeDefined();
      ledger.fail({
        id: item.id,
        owner: "worker-a",
        generation: lease!.generation,
        now,
        error: "temporary",
        nextAttemptAt: nextMinute,
      });
      expect(ledger.listDue({ worldId, now, limit: 4 })).toHaveLength(0);
      expect(ledger.listDue({ worldId, now: nextMinute, limit: 4 })).toHaveLength(1);
      expect(
        ledger.claim({ id: item.id, owner: "worker-b", now: nextMinute, leaseUntil: nextMinute.add({ minutes: 1 }) })
          ?.generation,
      ).toBe(2);
    } finally {
      database.close();
    }
  });

  test("keeps due queries isolated by wake source when requested", () => {
    const workspace = createTemporaryDirectory("senera-world-work-source-filter");
    workspaces.add(workspace);
    const { database, ledger, worldId } = openLedger(workspace);
    try {
      ledger.enqueue({
        worldId,
        sourceId: "world.habit",
        candidateId: "habit-1",
        requestId: "habit-request-1",
        payload: { kind: "habit" },
        nextAttemptAt: now,
        now,
      });
      ledger.enqueue({
        worldId,
        sourceId: "world.resident",
        candidateId: "resident-1",
        requestId: "resident-request-1",
        payload: { kind: "resident" },
        nextAttemptAt: now.add({ minutes: 1 }),
        now,
      });

      expect(ledger.listDue({ worldId, sourceId: "world.habit", now, limit: 4 })).toHaveLength(1);
      expect(ledger.listDue({ worldId, sourceId: "world.resident", now, limit: 4 })).toHaveLength(0);
      expect(ledger.nextDueAt(worldId, "world.habit")).toBe(now.toString());
      expect(ledger.nextDueAt(worldId, "world.resident")).toBe(now.add({ minutes: 1 }).toString());
      expect(ledger.hasOutstanding(worldId, "world.habit")).toBe(true);
      expect(ledger.hasOutstanding(worldId, "world.resident")).toBe(true);
      expect(ledger.hasOutstanding(worldId, "world.missing")).toBe(false);
    } finally {
      database.close();
    }
  });
});
