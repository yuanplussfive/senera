import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentChildRunActivityTracker } from "../../../Source/AgentSystem/Orchestration/AgentChildRunActivityTracker.js";
import {
  AgentChildRunDeadlineController,
  AgentChildRunDeadlineOutcomes,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunDeadlineController.js";
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

  test("extends for recent tool activity without model prose", async () => {
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

    expect(extended).toHaveBeenCalledOnce();
    expect(wrappingUp).not.toHaveBeenCalled();
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
