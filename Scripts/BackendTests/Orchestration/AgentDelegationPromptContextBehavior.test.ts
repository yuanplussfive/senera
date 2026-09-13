import { describe, expect, test } from "vitest";
import {
  AgentChildRunStatuses,
  type AgentChildRunRecord,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import { projectAgentDelegationPromptContext } from "../../../Source/AgentSystem/Orchestration/AgentDelegationPromptContext.js";

describe("delegation prompt context", () => {
  test("projects ownership and consumption state without terminal result payloads", () => {
    const active = createRecord("active", AgentChildRunStatuses.Running, {
      task: "A".repeat(4_000),
      snapshot: {
        version: 1,
        capturedAt: "2026-09-11T00:00:00.000Z",
        lastActivityAt: "2026-09-11T00:00:00.000Z",
        modelOutputCharacters: 10,
        assistantTurns: 1,
        toolCalls: { planned: 1, started: 1, completed: 0, failed: 0 },
        activeTools: ["WorkspaceRead"],
        artifactUris: ["senera://artifact/a"],
        deadline: { softDeadlineAt: "2026-09-11T00:01:00.000Z", grantedExtensionMs: 0 },
      },
    });
    const completed = createRecord("completed", AgentChildRunStatuses.Completed, {
      finalAnswer: "A result that belongs in the durable child record, not the supervisor prompt.",
      resultConsumedAt: undefined,
      parentWakeConsumed: false,
    });
    const consumed = createRecord("consumed", AgentChildRunStatuses.Completed, {
      finalAnswer: "already consumed",
      resultConsumedAt: "2026-09-11T00:00:02.000Z",
      parentWakeConsumed: true,
    });

    const projected = projectAgentDelegationPromptContext([active, completed, consumed]);

    expect(projected.counts).toEqual({
      total: 3,
      active: 1,
      awaitingSupervisor: 0,
      terminal: 2,
      pendingResults: 1,
      pendingWakes: 1,
    });
    expect(projected.runs.map((run) => run.runId)).toEqual(["active", "completed"]);
    expect(projected.runs[0]).toMatchObject({
      runId: "active",
      status: AgentChildRunStatuses.Running,
      resultAvailable: false,
      resultConsumed: false,
      parentWakePending: false,
      task: expect.stringContaining("[truncated originalChars=4000"),
      progress: expect.objectContaining({ artifactCount: 1, activeTools: ["WorkspaceRead"] }),
    });
    expect(projected.runs[1]).toMatchObject({
      runId: "completed",
      resultAvailable: true,
      resultConsumed: false,
      parentWakePending: true,
    });
    expect(JSON.stringify(projected)).not.toContain("A result that belongs");
    expect(JSON.stringify(projected)).not.toContain("already consumed");
  });
});

function createRecord(
  id: string,
  status: AgentChildRunRecord["status"],
  overrides: Partial<AgentChildRunRecord> = {},
): AgentChildRunRecord {
  return {
    id,
    ownerRunId: "owner",
    nodeId: id,
    workItemId: `work:${id}`,
    taskDigest: "a".repeat(64),
    parentSessionId: "parent",
    parentRequestId: "request",
    childSessionId: `${id}-session`,
    childRequestId: `${id}-request`,
    agentName: "worker",
    task: `Task ${id}`,
    contextMode: "fresh",
    approvalMode: "agent",
    selectedSkills: [],
    status,
    launchContractDigest: "launch",
    launchContract: { executionMode: "detach" },
    allowedToolNames: [],
    executionContract: {
      version: 5,
      workspaceAccess: "read_only",
      promptLayer: { mode: "append", content: "" },
      modelCandidateProviderIds: [],
      inheritProjectContext: true,
      deadline: {
        softTimeoutMs: 1_000,
        wrapUpTimeoutMs: 100,
        activityExtension: { recentActivityWindowMs: 100, stepMs: 100, maximumMs: 100 },
        snapshotIntervalMs: 100,
      },
    },
    messages: [],
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    revision: 1,
    parentWakeConsumed: false,
    ...overrides,
  };
}
