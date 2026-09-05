import { describe, expect, test, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { AgentGoalMicroLoopDispatchActionPort } from "../../../Source/AgentSystem/Agenda/AgentGoalMicroLoopDispatchActionPort.js";
import { AgentGoalMicroLoopDecisionKinds } from "../../../Source/AgentSystem/Agenda/AgentGoalMicroLoopRuntime.js";
import type { AgentGoalMicroLoopActionInput } from "../../../Source/AgentSystem/Agenda/AgentGoalMicroLoopRuntime.js";

const candidate = {
  goalId: "goal-1",
  summary: "完成验证",
  status: "active" as const,
  priority: 50,
  progress: 0.5,
  successCriteria: ["有完整证据"],
  ownerSessionId: "session-1",
  trigger: "review" as const,
  triggerKey: "goal-1:review:1",
  sourceRefs: ["senera://agenda/goal-1"],
  dueAt: null,
  nextReviewAt: null,
};

function input(kind: (typeof AgentGoalMicroLoopDecisionKinds)[keyof typeof AgentGoalMicroLoopDecisionKinds]) {
  return {
    worldId: "world-1",
    now: Temporal.Instant.from("2026-09-01T00:00:00Z"),
    snapshot: {} as never,
    candidate,
    decision: { kind, goalId: candidate.goalId, triggerKey: candidate.triggerKey, reason: "继续推进" },
  } as AgentGoalMicroLoopActionInput;
}

describe("Goal micro-loop dispatch action port", () => {
  test("blocks a goal without an owner session", async () => {
    const dispatch = { dispatch: vi.fn() };
    const port = new AgentGoalMicroLoopDispatchActionPort({
      dispatch: dispatch as never,
      allowedToolNames: [],
      reviewDelayMs: 60_000,
    });

    const result = await port.act({
      ...input(AgentGoalMicroLoopDecisionKinds.Execute),
      candidate: { ...candidate, ownerSessionId: null },
    });

    expect(result).toMatchObject({ outcome: "blocked" });
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  test("only maps a terminal child run to verified completion", async () => {
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        sessionId: "session-1",
        requestId: "request-1",
        finalAnswer: "partial",
        completion: "partial",
      })
      .mockResolvedValueOnce({
        sessionId: "session-1",
        requestId: "request-2",
        finalAnswer: "done",
        completion: "complete",
        evidenceRefs: ["senera://evidence/verified"],
      });
    const port = new AgentGoalMicroLoopDispatchActionPort({
      dispatch: { dispatch } as never,
      allowedToolNames: ["read"],
      reviewDelayMs: 60_000,
    });

    await expect(port.act(input(AgentGoalMicroLoopDecisionKinds.Complete))).resolves.toMatchObject({
      outcome: "blocked",
    });
    await expect(port.act(input(AgentGoalMicroLoopDecisionKinds.Complete))).resolves.toMatchObject({
      outcome: "verified",
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  test("queues a step behind an active owner run", async () => {
    const followUp = vi.fn().mockResolvedValue(true);
    const dispatch = vi.fn();
    const port = new AgentGoalMicroLoopDispatchActionPort({
      dispatch: { dispatch, followUp } as never,
      allowedToolNames: ["read"],
      reviewDelayMs: 60_000,
    });

    await expect(port.act(input(AgentGoalMicroLoopDecisionKinds.Execute))).resolves.toMatchObject({
      outcome: "waiting",
      nextReviewAt: "2026-09-01T00:01:00.000Z",
    });
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("queues an interactive proposal behind an active owner run", async () => {
    const followUp = vi.fn().mockResolvedValue(true);
    const dispatch = vi.fn();
    const port = new AgentGoalMicroLoopDispatchActionPort({
      dispatch: { dispatch, followUp } as never,
      allowedToolNames: ["read"],
      reviewDelayMs: 60_000,
    });

    await expect(port.act(input(AgentGoalMicroLoopDecisionKinds.AskUser))).resolves.toMatchObject({
      outcome: "waiting",
      nextReviewAt: null,
    });
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
