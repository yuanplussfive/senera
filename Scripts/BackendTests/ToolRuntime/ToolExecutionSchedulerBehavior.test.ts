import { describe, expect, test, vi } from "vitest";
import { AgentToolExecutionScheduler } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExecutionScheduler.js";
import type { AgentToolResourceClaimProjectorPort } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceClaimProjector.js";
import type { AgentToolResourceLeaseRequest } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceClaimTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { ToolSchedulingMode } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";

describe("tool execution scheduler", () => {
  test("bounds default parallel calls independently for each run", async () => {
    const scheduler = createScheduler(2);
    const firstRun = {};
    const secondRun = {};
    const release = new Deferred<void>();
    const firstRunReady = new Deferred<void>();
    const secondRunReady = new Deferred<void>();
    let firstRunActive = 0;
    let secondRunActive = 0;

    const execute = async (run: object, owner: "first" | "second") =>
      scheduler.run(run, tool(), {}, async () => {
        if (owner === "first") {
          firstRunActive += 1;
          if (firstRunActive === 2) firstRunReady.resolve();
        } else {
          secondRunActive += 1;
          if (secondRunActive === 2) secondRunReady.resolve();
        }
        try {
          await release.promise;
        } finally {
          if (owner === "first") firstRunActive -= 1;
          else secondRunActive -= 1;
        }
      });

    const pending = [
      execute(firstRun, "first"),
      execute(firstRun, "first"),
      execute(firstRun, "first"),
      execute(secondRun, "second"),
      execute(secondRun, "second"),
      execute(secondRun, "second"),
    ];
    await Promise.all([firstRunReady.promise, secondRunReady.promise]);
    expect(firstRunActive).toBe(2);
    expect(secondRunActive).toBe(2);

    release.resolve();
    await Promise.all(pending);
  });

  test("applies a tool concurrency declaration across runs", async () => {
    const scheduler = createScheduler(10);
    const serialized = tool("Parallel", 1);
    const firstStarted = new Deferred<void>();
    const releaseFirst = new Deferred<void>();
    let secondStarted = false;
    const first = scheduler.run({}, serialized, {}, async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    });
    await firstStarted.promise;
    const second = scheduler.run({}, serialized, {}, async () => {
      secondStarted = true;
    });

    await Promise.resolve();
    expect(secondStarted).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
  });

  test("projects resource claims only for tools that explicitly request them", async () => {
    const project = vi.fn(
      async (_tool: RegisteredTool, args: Readonly<Record<string, unknown>>) =>
        args.lease as AgentToolResourceLeaseRequest,
    );
    const scheduler = new AgentToolExecutionScheduler({
      maxConcurrentCallsPerRun: 10,
      resourceClaims: { project },
    });
    const lease = resourceLease("workspace/a.ts");

    await scheduler.run({}, tool(), { lease }, async () => undefined);
    expect(project).not.toHaveBeenCalled();

    await scheduler.run({}, tool("ResourceClaims", undefined, true), { lease }, async () => undefined);
    expect(project).toHaveBeenCalledOnce();
  });
});

function createScheduler(maxConcurrentCallsPerRun: number): AgentToolExecutionScheduler {
  const resourceClaims: AgentToolResourceClaimProjectorPort = {
    project: async () => {
      throw new Error("Parallel tools must not project resource claims.");
    },
  };
  return new AgentToolExecutionScheduler({ maxConcurrentCallsPerRun, resourceClaims });
}

function tool(scheduling?: ToolSchedulingMode, maxConcurrency?: number, declaresResource = false): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "test-tools",
      rootPath: process.cwd(),
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: "TestTool",
    loading: "Dynamic",
    permissions: [],
    handler: {
      kind: "HostCapability",
      capability: "test.tool",
      resources: declaresResource
        ? [{ Capability: "test.resource", Pointer: "/resource", Parameters: { Intent: "read" } }]
        : [],
    },
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: 2,
      ResultAssessment: "ProcessExit",
      ...(scheduling ? { Scheduling: scheduling } : {}),
      ...(maxConcurrency === undefined ? {} : { MaxConcurrency: maxConcurrency }),
    },
    sources: [],
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

function resourceLease(identity: string): AgentToolResourceLeaseRequest {
  return {
    mode: "claims",
    claims: [
      {
        domain: { id: "test.resource", overlaps: (left, right) => left === right },
        identity,
        access: "shared",
      },
    ],
  };
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
