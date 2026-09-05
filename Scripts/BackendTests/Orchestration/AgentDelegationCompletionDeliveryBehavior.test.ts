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

  test("automatically wakes a delayed retry while the runtime stays alive", async () => {
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
