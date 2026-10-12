import { describe, expect, test } from "vitest";
import { AgentContinuityLifecycleCoordinator } from "../../../Source/AgentSystem/Continuity/AgentContinuityLifecycle.js";

describe("continuity lifecycle", () => {
  test("flushes semantic learning before the compaction boundary completes", async () => {
    const calls: string[] = [];
    const lifecycle = new AgentContinuityLifecycleCoordinator({
      memory: {
        flushSemanticLearning: async () => {
          calls.push("flush");
        },
        close: async () => {
          calls.push("close");
        },
      },
      promptContext: {},
    });

    await lifecycle.beforeCompaction("session-1");

    expect(calls).toEqual(["flush"]);
  });

  test("closes once and rejects a later compaction boundary", async () => {
    let closeCount = 0;
    const lifecycle = new AgentContinuityLifecycleCoordinator({
      memory: {
        flushSemanticLearning: async () => undefined,
        close: async () => {
          closeCount += 1;
        },
      },
      promptContext: {},
    });

    await Promise.all([lifecycle.close(), lifecycle.close()]);

    expect(closeCount).toBe(1);
    await expect(lifecycle.beforeCompaction("session-1")).rejects.toThrow("already closed");
  });

  test("does not prefetch after close begins while a compaction boundary is flushing", async () => {
    const calls: string[] = [];
    let releaseFlush!: () => void;
    let signalFlushStarted!: () => void;
    const flushStarted = new Promise<void>((resolve) => {
      signalFlushStarted = resolve;
    });
    const flushReleased = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const lifecycle = new AgentContinuityLifecycleCoordinator({
      memory: {
        flushSemanticLearning: async () => {
          calls.push("flush");
          signalFlushStarted();
          await flushReleased;
        },
        close: async () => {
          calls.push("close");
        },
      },
      promptContext: {},
    });

    const compaction = lifecycle.beforeCompaction("session-1");
    await flushStarted;
    const close = lifecycle.close();
    releaseFlush();

    await expect(compaction).rejects.toThrow("already closed");
    await close;

    expect(calls).toEqual(["flush", "flush", "close"]);
  });
});
