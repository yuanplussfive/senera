import { describe, expect, test, vi } from "vitest";
import { AgentKeyedLeaseQueue } from "../../../Source/AgentSystem/Core/AgentKeyedLeaseQueue.js";

describe("keyed lease queue", () => {
  test("serializes one key while allowing another key to proceed", async () => {
    const queue = new AgentKeyedLeaseQueue<string>();
    const releaseA = await queue.acquire("a");
    const acquiredA = vi.fn();
    const acquiredB = vi.fn();
    const pendingA = queue.acquire("a").then((release) => {
      acquiredA();
      release();
    });
    const pendingB = queue.acquire("b").then((release) => {
      acquiredB();
      release();
    });

    await pendingB;
    expect(acquiredB).toHaveBeenCalledOnce();
    expect(acquiredA).not.toHaveBeenCalled();

    releaseA();
    await pendingA;
    expect(acquiredA).toHaveBeenCalledOnce();
  });

  test("removes a cancelled waiter without blocking its successor", async () => {
    const queue = new AgentKeyedLeaseQueue<string>();
    const releaseActive = await queue.acquire("session");
    const controller = new AbortController();
    const cancelledOperation = vi.fn(async () => undefined);
    const successorOperation = vi.fn(async () => "successor");

    const cancelled = queue.run("session", cancelledOperation, controller.signal);
    const successor = queue.run("session", successorOperation);
    controller.abort("superseded");

    await expect(cancelled).rejects.toMatchObject({ name: "AgentCancellationError", message: "superseded" });
    expect(cancelledOperation).not.toHaveBeenCalled();
    expect(successorOperation).not.toHaveBeenCalled();

    releaseActive();
    await expect(successor).resolves.toBe("successor");
    expect(successorOperation).toHaveBeenCalledOnce();
  });

  test("reports cancellation that arrives during an operation after releasing the queue", async () => {
    const queue = new AgentKeyedLeaseQueue<string>();
    const controller = new AbortController();
    let markStarted!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const operationGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const active = queue.run(
      "session",
      async () => {
        markStarted();
        await operationGate;
        return "late-result";
      },
      controller.signal,
    );

    await started;
    controller.abort(new Error("cancel active operation"));
    finish();
    await expect(active).rejects.toMatchObject({
      name: "AgentCancellationError",
      message: "cancel active operation",
    });
    await expect(queue.run("session", async () => "next")).resolves.toBe("next");
  });

  test("release is idempotent", async () => {
    const queue = new AgentKeyedLeaseQueue<string>();
    const release = await queue.acquire("session");
    release();
    release();
    await expect(queue.run("session", async () => "available")).resolves.toBe("available");
  });
});
