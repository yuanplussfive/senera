import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleIdleTask } from "../../../Frontend/src/shared/scheduling/scheduleIdleTask.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scheduleIdleTask", () => {
  it("uses the browser idle queue and cancels the registered callback", () => {
    const task = vi.fn();
    const requestIdleCallback = vi.fn(() => 41);
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);

    const cancel = scheduleIdleTask(task);

    expect(requestIdleCallback).toHaveBeenCalledWith(task, { timeout: 2_000 });
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(41);
  });

  it("uses priority policies when the idle callback API is unavailable", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const backgroundTask = vi.fn();
    const visibleTask = vi.fn();

    scheduleIdleTask(backgroundTask);
    scheduleIdleTask(visibleTask, { priority: "user-visible" });

    vi.advanceTimersByTime(0);
    expect(visibleTask).toHaveBeenCalledTimes(1);
    expect(backgroundTask).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(backgroundTask).toHaveBeenCalledTimes(1);
  });

  it("cancels the timer fallback before it runs", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const task = vi.fn();

    const cancel = scheduleIdleTask(task);
    cancel();
    vi.runAllTimers();

    expect(task).not.toHaveBeenCalled();
  });
});
