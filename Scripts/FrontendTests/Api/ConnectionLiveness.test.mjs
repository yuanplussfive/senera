import { afterEach, expect, test, vi } from "vitest";
import { ConnectionLiveness } from "../../../Frontend/src/api/connectionLiveness.ts";

afterEach(() => vi.useRealTimers());

test("control sockets probe on foreground resume without polling a quiet background-independent transport", async () => {
  vi.useFakeTimers();
  const probe = vi.fn(async () => {});
  const liveness = new ConnectionLiveness(probe, vi.fn(), false);
  liveness.start();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(probe).not.toHaveBeenCalled();
  liveness.resume();
  await Promise.resolve();
  expect(probe).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  liveness.stop();
});

test("background suspension cannot disconnect, and foreground resumes probe without a document reload", async () => {
  vi.useFakeTimers();
  const probe = vi.fn(async () => {});
  const disconnect = vi.fn();
  const liveness = new ConnectionLiveness(probe, disconnect);
  liveness.start();
  liveness.receive(15_000);
  liveness.suspend();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(probe).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
  liveness.resume();
  await Promise.resolve();
  expect(probe).toHaveBeenCalledWith(30_000);
  expect(disconnect).not.toHaveBeenCalled();
  liveness.stop();
  expect(vi.getTimerCount()).toBe(0);
});

test("a missed heartbeat probes first and an unresponsive foreground connection disconnects once", async () => {
  vi.useFakeTimers();
  const probe = vi.fn(async () => {
    throw new Error("no response");
  });
  const disconnect = vi.fn();
  const liveness = new ConnectionLiveness(probe, disconnect);
  liveness.start();
  liveness.receive(2_000);
  await vi.advanceTimersByTimeAsync(6_999);
  expect(probe).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test("late failures from an old connection or background probe cannot close the current connection", async () => {
  vi.useFakeTimers();
  let rejectProbe;
  const probe = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        rejectProbe = reject;
      }),
  );
  const disconnect = vi.fn();
  const liveness = new ConnectionLiveness(probe, disconnect);
  liveness.start();
  liveness.resume();
  liveness.resume();
  expect(probe).toHaveBeenCalledTimes(1);
  liveness.suspend();
  rejectProbe(new Error("suspended"));
  await Promise.resolve();
  expect(disconnect).not.toHaveBeenCalled();
  liveness.start();
  liveness.resume();
  liveness.receive();
  rejectProbe(new Error("old failure"));
  await Promise.resolve();
  expect(disconnect).not.toHaveBeenCalled();
  liveness.stop();
  expect(vi.getTimerCount()).toBe(0);
});
