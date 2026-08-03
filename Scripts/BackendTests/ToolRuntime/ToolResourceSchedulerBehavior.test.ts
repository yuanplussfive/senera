import { describe, expect, test } from "vitest";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { AgentToolResourceClaimProjectorPort } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceClaimProjector.js";
import {
  AgentToolResourceAccessModes,
  type AgentToolResourceClaimDomain,
  type AgentToolResourceLeaseRequest,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceClaimTypes.js";
import { AgentToolResourceScheduler } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceScheduler.js";

describe("tool resource scheduler", () => {
  test("runs overlapping shared claims concurrently", async () => {
    const scheduler = createScheduler();
    const overlap = new Deferred<void>();
    let active = 0;
    let maximumActive = 0;
    const operation = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (active === 2) overlap.resolve();
      await overlap.promise;
      active -= 1;
    };

    await Promise.all([
      scheduler.run(TestTool, { lease: claim("workspace/source", "shared") }, operation),
      scheduler.run(TestTool, { lease: claim("workspace/source/file.ts", "shared") }, operation),
    ]);

    expect(maximumActive).toBe(2);
  });

  test("serializes a writer against an overlapping reader", async () => {
    const scheduler = createScheduler();
    const firstStarted = new Deferred<void>();
    const releaseFirst = new Deferred<void>();
    const order: string[] = [];
    const reader = scheduler.run(TestTool, { lease: claim("workspace/source", "shared") }, async () => {
      order.push("read:start");
      firstStarted.resolve();
      await releaseFirst.promise;
      order.push("read:end");
    });
    await firstStarted.promise;
    const writer = scheduler.run(TestTool, { lease: claim("workspace/source/file.ts", "exclusive") }, async () => {
      order.push("write:start");
      order.push("write:end");
    });

    await Promise.resolve();
    expect(order).toEqual(["read:start"]);
    releaseFirst.resolve();
    await Promise.all([reader, writer]);
    expect(order).toEqual(["read:start", "read:end", "write:start", "write:end"]);
  });

  test("runs writers for disjoint resources concurrently", async () => {
    const scheduler = createScheduler();
    const overlap = new Deferred<void>();
    let active = 0;
    let maximumActive = 0;
    const operation = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (active === 2) overlap.resolve();
      await overlap.promise;
      active -= 1;
    };

    await Promise.all([
      scheduler.run(TestTool, { lease: claim("workspace/a.ts", "exclusive") }, operation),
      scheduler.run(TestTool, { lease: claim("workspace/b.ts", "exclusive") }, operation),
    ]);

    expect(maximumActive).toBe(2);
  });

  test("removes a cancelled waiter without retaining its lease", async () => {
    const scheduler = createScheduler();
    const firstStarted = new Deferred<void>();
    const releaseFirst = new Deferred<void>();
    const first = scheduler.run(TestTool, { lease: claim("workspace/a.ts", "exclusive") }, async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    });
    await firstStarted.promise;

    const controller = new AbortController();
    const cancelled = scheduler.run(
      TestTool,
      { lease: claim("workspace/a.ts", "exclusive") },
      async () => undefined,
      controller.signal,
    );
    controller.abort(new Error("cancel test"));
    await expect(cancelled).rejects.toBeInstanceOf(AgentCancellationError);

    releaseFirst.resolve();
    await first;
    await expect(
      scheduler.run(TestTool, { lease: claim("workspace/a.ts", "exclusive") }, async () => "released"),
    ).resolves.toBe("released");
  });

  test("does not let later readers bypass an earlier conflicting writer", async () => {
    const scheduler = createScheduler();
    const firstStarted = new Deferred<void>();
    const releaseFirst = new Deferred<void>();
    const writerStarted = new Deferred<void>();
    const releaseWriter = new Deferred<void>();
    const order: string[] = [];
    const firstReader = scheduler.run(TestTool, { lease: claim("workspace/a.ts", "shared") }, async () => {
      order.push("reader-1:start");
      firstStarted.resolve();
      await releaseFirst.promise;
      order.push("reader-1:end");
    });
    await firstStarted.promise;
    const writer = scheduler.run(TestTool, { lease: claim("workspace/a.ts", "exclusive") }, async () => {
      order.push("writer:start");
      writerStarted.resolve();
      await releaseWriter.promise;
      order.push("writer:end");
    });
    const laterReader = scheduler.run(TestTool, { lease: claim("workspace/a.ts", "shared") }, async () => {
      order.push("reader-2:start");
      order.push("reader-2:end");
    });

    await Promise.resolve();
    expect(order).toEqual(["reader-1:start"]);
    releaseFirst.resolve();
    await writerStarted.promise;
    expect(order).toEqual(["reader-1:start", "reader-1:end", "writer:start"]);
    releaseWriter.resolve();
    await Promise.all([firstReader, writer, laterReader]);
    expect(order).toEqual([
      "reader-1:start",
      "reader-1:end",
      "writer:start",
      "writer:end",
      "reader-2:start",
      "reader-2:end",
    ]);
  });

  test("treats an unclassified request as globally exclusive", async () => {
    const scheduler = createScheduler();
    const firstStarted = new Deferred<void>();
    const releaseFirst = new Deferred<void>();
    let secondStarted = false;
    const first = scheduler.run(TestTool, { lease: { mode: "exclusive" } }, async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    });
    await firstStarted.promise;
    const second = scheduler.run(TestTool, { lease: claim("workspace/b.ts", "shared") }, async () => {
      secondStarted = true;
    });

    await Promise.resolve();
    expect(secondStarted).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
  });
});

const HierarchicalDomain: AgentToolResourceClaimDomain = {
  id: "test.hierarchical",
  overlaps: (left, right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`),
};

const TestTool = {} as RegisteredTool;

function claim(identity: string, access: "shared" | "exclusive"): AgentToolResourceLeaseRequest {
  return {
    mode: "claims",
    claims: [
      {
        domain: HierarchicalDomain,
        identity,
        access: access === "shared" ? AgentToolResourceAccessModes.Shared : AgentToolResourceAccessModes.Exclusive,
      },
    ],
  };
}

function createScheduler(): AgentToolResourceScheduler {
  const projector: AgentToolResourceClaimProjectorPort = {
    project: async (_tool, args) => args.lease as AgentToolResourceLeaseRequest,
  };
  return new AgentToolResourceScheduler(projector);
}

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}
