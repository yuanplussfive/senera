import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AgentDelegationCompletionDelivery,
  AgentDelegationCompletionDeliveryDefaults,
} from "../../../Source/AgentSystem/Orchestration/AgentDelegationCompletionDelivery.js";
import { AgentSqliteChildRunRepository } from "../../../Source/AgentSystem/Orchestration/AgentSqliteChildRunRepository.js";
import {
  AgentChildRunStatuses,
  type AgentChildRunRecord,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import { cleanupDelegationTestRoots, openDelegationTestDatabase } from "./AgentDelegationTestSupport.js";

afterEach(() => {
  cleanupDelegationTestRoots();
});

describe("agent delegation completion delivery", () => {
  test("persists one delivery per port and treats duplicate completion as idempotent", async () => {
    const database = openDelegationTestDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const record = createTerminalChild(repository, "child-idempotent");
    const completed = vi.fn(async () => undefined);
    const delivery = new AgentDelegationCompletionDelivery({
      database,
      repository,
      retryDelaysMs: [0],
    });
    delivery.bind({ id: "test.channel", completed });

    await delivery.completed(record);
    await delivery.completed(record);

    expect(completed).toHaveBeenCalledOnce();
    expect(
      database.connection
        .prepare("SELECT delivery_status FROM child_run_completion_deliveries WHERE child_run_id = ? AND port_id = ?")
        .get(record.id, "test.channel"),
    ).toMatchObject({ delivery_status: "delivered" });
    await delivery.stop();
    database.close();
  });

  test("retries adapter failures with injected policy and converges to delivered", async () => {
    const database = openDelegationTestDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const record = createTerminalChild(repository, "child-retry");
    let attempts = 0;
    const completed = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary channel outage");
    });
    const delivery = new AgentDelegationCompletionDelivery({
      database,
      repository,
      maxAttempts: 3,
      retryDelaysMs: [0],
    });
    delivery.bind({ id: "test.retry", completed });

    await delivery.completed(record);

    expect(completed).toHaveBeenCalledTimes(3);
    expect(
      database.connection
        .prepare("SELECT delivery_status, attempt FROM child_run_completion_deliveries WHERE child_run_id = ?")
        .get(record.id),
    ).toMatchObject({ delivery_status: "delivered", attempt: 3 });
    await delivery.stop();
    database.close();
  });

  test("retries a delayed completion delivery while the runtime stays alive", async () => {
    vi.useFakeTimers();
    try {
      const database = openDelegationTestDatabase();
      const repository = new AgentSqliteChildRunRepository(database);
      const record = createTerminalChild(repository, "child-delayed-retry");
      let attempts = 0;
      const completed = vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary outage");
      });
      const delivery = new AgentDelegationCompletionDelivery({
        database,
        repository,
        retryDelaysMs: [25],
      });
      delivery.bind({ id: "test.delayed-retry", completed });

      await delivery.completed(record);
      expect(completed).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(25);
      await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(2));
      expect(
        database.connection
          .prepare("SELECT delivery_status, attempt FROM child_run_completion_deliveries WHERE child_run_id = ?")
          .get(record.id),
      ).toMatchObject({ delivery_status: "delivered", attempt: 2 });
      await delivery.stop();
      database.close();
    } finally {
      vi.useRealTimers();
    }
  });

  test("recovers an expired claim after a runtime restart", async () => {
    const database = openDelegationTestDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const record = createTerminalChild(repository, "child-restart");
    const firstDelivery = new AgentDelegationCompletionDelivery({
      database,
      repository,
      maxAttempts: 4,
      retryDelaysMs: [60_000],
    });
    const firstCompleted = vi.fn(async () => {
      throw new Error("adapter process exited");
    });
    firstDelivery.bind({ id: "test.restart", completed: firstCompleted });
    await firstDelivery.completed(record);
    await firstDelivery.stop();

    database.connection
      .prepare(
        "UPDATE child_run_completion_deliveries SET available_at = ?, delivery_status = 'pending', claim_id = NULL, claim_until = NULL",
      )
      .run(new Date(0).toISOString());

    const secondCompleted = vi.fn(async () => undefined);
    const secondDelivery = new AgentDelegationCompletionDelivery({
      database,
      repository,
      retryDelaysMs: [0],
    });
    secondDelivery.bind({ id: "test.restart", completed: secondCompleted });
    await secondDelivery.replay();

    expect(firstCompleted).toHaveBeenCalledOnce();
    expect(secondCompleted).toHaveBeenCalledOnce();
    expect(
      database.connection
        .prepare("SELECT delivery_status FROM child_run_completion_deliveries WHERE child_run_id = ?")
        .get(record.id),
    ).toMatchObject({ delivery_status: "delivered" });
    await secondDelivery.stop();
    database.close();
  });

  test("keeps default delivery policy explicit and configurable", () => {
    expect(AgentDelegationCompletionDeliveryDefaults.maxAttempts).toBeGreaterThan(0);
    expect(AgentDelegationCompletionDeliveryDefaults.retryDelaysMs.length).toBeGreaterThan(0);
  });

  test("does not enqueue cancellation as a background completion", async () => {
    const database = openDelegationTestDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const completed = vi.fn(async () => undefined);
    const delivery = new AgentDelegationCompletionDelivery({
      database,
      repository,
      retryDelaysMs: [0],
    });
    delivery.bind({ id: "test.cancelled", completed });

    const terminal = createTerminalChild(repository, "child-cancelled");
    await delivery.completed({ ...terminal, status: AgentChildRunStatuses.Cancelled });

    expect(completed).not.toHaveBeenCalled();
    expect(
      database.connection
        .prepare("SELECT 1 AS present FROM child_run_completion_deliveries WHERE child_run_id = ?")
        .get(terminal.id),
    ).toBeUndefined();
    await delivery.stop();
    database.close();
  });

  test("does not accept synchronous wait results into background completion delivery", async () => {
    const database = openDelegationTestDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const delivery = new AgentDelegationCompletionDelivery({ database, repository, retryDelaysMs: [0] });
    const record = createTerminalChild(repository, "child-wait-result");

    await expect(
      delivery.completed({
        ...record,
        launchContract: { executionMode: "wait" },
      }),
    ).rejects.toThrow("terminal detached child run");
    expect(
      database.connection
        .prepare("SELECT 1 AS present FROM child_run_completion_deliveries WHERE child_run_id = ?")
        .get(record.id),
    ).toBeUndefined();
    await delivery.stop();
    database.close();
  });

  test("retires unresolved delivery rows without altering completed audit records", async () => {
    const database = openDelegationTestDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const records = [
      createTerminalChild(repository, "child-retired-port-pending"),
      createTerminalChild(repository, "child-retired-port-claimed"),
      createTerminalChild(repository, "child-retired-port-delivered"),
    ];
    const delivery = new AgentDelegationCompletionDelivery({ database, repository, retryDelaysMs: [0] });
    const portId = "senera.session-wake";
    const timestamp = "2026-10-22T00:00:00.000Z";
    const insert = database.connection.prepare(
      `INSERT INTO child_run_completion_deliveries (
        id, child_run_id, child_request_id, port_id, delivery_status, attempt, available_at, claim_id, claim_until, created_at, updated_at, delivered_at
      ) VALUES (
        @id, @child_run_id, @child_request_id, @port_id, @delivery_status, 1, @available_at, @claim_id, @claim_until, @created_at, @updated_at, @delivered_at
      )`,
    );
    for (const [status, record] of [
      ["pending", records[0]],
      ["claimed", records[1]],
      ["delivered", records[2]],
    ] as const) {
      insert.run({
        id: `${record!.id}-${status}`,
        child_run_id: record!.id,
        child_request_id: record!.childRequestId,
        port_id: portId,
        delivery_status: status,
        available_at: timestamp,
        claim_id: status === "claimed" ? "claim" : null,
        claim_until: status === "claimed" ? timestamp : null,
        created_at: timestamp,
        updated_at: timestamp,
        delivered_at: status === "delivered" ? timestamp : null,
      });
    }

    expect(delivery.retirePort(portId, "The automatic parent wake route was retired.")).toBe(2);
    const rows = database.connection
      .prepare(
        "SELECT id, delivery_status, claim_id, claim_until, last_error FROM child_run_completion_deliveries WHERE port_id = ? ORDER BY id",
      )
      .all(portId) as Array<{
      id: string;
      delivery_status: string;
      claim_id: string | null;
      claim_until: string | null;
      last_error: string | null;
    }>;
    expect(rows).toEqual([
      expect.objectContaining({
        id: `${records[1]!.id}-claimed`,
        delivery_status: "dropped",
        claim_id: null,
        claim_until: null,
        last_error: "The automatic parent wake route was retired.",
      }),
      expect.objectContaining({
        id: `${records[2]!.id}-delivered`,
        delivery_status: "delivered",
      }),
      expect.objectContaining({
        id: `${records[0]!.id}-pending`,
        delivery_status: "dropped",
        claim_id: null,
        claim_until: null,
        last_error: "The automatic parent wake route was retired.",
      }),
    ]);
    await delivery.stop();
    database.close();
  });
});

