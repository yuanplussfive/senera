import { describe, expect, test } from "vitest";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { AgentToolResourceClaimProjectorPort } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceClaimProjector.js";
import {
  AgentToolResourceAccessModes,
  type AgentToolResourceClaimDomain,
  type AgentToolResourceLeaseRequest,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceClaimTypes.js";
import {
  AgentToolResourceLeaseCoordinator,
  AgentToolResourceScheduler,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceScheduler.js";

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

  test("coordinates claims shared by separate schedulers", async () => {
    const coordinator = new AgentToolResourceLeaseCoordinator();
    const firstScheduler = createScheduler(coordinator);
    const secondScheduler = createScheduler(coordinator);
    const firstStarted = new Deferred<void>();
    const releaseFirst = new Deferred<void>();
    let secondStarted = false;

    const first = firstScheduler.run(TestTool, { lease: claim("workspace/shared.ts", "exclusive") }, async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    });
    await firstStarted.promise;
    const second = secondScheduler.run(TestTool, { lease: claim("workspace/shared.ts", "shared") }, async () => {
      secondStarted = true;
    });

    await Promise.resolve();
    expect(secondStarted).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
  });

  test("allows a child session to re-enter its declared resource lease", async () => {
    const coordinator = new AgentToolResourceLeaseCoordinator();
    const scheduler = createScheduler(coordinator);
    const assignmentOwner = { type: "session", id: "child-session" };
    const toolOwner = { type: "tool_call", id: "call-1", parent: assignmentOwner };
    const assignment = await coordinator.acquire(claim("workspace/owned.ts", "exclusive"), undefined, assignmentOwner);
    let executed = false;

    await scheduler.run(
      TestTool,
      { lease: claim("workspace/owned.ts", "exclusive") },
      async () => {
        executed = true;
      },
      undefined,
      toolOwner,
    );

    expect(executed).toBe(true);
    assignment.release();
  });

  test("does not let a queued conflicting owner block re-entry", async () => {
    const coordinator = new AgentToolResourceLeaseCoordinator();
    const scheduler = createScheduler(coordinator);
    const assignmentOwner = { type: "session", id: "child-session" };
    const childToolOwner = { type: "tool_call", id: "child-call", parent: assignmentOwner };
    const otherOwner = { type: "session", id: "other-session" };
    const assignment = await coordinator.acquire(claim("workspace/owned.ts", "exclusive"), undefined, assignmentOwner);
    let otherStarted = false;
    const waiting = scheduler.run(
      TestTool,
      { lease: claim("workspace/owned.ts", "shared") },
      async () => {
        otherStarted = true;
      },
      undefined,
      otherOwner,
    );

    await Promise.resolve();
    expect(otherStarted).toBe(false);
    await scheduler.run(
      TestTool,
      { lease: claim("workspace/owned.ts", "exclusive") },
      async () => undefined,
      undefined,
      childToolOwner,
    );

    assignment.release();
    await waiting;
    expect(otherStarted).toBe(true);
  });

  test("keeps sibling tool calls mutually exclusive inside one assignment", async () => {
    const coordinator = new AgentToolResourceLeaseCoordinator();
    const scheduler = createScheduler(coordinator);
    const assignmentOwner = { type: "session", id: "child-session" };
    const firstOwner = { type: "tool_call", id: "child-call-1", parent: assignmentOwner };
    const secondOwner = { type: "tool_call", id: "child-call-2", parent: assignmentOwner };
    const assignment = await coordinator.acquire(claim("workspace/owned.ts", "exclusive"), undefined, assignmentOwner);
    const firstStarted = new Deferred<void>();
    const releaseFirst = new Deferred<void>();
    let secondStarted = false;
    const first = scheduler.run(
      TestTool,
      { lease: claim("workspace/owned.ts", "exclusive") },
      async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
      },
      undefined,
      firstOwner,
    );
    await firstStarted.promise;
    const second = scheduler.run(
      TestTool,
      { lease: claim("workspace/owned.ts", "exclusive") },
      async () => {
        secondStarted = true;
      },
      undefined,
      secondOwner,
    );

    await Promise.resolve();
    expect(secondStarted).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    assignment.release();
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

function createScheduler(coordinator = new AgentToolResourceLeaseCoordinator()): AgentToolResourceScheduler {
  const projector: AgentToolResourceClaimProjectorPort = {
    project: async (_tool, args) => args.lease as AgentToolResourceLeaseRequest,
  };
  return new AgentToolResourceScheduler(projector, coordinator);
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
