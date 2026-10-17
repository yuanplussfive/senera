import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createAgentStreamIdleWatchdog,
  resolveAgentStreamIdleTimeoutMs,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentModelRequestTimeout.js";
import { ModelRequestTimeoutError } from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpErrors.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("agent model request timeout policy", () => {
  test.each([
    [480_000, 240_000, 240_000],
    [120_000, 20_000, 100_000],
    [50_000, 20_000, 60_000],
    [-1, 240_000, 60_000],
    [90_000, -1, 90_000],
  ])("derives stream idle timeout from existing budgets: %j", (maxRequestMs, firstTokenTimeoutMs, expected) => {
    expect(resolveAgentStreamIdleTimeoutMs(maxRequestMs, firstTokenTimeoutMs)).toBe(expected);
  });

  test("arms only when the stream produces activity and aborts at the derived deadline", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const watchdog = createAgentStreamIdleWatchdog(controller, 10_000, 1_000);

    expect(controller.signal.aborted).toBe(false);
    watchdog.reset();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(controller.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(controller.signal.reason).toBeInstanceOf(ModelRequestTimeoutError);
    expect((controller.signal.reason as ModelRequestTimeoutError).kind).toBe("stream_idle");
    watchdog.clear();
  });

  test("resets the idle deadline without changing the configured policy", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const watchdog = createAgentStreamIdleWatchdog(controller, 120_000, 20_000);

    watchdog.reset();
    await vi.advanceTimersByTimeAsync(99_999);
    watchdog.reset();
    await vi.advanceTimersByTimeAsync(99_999);
    expect(controller.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((controller.signal.reason as ModelRequestTimeoutError).kind).toBe("stream_idle");
    watchdog.clear();
  });
});
