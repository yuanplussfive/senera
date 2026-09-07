import { describe, expect, test, vi } from "vitest";
import {
  createAgentDelegationSessionWakeHandler,
  isTerminalDetachedChildRun,
} from "../../../Source/AgentSystem/Orchestration/AgentDelegationSessionWake.js";
import {
  AgentChildRunJoinModes,
  AgentChildRunStatuses,
  type AgentChildRunRecord,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";

describe("delegated session wake", () => {
  test("waits for every member of a parallel spawn group and emits one parent wake", async () => {
    const group = { id: "join:test", mode: AgentChildRunJoinModes.All, expectedCount: 2 } as const;
    const first = createRecord("first", AgentChildRunStatuses.Completed, group);
    const second = createRecord("second", AgentChildRunStatuses.Running, group);
    const records = [first, second];
    const wake = vi.fn(async (..._args: unknown[]) => "accepted" as const);
    const handler = createAgentDelegationSessionWakeHandler({
      childRuns: { listForJoinGroup: () => records },
      sessionManager: { wakeFromBackgroundTask: wake },
    });

    await handler(first);
    expect(wake).not.toHaveBeenCalled();

    records[1] = createRecord("second", AgentChildRunStatuses.Completed, group);
    await handler(records[1]);
    await handler(first);

    expect(wake).toHaveBeenCalledOnce();
    const request = wake.mock.calls[0]?.[0] as { input: string; requestId: string } | undefined;
    expect(request).toMatchObject({
      sessionId: "parent-session",
      metadata: { backgroundTask: { taskId: "join:test", runId: "join:test" } },
    });
    expect(request?.requestId).toMatch(/^background_join_join%3Atest_first%3A1%3Acompleted%7Csecond%3A1%3Acompleted$/);
    expect(request?.input).toContain('"tasks"');

    records[1] = { ...records[1]!, revision: 2 };
    await handler(records[1]);
    expect(wake).toHaveBeenCalledTimes(2);
  });

  test("keeps a single detached run on the per-run completion path", async () => {
    const record = createRecord("single", AgentChildRunStatuses.Completed);
    const wake = vi.fn(async (..._args: unknown[]) => "accepted" as const);
    const handler = createAgentDelegationSessionWakeHandler({
      childRuns: { listForJoinGroup: () => [] },
      sessionManager: { wakeFromBackgroundTask: wake },
    });

    await handler(record);

    expect(wake).toHaveBeenCalledOnce();
    const request = wake.mock.calls[0]?.[0] as { requestId: string } | undefined;
    expect(request?.requestId).toBe("background_single_1");
  });

  test("does not treat synchronous child executions as detached completions", () => {
    const record = createRecord("wait", AgentChildRunStatuses.Completed, undefined, "wait");
    expect(isTerminalDetachedChildRun(record.status, record)).toBe(false);
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
