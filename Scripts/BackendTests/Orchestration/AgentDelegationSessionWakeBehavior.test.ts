import { describe, expect, test, vi } from "vitest";
import {
  createAgentDelegationSessionWakeHandler,
  isTerminalDetachedChildRun,
} from "../../../Source/AgentSystem/Orchestration/AgentDelegationSessionWake.js";
import {
  AgentChildRunJoinModes,
  AgentChildRunStatuses,
  isAgentChildRunBackgroundDeliverable,
  isAgentChildRunResultTerminal,
  isAgentChildRunSettled,
  type AgentChildRunRecord,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import type { AgentSessionBackgroundWakeRequest } from "../../../Source/AgentSystem/Session/AgentSessionBackgroundWake.js";

describe("delegated session wake", () => {
  test("classifies paused runs as settled without treating them as deliverable results", () => {
    expect(isAgentChildRunSettled(AgentChildRunStatuses.AwaitingSupervisor)).toBe(true);
    expect(isAgentChildRunResultTerminal(AgentChildRunStatuses.AwaitingSupervisor)).toBe(false);
    expect(isAgentChildRunSettled(AgentChildRunStatuses.Running)).toBe(false);
    expect(isAgentChildRunResultTerminal(AgentChildRunStatuses.Completed)).toBe(true);
    expect(isAgentChildRunResultTerminal(AgentChildRunStatuses.Cancelled)).toBe(true);
    expect(isAgentChildRunBackgroundDeliverable(AgentChildRunStatuses.Cancelled)).toBe(false);
    expect(isAgentChildRunBackgroundDeliverable(AgentChildRunStatuses.Failed)).toBe(true);
  });

  test("waits for every member of a parallel spawn group and delivers the batch once", async () => {
    const group = { id: "join:test", mode: AgentChildRunJoinModes.All, expectedCount: 2 } as const;
    let records = [
      createRecord("first", AgentChildRunStatuses.Completed, group),
      createRecord("second", AgentChildRunStatuses.Running, group),
    ];
    const accepted: Array<{ input: string; requestId: string }> = [];
    const wake = vi.fn(async (request: AgentSessionBackgroundWakeRequest) => {
      const payload = request.resolve();
      if (!payload) return "delivered" as const;
      accepted.push(payload);
      request.acknowledge(payload);
      return "accepted" as const;
    });
    const handler = createAgentDelegationSessionWakeHandler({
      childRuns: {
        get: (id) => records.find((record) => record.id === id),
        listForJoinGroup: () => records,
        markParentResultsDeliveredBatch: (ids) => {
          records = records.map((record) =>
            ids.includes(record.id) ? { ...record, parentResultDeliveredAt: "2026-09-11T00:00:01.000Z" } : record,
          );
          return ids.length;
        },
      },
      sessionManager: { wakeFromBackgroundTask: wake },
    });

    await handler(records[0]!);
    expect(wake).not.toHaveBeenCalled();

    records[1] = createRecord("second", AgentChildRunStatuses.Completed, group);
    await handler(records[1]!);
    await handler(records[0]!);

    expect(wake).toHaveBeenCalledOnce();
    expect(accepted[0]).toMatchObject({
      requestId: expect.stringMatching(/^background_join_join%3Atest_first%3A1%3Acompleted%7Csecond%3A1%3Acompleted$/),
    });
    expect(accepted[0]?.input).toContain('"tasks"');
    expect(records.every((record) => record.parentResultDeliveredAt !== undefined)).toBe(true);
    await handler(records[1]!);
    expect(wake).toHaveBeenCalledOnce();
  });

  test("keeps a single detached run on the per-run completion path", async () => {
    let record = createRecord("single", AgentChildRunStatuses.Completed);
    const wake = vi.fn(async (request: AgentSessionBackgroundWakeRequest) => {
      const payload = request.resolve();
      if (!payload) return "delivered" as const;
      request.acknowledge(payload);
      return "accepted" as const;
    });
    const handler = createAgentDelegationSessionWakeHandler({
      childRuns: {
        get: () => record,
        listForJoinGroup: () => [],
        markParentResultsDeliveredBatch: (ids) => {
          if (ids.includes(record.id)) record = { ...record, parentResultDeliveredAt: "2026-09-11T00:00:01.000Z" };
          return ids.length;
        },
      },
      sessionManager: { wakeFromBackgroundTask: wake },
    });

    await handler(record);

    expect(wake).toHaveBeenCalledOnce();
    expect(record.parentResultDeliveredAt).toBeDefined();
  });

  test("delivers only the remaining result from an any-mode join group", async () => {
    const group = { id: "join:any", mode: AgentChildRunJoinModes.Any, expectedCount: 2 } as const;
    let records = [
      {
        ...createRecord("already-received", AgentChildRunStatuses.Completed, group),
        finalAnswer: "already returned by AgentWait",
        parentResultDeliveredAt: "2026-09-11T00:00:01.000Z",
      },
      {
        ...createRecord("still-pending", AgentChildRunStatuses.Completed, group),
        finalAnswer: "deliver this result",
      },
    ];
    let deliveredIds: readonly string[] = [];
    const wake = vi.fn(async (request: AgentSessionBackgroundWakeRequest) => {
      const payload = request.resolve();
      if (!payload) return "delivered" as const;
      deliveredIds = payload.childRunIds;
      request.acknowledge(payload);
      return "accepted" as const;
    });
    const handler = createAgentDelegationSessionWakeHandler({
      childRuns: {
        get: (id) => records.find((record) => record.id === id),
        listForJoinGroup: () => records,
        markParentResultsDeliveredBatch: (ids) => {
          records = records.map((record) =>
            ids.includes(record.id) ? { ...record, parentResultDeliveredAt: "2026-09-11T00:00:02.000Z" } : record,
          );
          return ids.length;
        },
      },
      sessionManager: { wakeFromBackgroundTask: wake },
    });

    await handler(records[1]!);

    expect(wake).toHaveBeenCalledOnce();
    expect(deliveredIds).toEqual(["still-pending"]);
    expect(records.every((record) => record.parentResultDeliveredAt !== undefined)).toBe(true);
  });

  test("persists parent delivery and ignores replayed completion events", async () => {
    let current = createRecord("durable", AgentChildRunStatuses.Completed);
    const wake = vi.fn(async (request: AgentSessionBackgroundWakeRequest) => {
      const payload = request.resolve();
      if (!payload) return "delivered" as const;
      request.acknowledge(payload);
      return "accepted" as const;
    });
    const markParentResultsDeliveredBatch = vi.fn((ids: readonly string[]) => {
      if (ids.includes(current.id)) current = { ...current, parentResultDeliveredAt: "2026-09-11T00:00:01.000Z" };
      return ids.length;
    });
    const handler = createAgentDelegationSessionWakeHandler({
      childRuns: {
        get: (id) => (id === current.id ? current : undefined),
        listForJoinGroup: () => [],
        markParentResultsDeliveredBatch,
      },
      sessionManager: { wakeFromBackgroundTask: wake },
    });

    await Promise.all([handler(current), handler({ ...current, parentResultDeliveredAt: undefined })]);
    await handler({ ...current, parentResultDeliveredAt: undefined });

    expect(wake).toHaveBeenCalledOnce();
    expect(markParentResultsDeliveredBatch).toHaveBeenCalledOnce();
  });

  test("does not treat synchronous child executions as detached completions", () => {
    const record = createRecord("wait", AgentChildRunStatuses.Completed, undefined, "wait");
    expect(isTerminalDetachedChildRun(record.status, record)).toBe(false);
  });

  test("does not wake a parent for a cancelled detached run", async () => {
    const record = createRecord("cancelled", AgentChildRunStatuses.Cancelled);
    const wake = vi.fn(async () => "accepted" as const);
    const handler = createAgentDelegationSessionWakeHandler({
      childRuns: {
        get: () => record,
        listForJoinGroup: () => [],
        markParentResultsDeliveredBatch: vi.fn(),
      },
      sessionManager: { wakeFromBackgroundTask: wake },
    });

    await handler(record);

    expect(wake).not.toHaveBeenCalled();
  });
});

function createRecord(
  id: string,
  status: AgentChildRunRecord["status"],
  joinGroup?: AgentChildRunRecord["joinGroup"],
  executionMode: "detach" | "wait" = "detach",
): AgentChildRunRecord {
  return {
    id,
    ownerRunId: "owner",
    nodeId: id,
    ...(joinGroup ? { joinGroup } : {}),
    parentSessionId: "parent-session",
    parentRequestId: "parent-request",
    childSessionId: `${id}-session`,
    childRequestId: `${id}-request`,
    agentName: "worker",
    task: `Task ${id}`,
    contextMode: "fresh",
    approvalMode: "agent",
    modelProviderId: "main",
    selectedSkills: [],
    status,
    launchContractDigest: "digest",
    launchContract: { executionMode },
    allowedToolNames: [],
    executionContract: {
      version: 5,
      workspaceAccess: "read_only",
      promptLayer: { mode: "append", content: "" },
      modelCandidateProviderIds: ["main"],
      inheritProjectContext: true,
      deadline: {
        softTimeoutMs: 1_000,
        wrapUpTimeoutMs: 100,
        activityExtension: { recentActivityWindowMs: 100, stepMs: 100, maximumMs: 100 },
        snapshotIntervalMs: 100,
      },
    },
    messages: [],
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    revision: 1,
  };
}