function createTerminalChild(repository: AgentSqliteChildRunRepository, id: string): AgentChildRunRecord {
  repository.create({
    id,
    parentSessionId: "parent-session",
    parentRequestId: "parent-request",
    childSessionId: `${id}-session`,
    childRequestId: `${id}-request`,
    agentName: "worker",
    task: "Complete the background work.",
    contextMode: "fresh",
    approvalMode: "agent",
    modelProviderId: "main",
    modelSelectionSource: "parent",
    selectedSkills: [],
    configurationRevision: 1,
    executionContract: {
      version: 5,
      workspaceAccess: "read_only",
      promptLayer: { mode: "append", content: "" },
      modelCandidateProviderIds: ["main"],
      inheritProjectContext: true,
      deadline: {
        softTimeoutMs: 10_000,
        wrapUpTimeoutMs: 1_000,
        snapshotIntervalMs: 100,
        activityExtension: { recentActivityWindowMs: 1_000, stepMs: 1_000, maximumMs: 1_000 },
      },
    },
    launchContractDigest: "launch",
    launchContract: { executionMode: "detach" },
    allowedToolNames: [],
  });
  repository.markRunning(id);
  const completed = repository.markCompleted(id, { finalAnswer: "done" });
  if (!completed || completed.status !== AgentChildRunStatuses.Completed) {
    throw new Error(`Failed to create terminal child run: ${id}`);
  }
  return completed;
}
