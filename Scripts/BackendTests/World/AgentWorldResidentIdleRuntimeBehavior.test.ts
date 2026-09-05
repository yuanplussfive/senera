import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentWorldWakeBudget } from "../../../Source/AgentSystem/World/AgentWorldActionBudget.js";
import {
  AgentWorldResidentIdleDecisionKinds,
  AgentWorldResidentIdleRuntime,
} from "../../../Source/AgentSystem/World/AgentWorldResidentIdleRuntime.js";
import { AgentWorldWorkLedger } from "../../../Source/AgentSystem/World/AgentWorldWorkLedger.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const now = Temporal.Instant.from("2026-09-02T00:00:00Z");
const snapshot = {
  world: { id: "world", name: "Senera", timeZone: "UTC" },
  time: { phaseId: "morning", localDate: "2026-09-02" },
  resident: {},
  changedNodeIds: [],
  commitments: [],
  timeline: [],
} as never;

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

function openRuntime(
  workspace: string,
  decision: () => Promise<{
    kind: "wait" | "reflect";
    reason: string;
  }>,
) {
  const database = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const agenda = new AgentAgendaService({
    store: new AgentAgendaSqliteStore(database),
    now: () => new Date(now.epochMilliseconds),
  });
  const worldId = agenda.snapshot("Asia/Shanghai", new Date(now.epochMilliseconds)).world.id;
  const ledger = new AgentWorldWorkLedger(database);
  const runtime = new AgentWorldResidentIdleRuntime({
    workLedger: ledger,
    decisionPort: { decide: decision },
    actionPort: {
      execute: vi.fn(async () => ({ changed: true, evidenceRefs: ["reflection:1"] })),
    },
    config: () => ({
      enabled: true,
      minIntervalMs: 60_000,
      maxIntervalMs: 3_600_000,
      backoffMultiplier: 2,
      maxPending: 1,
    }),
    leaseDurationMs: () => 60_000,
    retryDelayMs: () => 30_000,
  });
  return { database, ledger, runtime, worldId };
}

function budget(nowInput: Temporal.Instant) {
  return new AgentWorldWakeBudget(
    {
      maxActionsPerWake: 4,
      maxDecisionCandidatesPerWake: 4,
      retryDelayMs: 30_000,
      fairShare: false,
      sourceCaps: {},
    },
    nowInput,
    ["world.resident.idle"],
  );
}

describe("resident idle runtime", () => {
  test("persists a wait tick and schedules exponential backoff", async () => {
    const workspace = createTemporaryDirectory("senera-resident-idle-wait");
    workspaces.add(workspace);
    const first = openRuntime(workspace, async () => ({
      kind: AgentWorldResidentIdleDecisionKinds.Wait,
      reason: "没有新的显著变化",
    }));
    first.runtime.ensureScheduled(first.worldId, now.add({ minutes: -1 }));
    const dueAt = first.ledger.nextDueAt(first.worldId, "world.resident.idle");
    expect(dueAt).toBe(now.toString());
    const result = await first.runtime.onWake({
      worldId: first.worldId,
      from: now,
      to: now,
      snapshot,
      budget: budget(now),
    });
    expect(result).toEqual({ changed: false });
    expect(first.ledger.hasOutstanding(first.worldId, "world.resident.idle")).toBe(true);
    expect(first.ledger.nextDueAt(first.worldId, "world.resident.idle")).toBe(now.add({ minutes: 2 }).toString());
    first.database.close();

    const reopened = openRuntime(workspace, async () => ({
      kind: AgentWorldResidentIdleDecisionKinds.Reflect,
      reason: "不应在尚未到期时运行",
    }));
    try {
      expect(reopened.runtime.ensureScheduled(reopened.worldId, now)).toBeUndefined();
      expect(reopened.ledger.nextDueAt(reopened.worldId, "world.resident.idle")).toBe(
        now.add({ minutes: 2 }).toString(),
      );
    } finally {
      reopened.database.close();
    }
  });

  test("skips the model on an unchanged salience fingerprint", async () => {
    const workspace = createTemporaryDirectory("senera-resident-idle-salience");
    workspaces.add(workspace);
    const decide = vi.fn(async () => ({
      kind: AgentWorldResidentIdleDecisionKinds.Wait,
      reason: "首次观察",
    }));
    const { database, ledger, runtime, worldId } = openRuntime(workspace, decide);
    try {
      runtime.ensureScheduled(worldId, now.add({ minutes: -1 }));
      await runtime.onWake({ worldId, from: now, to: now, snapshot, budget: budget(now) });
      const next = now.add({ minutes: 2 });
      await runtime.onWake({ worldId, from: now, to: next, snapshot, budget: budget(next) });
      expect(decide).toHaveBeenCalledOnce();
      expect(ledger.nextDueAt(worldId, "world.resident.idle")).toBe(next.add({ minutes: 4 }).toString());
    } finally {
      database.close();
    }
  });

  test("requires the shared budget and rejects malformed durable payloads", async () => {
    const workspace = createTemporaryDirectory("senera-resident-idle-contract");
    workspaces.add(workspace);
    const { database, ledger, runtime, worldId } = openRuntime(workspace, async () => ({
      kind: AgentWorldResidentIdleDecisionKinds.Wait,
      reason: "wait",
    }));
    try {
      runtime.ensureScheduled(worldId, now.add({ minutes: -1 }));
      await expect(runtime.onWake({ worldId, from: now, to: now, snapshot })).rejects.toThrow(/shared action budget/);
      const item = ledger.listDue({ worldId, sourceId: "world.resident.idle", now, limit: 1 })[0]!;
      ledger.cancel({ id: item.id, now, reason: "test" });
      ledger.enqueue({
        worldId,
        sourceId: "world.resident.idle",
        candidateId: "malformed",
        requestId: "malformed-request",
        payload: { version: 2 },
        nextAttemptAt: now,
        now,
      });
      await expect(runtime.onWake({ worldId, from: now, to: now, snapshot, budget: budget(now) })).rejects.toThrow(
        /payload is invalid/,
      );
    } finally {
      database.close();
    }
  });
});
