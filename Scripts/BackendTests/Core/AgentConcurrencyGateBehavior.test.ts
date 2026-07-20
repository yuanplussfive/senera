import { describe, expect, test } from "vitest";
import { AgentConcurrencyGate } from "../../../Source/AgentSystem/Core/AgentConcurrencyGate.js";
import { createDeferred } from "../Support/AsyncTestFixtures.js";

describe("AgentConcurrencyGate", () => {
  test("never starts more operations than the configured limit", async () => {
    const gate = new AgentConcurrencyGate(2);
    const release = createDeferred<void>();
    let active = 0;
    let peak = 0;
    const operations = Array.from({ length: 6 }, () =>
      gate.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await release.promise;
        active -= 1;
      }),
    );

    await Promise.resolve();
    expect(peak).toBe(2);
    release.resolve();
    await Promise.all(operations);
    expect(active).toBe(0);
  });

  test("releases a lease when an operation fails", async () => {
    const gate = new AgentConcurrencyGate(1);
    await expect(
      gate.run(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");

    await expect(gate.run(async () => "next")).resolves.toBe("next");
  });

  test("removes an aborted waiter without consuming capacity", async () => {
    const gate = new AgentConcurrencyGate(1);
    const release = createDeferred<void>();
    const running = gate.run(() => release.promise);
    const controller = new AbortController();
    const cancelled = gate.run(async () => "cancelled waiter ran", controller.signal);
    const next = gate.run(async () => "next");

    controller.abort("cancelled");
    await expect(cancelled).rejects.toThrow("cancelled");
    release.resolve();
    await running;
    await expect(next).resolves.toBe("next");
  });
});
