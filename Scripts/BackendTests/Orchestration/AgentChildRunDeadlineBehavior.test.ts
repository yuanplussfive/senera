import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentChildRunActivityTracker } from "../../../Source/AgentSystem/Orchestration/AgentChildRunActivityTracker.js";
import {
  AgentChildRunDeadlineController,
  AgentChildRunDeadlineOutcomes,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunDeadlineController.js";
import { renderAgentChildRunWrapUpInstruction } from "../../../Source/AgentSystem/Orchestration/AgentChildRunWrapUpPrompt.js";
import type { AgentChildRunDeadlinePolicy } from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";

const StartedAt = Date.parse("2026-08-08T00:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("child-run activity-aware deadlines", () => {
  test("extends while runtime activity is recent, then enters a bounded wrap-up window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(StartedAt);
    const activity = tracker();
    const extended = vi.fn();
    const wrappingUp = vi.fn();
    const timedOut = vi.fn();
    const controller = new AgentChildRunDeadlineController({
      startedAt: StartedAt,
      policy: deadlinePolicy(),
      activity,
      onExtended: extended,
      onWrapUp: wrappingUp,
      onTimedOut: timedOut,
    });

    const outcome = controller.start();
    await vi.advanceTimersByTimeAsync(90);
    activity.observe(modelDelta("Still working"));
    await vi.advanceTimersByTimeAsync(10);
    expect(extended).toHaveBeenLastCalledWith({
      extensionMs: 20,
      grantedExtensionMs: 20,
      softDeadlineAt: new Date(StartedAt + 120).toISOString(),
    });

    await vi.advanceTimersByTimeAsync(10);
    activity.observe(modelDelta(" with live output"));
    await vi.advanceTimersByTimeAsync(10);
    expect(extended).toHaveBeenCalledTimes(2);
    expect(extended).toHaveBeenLastCalledWith({
      extensionMs: 20,
      grantedExtensionMs: 40,
      softDeadlineAt: new Date(StartedAt + 140).toISOString(),
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(wrappingUp).toHaveBeenCalledWith({ hardDeadlineAt: new Date(StartedAt + 180).toISOString() });
    expect(activity.snapshot().deadline).toEqual({
      softDeadlineAt: new Date(StartedAt + 140).toISOString(),
      grantedExtensionMs: 40,
      hardDeadlineAt: new Date(StartedAt + 180).toISOString(),
    });

    await vi.advanceTimersByTimeAsync(40);
    await expect(outcome).resolves.toBe(AgentChildRunDeadlineOutcomes.TimedOut);
    expect(timedOut).toHaveBeenCalledOnce();
  });

  test("does not extend for a progress heartbeat without new evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(StartedAt);
    const activity = tracker();
    const extended = vi.fn();
    const wrappingUp = vi.fn();
    const controller = new AgentChildRunDeadlineController({
      startedAt: StartedAt,
      policy: deadlinePolicy(),
      activity,
      onExtended: extended,
      onWrapUp: wrappingUp,
      onTimedOut: vi.fn(),
    });

    const outcome = controller.start();
    await vi.advanceTimersByTimeAsync(90);
    activity.observe({
      kind: AgentEventKinds.ToolCallProgress,
      context: { requestId: "child-request", step: 1 },
      data: {
        toolName: "WorkspaceRead",
        callId: "call-1",
        progressSequence: 1,
        message: "Inspecting files",
      },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(extended).not.toHaveBeenCalled();
    expect(wrappingUp).toHaveBeenCalledWith({ hardDeadlineAt: new Date(StartedAt + 140).toISOString() });
    controller.stop();
    await expect(outcome).resolves.toBe(AgentChildRunDeadlineOutcomes.Stopped);
  });

  test("promotes completed model output to a complete persisted checkpoint", () => {
    let now = StartedAt;
    const activity = new AgentChildRunActivityTracker({
      startedAt: StartedAt,
      policy: deadlinePolicy(),
      clock: {
        now: () => now,
        timestamp: (value) => new Date(value).toISOString(),
      },
    });

    activity.observe({
      kind: AgentEventKinds.ModelStarted,
      context: { requestId: "child-request", step: 1 },
      data: { model: "test-model" },
    });
    now += 5;
    activity.observe(modelDelta("Collected evidence."));
    expect(activity.latestCheckpoint()).toMatchObject({ content: "Collected evidence.", complete: false });

    now += 5;
    activity.observe({
      kind: AgentEventKinds.ModelCompleted,
      context: { requestId: "child-request", step: 1 },
      data: { text: "Collected evidence." },
    });

    expect(activity.latestCheckpoint()).toMatchObject({
      source: "model_stream",
      content: "Collected evidence.",
      complete: true,
    });
    expect(activity.snapshot()).toMatchObject({
      modelOutputCharacters: 19,
      lastModelOutputAt: new Date(StartedAt + 5).toISOString(),
    });
  });

  test("tracks model budgets and treats a model Todo write as meaningful progress", () => {
    let now = StartedAt;
    const activity = new AgentChildRunActivityTracker({
      startedAt: StartedAt,
      policy: deadlinePolicy(),
      control: {
        todo: { required: true, minimumItems: 1 },
        budget: { maxModelTurns: 3, maxToolCalls: 8, noProgressTurns: 2, noProgressTimeoutMs: 1_000 },
      },
      clock: {
        now: () => now,
        timestamp: (value) => new Date(value).toISOString(),
      },
    });

    activity.observe({
      kind: AgentEventKinds.ModelStarted,
      context: { requestId: "child-request", step: 1 },
      data: { model: "test-model" },
    });
    activity.observe({
      kind: AgentEventKinds.ModelCompleted,
      context: { requestId: "child-request", step: 1 },
      data: { text: "" },
    });
    expect(activity.shouldRequestWrapUp()).toBe(false);

    now += 5;
    activity.observe({
      kind: AgentEventKinds.ModelStarted,
      context: { requestId: "child-request", step: 2 },
      data: { model: "test-model" },
    });
    activity.observe({
      kind: AgentEventKinds.TodoListWritten,
      context: { sessionId: "child-session", requestId: "child-request" },
      data: {
        source: "model",
        snapshot: {
          items: [],
          counts: { total: 1, pending: 0, inProgress: 0, completed: 1, cancelled: 0 },
        },
      },
    });
    activity.observe({
      kind: AgentEventKinds.ModelCompleted,
      context: { requestId: "child-request", step: 2 },
      data: { text: "" },
    });

    expect(activity.todoPlanObserved()).toBe(true);
    expect(activity.shouldRequestWrapUp()).toBe(false);
    expect(activity.snapshot()).toMatchObject({
      control: {
        todo: { planObserved: true },
        budget: { modelTurns: 2, noProgressTurns: 0 },
      },
    });
  });

  test("restores persisted control counters and deadline extensions", () => {
    const activity = new AgentChildRunActivityTracker({
      startedAt: StartedAt,
      policy: deadlinePolicy(),
      control: {
        todo: { required: true, minimumItems: 1 },
        budget: { maxModelTurns: 3, maxToolCalls: 8, noProgressTurns: 2, noProgressTimeoutMs: 1_000 },
      },
      initialSnapshot: {
        version: 1,
        capturedAt: new Date(StartedAt + 80).toISOString(),
        lastActivityAt: new Date(StartedAt + 75).toISOString(),
        lastModelOutputAt: new Date(StartedAt + 70).toISOString(),
        modelOutputCharacters: 12,
        assistantTurns: 2,
        toolCalls: { planned: 4, started: 3, completed: 2, failed: 1 },
        activeTools: [],
        artifactUris: ["senera://artifact/one"],
        control: {
          todo: {
            planObserved: true,
            counts: { total: 2, pending: 1, inProgress: 0, completed: 1, cancelled: 0 },
          },
          budget: {
            modelTurns: 2,
            toolCalls: 3,
            noProgressTurns: 1,
            lastMeaningfulProgressAt: new Date(StartedAt + 70).toISOString(),
          },
        },
        deadline: {
          softDeadlineAt: new Date(StartedAt + 120).toISOString(),
          grantedExtensionMs: 20,
        },
      },
      clock: {
        now: () => StartedAt + 80,
        timestamp: (value) => new Date(value).toISOString(),
      },
    });

    expect(activity.snapshot()).toMatchObject({
      modelOutputCharacters: 12,
      assistantTurns: 2,
      toolCalls: { planned: 4, started: 3, completed: 2, failed: 1 },
      artifactUris: ["senera://artifact/one"],
      control: {
        todo: { planObserved: true, counts: { total: 2, pending: 1 } },
        budget: { modelTurns: 2, toolCalls: 3, noProgressTurns: 1 },
      },
      deadline: { softDeadlineAt: new Date(StartedAt + 120).toISOString(), grantedExtensionMs: 20 },
    });
    expect(activity.deadlineState()).toEqual({ softDeadlineAt: StartedAt + 120, grantedExtensionMs: 20 });
  });

  test("includes the wrap-up reason and remaining plan items in the final instruction", () => {
    const instruction = renderAgentChildRunWrapUpInstruction({
      reason: "no_progress",
      remainingTodo: [{ id: "verify", content: "Verify the change", status: "in_progress" }],
    });

    expect(instruction).toContain("no_progress");
    expect(instruction).toContain('"id":"verify"');
    expect(instruction).toContain('"status":"in_progress"');
  });
});

function tracker(): AgentChildRunActivityTracker {
  return new AgentChildRunActivityTracker({ startedAt: StartedAt, policy: deadlinePolicy() });
}

function modelDelta(text: string) {
  return {
    kind: AgentEventKinds.ModelDelta,
    context: { requestId: "child-request", step: 1 },
    data: { text },
  } as const;
}

function deadlinePolicy(): AgentChildRunDeadlinePolicy {
  return {
    softTimeoutMs: 100,
    wrapUpTimeoutMs: 40,
    snapshotIntervalMs: 10,
    activityExtension: {
      recentActivityWindowMs: 30,
      stepMs: 20,
      maximumMs: 40,
    },
  };
}
