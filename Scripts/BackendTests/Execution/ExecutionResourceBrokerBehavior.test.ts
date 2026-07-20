import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  AgentExecutionResourceBroker,
  type AgentExecutionResourceBrokerOptions,
} from "../../../Source/AgentSystem/ExecutionResources/AgentExecutionResourceBroker.js";
import { AgentExecutionResourceErrorCodes } from "../../../Source/AgentSystem/ExecutionResources/AgentExecutionResourceError.js";
import { AgentExecutionResourceTransportCloseError } from "../../../Source/AgentSystem/ExecutionResources/AgentExecutionResourceTransport.js";
import type { AgentExecutionResourceLimits } from "../../../Source/AgentSystem/ExecutionResources/AgentExecutionResourceTypes.js";
import type { SeneraPersistentProcessChild } from "../../../Source/AgentSystem/Execution/SeneraPersistentProcessTypes.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { resolveAgentExecutionResourceWaitTimeoutMs } from "../../../Source/AgentSystem/ExecutionResources/AgentExecutionResourceConfig.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("execution resource broker", () => {
  it("derives wait defaults and upper bounds from the unified resource configuration", () => {
    const config = {
      ToolExecution: {
        Resources: {
          MaxWaitSeconds: 120,
        },
      },
    } as AgentSystemConfig;

    expect(resolveAgentExecutionResourceWaitTimeoutMs(config, undefined)).toBe(120_000);
    expect(resolveAgentExecutionResourceWaitTimeoutMs(config, 5_000)).toBe(5_000);
    expect(resolveAgentExecutionResourceWaitTimeoutMs(config, 180_000)).toBe(120_000);
  });

  it("routes live resource events through the broker event sink", async () => {
    const child = new FakePersistentChild();
    const eventSink = vi.fn();
    const requestSink = vi.fn();
    const owner = sessionOwner("session-event-bus");
    const broker = new AgentExecutionResourceBroker({
      workspaceRoot: process.cwd(),
      executionEnv: { spawnPersistentProcess: async () => child } as never,
      limits: resourceLimits(),
    });
    const request = startRequest(owner);
    await broker.startProcess({
      ...request,
      correlation: { ...request.correlation, onEvent: requestSink },
    });
    broker.setEventSink(eventSink);
    requestSink.mockClear();

    child.stdout.emit("data", Buffer.from("live"));
    await vi.waitFor(() =>
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({ kind: "execution.resource.output" })),
    );
    expect(requestSink).not.toHaveBeenCalled();
    await broker.close();
  });

  it("retains cursor-addressable output and enforces session ownership", async () => {
    const child = new FakePersistentChild();
    const broker = createBroker(async () => child);
    const owner = sessionOwner("session-a");
    const started = await broker.startProcess(startRequest(owner));

    child.stdout.emit("data", Buffer.from("hello"));
    const snapshot = broker.inspect(started.resourceId, owner, started.cursor);

    expect(snapshot.events).toEqual([
      expect.objectContaining({ kind: "output", stream: "stdout", text: "hello", cursor: started.cursor + 1 }),
    ]);
    expect(() => broker.inspect(started.resourceId, sessionOwner("session-b"))).toThrowError(
      expect.objectContaining({ code: AgentExecutionResourceErrorCodes.AccessDenied }),
    );
    await broker.close();
  });

  it("wakes waits on new output without polling", async () => {
    const child = new FakePersistentChild();
    const broker = createBroker(async () => child);
    const owner = sessionOwner("session-wait");
    const started = await broker.startProcess(startRequest(owner));

    const waiting = broker.wait(started.resourceId, owner, started.cursor, 5_000);
    child.stderr?.emit("data", Buffer.from("ready"));

    await expect(waiting).resolves.toEqual(
      expect.objectContaining({
        events: [expect.objectContaining({ kind: "output", stream: "stderr", text: "ready" })],
      }),
    );
    await broker.close();
  });

  it("waits for stdin drain before reporting a backpressured write", async () => {
    const child = new FakePersistentChild();
    child.stdinAcceptsWrite = false;
    const broker = createBroker(async () => child);
    const owner = sessionOwner("session-input");
    const started = await broker.startProcess(startRequest(owner));

    let settled = false;
    const writing = broker.write(started.resourceId, owner, Buffer.from("continue\n")).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(child.stdinChunks).toEqual(["continue\n"]);

    child.stdinEvents.emit("drain");
    await writing;
    expect(settled).toBe(true);
    await broker.close();
  });

  it("marks replay as truncated when bounded output evicts an older cursor", async () => {
    const child = new FakePersistentChild();
    const broker = createBroker(async () => child, { maxBufferedBytes: 4 });
    const owner = sessionOwner("session-buffer");
    const started = await broker.startProcess(startRequest(owner));

    child.stdout.emit("data", Buffer.from("abc"));
    child.stdout.emit("data", Buffer.from("def"));
    const snapshot = broker.inspect(started.resourceId, owner, started.cursor);

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.events).toEqual([expect.objectContaining({ kind: "output", text: "def" })]);
    expect(broker.inspect(started.resourceId, owner).truncated).toBe(true);
    await broker.close();
  });

  it("bounds a single oversized output event before retaining or publishing it", async () => {
    const child = new FakePersistentChild();
    const eventSink = vi.fn();
    const broker = createBroker(async () => child, { maxBufferedBytes: 4 }, eventSink);
    const owner = sessionOwner("session-single-event-bound");
    const started = await broker.startProcess(startRequest(owner));

    child.stdout.emit("data", Buffer.from("0123456789", "utf8"));

    const snapshot = broker.inspect(started.resourceId, owner, started.cursor);
    const output = snapshot.events.find((event) => event.kind === "output");
    expect(output).toEqual(expect.objectContaining({ truncated: true, byteLength: 10 }));
    expect(output?.kind === "output" ? Buffer.byteLength(output.text) : 0).toBeLessThanOrEqual(4);
    await vi.waitFor(() =>
      expect(eventSink).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "execution.resource.output",
          data: expect.objectContaining({ truncated: true, byteLength: 10 }),
        }),
      ),
    );
    await broker.close();
  });

  it("accounts for UTF-8 bytes split across process chunks", async () => {
    const child = new FakePersistentChild();
    const broker = createBroker(async () => child);
    const owner = sessionOwner("session-utf8");
    const started = await broker.startProcess(startRequest(owner));
    const encoded = Buffer.from("你", "utf8");

    child.stdout.emit("data", encoded.subarray(0, 2));
    child.stdout.emit("data", encoded.subarray(2));
    const snapshot = broker.inspect(started.resourceId, owner, started.cursor);

    expect(snapshot.events).toEqual([
      expect.objectContaining({ kind: "output", text: "你", totalBytes: encoded.byteLength }),
    ]);
    await broker.close();
  });

  it("reserves capacity while asynchronous process creation is pending", async () => {
    let releaseSpawn: ((child: SeneraPersistentProcessChild) => void) | undefined;
    const pendingChild = new Promise<SeneraPersistentProcessChild>((resolve) => {
      releaseSpawn = resolve;
    });
    const broker = createBroker(() => pendingChild, { maxActive: 1 });
    const owner = sessionOwner("session-capacity");
    const first = broker.startProcess(startRequest(owner));

    await expect(broker.startProcess(startRequest(owner))).rejects.toEqual(
      expect.objectContaining({ code: AgentExecutionResourceErrorCodes.CapacityExceeded }),
    );
    const child = new FakePersistentChild();
    releaseSpawn?.(child);
    await first;
    await broker.close();
  });

  it("terminates a process that finishes spawning after broker shutdown", async () => {
    let releaseSpawn: ((child: SeneraPersistentProcessChild) => void) | undefined;
    const pendingChild = new Promise<SeneraPersistentProcessChild>((resolve) => {
      releaseSpawn = resolve;
    });
    const broker = createBroker(() => pendingChild);
    const starting = broker.startProcess(startRequest(sessionOwner("session-closing")));

    const closing = broker.close();
    const child = new FakePersistentChild();
    releaseSpawn?.(child);

    await closing;
    await expect(starting).rejects.toEqual(expect.objectContaining({ code: AgentExecutionResourceErrorCodes.Closed }));
    expect(child.killedSignals).toEqual(["SIGTERM"]);
  });

  it("releases all resources owned by a closed session", async () => {
    const firstChild = new FakePersistentChild();
    const secondChild = new FakePersistentChild();
    const retainedChild = new FakePersistentChild();
    const children = [firstChild, secondChild, retainedChild];
    const broker = createBroker(async () => children.shift()!);
    const owner = sessionOwner("session-release");
    const otherOwner = sessionOwner("session-retained");
    const first = await broker.startProcess(startRequest(owner));
    await broker.startProcess(startRequest(owner));
    const retained = await broker.startProcess(startRequest(otherOwner));

    await broker.releaseAll(owner);

    expect(firstChild.killedSignals).toEqual(["SIGTERM"]);
    expect(secondChild.killedSignals).toEqual(["SIGTERM"]);
    expect(() => broker.inspect(first.resourceId, owner)).toThrowError(
      expect.objectContaining({ code: AgentExecutionResourceErrorCodes.NotFound }),
    );
    expect(broker.inspect(retained.resourceId, otherOwner).resourceId).toBe(retained.resourceId);
    await broker.close();
  });

  it("retains a resource and suppresses removed events when termination cannot be confirmed", async () => {
    const child = new FakePersistentChild();
    child.closeOnKill = false;
    const eventSink = vi.fn();
    const broker = createBroker(async () => child, { terminationGraceMs: 2 }, eventSink);
    const owner = sessionOwner("session-cleanup-failure");
    const started = await broker.startProcess(startRequest(owner));

    await expect(broker.releaseAll(owner)).rejects.toBeInstanceOf(AgentExecutionResourceTransportCloseError);

    expect(child.killedSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(broker.inspect(started.resourceId, owner).resourceId).toBe(started.resourceId);
    expect(eventSink).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "execution.resource.removed" }));

    child.emitClose(null, "SIGKILL");
    await expect(broker.releaseAll(owner)).resolves.toBeUndefined();
    expect(() => broker.inspect(started.resourceId, owner)).toThrowError(
      expect.objectContaining({ code: AgentExecutionResourceErrorCodes.NotFound }),
    );
    expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({ kind: "execution.resource.removed" }));
    await broker.close();
  });

  it("surfaces stop_all cleanup failures and exposes the retained handle as degraded", async () => {
    const child = new FakePersistentChild();
    child.closeOnKill = false;
    const cleanupFailures: unknown[] = [];
    const broker = new AgentExecutionResourceBroker({
      workspaceRoot: process.cwd(),
      executionEnv: { spawnPersistentProcess: async () => child } as never,
      limits: { ...resourceLimits(), terminationGraceMs: 2 },
      onCleanupFailure: (failure) => cleanupFailures.push(failure),
    });
    const owner = sessionOwner("session-stop-all-cleanup-failure");
    const started = await broker.startProcess(startRequest(owner));

    await expect(broker.stopAll(owner)).rejects.toBeInstanceOf(AgentExecutionResourceTransportCloseError);
    expect(broker.inspect(started.resourceId, owner).error).toContain("资源清理失败");
    expect(cleanupFailures).toHaveLength(1);
    child.emitClose(null, "SIGKILL");
    await broker.releaseAll(owner);
    await broker.close();
  });

  it("keeps an expired resource after cleanup failure and removes it only after a confirmed retry", async () => {
    vi.useFakeTimers();
    let now = 0;
    const child = new FakePersistentChild();
    child.closeOnKill = false;
    const eventSink = vi.fn();
    const owner = sessionOwner("session-expired-cleanup-retry");
    const broker = new AgentExecutionResourceBroker({
      workspaceRoot: process.cwd(),
      executionEnv: { spawnPersistentProcess: async () => child } as never,
      eventSink,
      now: () => now,
      limits: {
        ...resourceLimits(),
        idleTtlMs: 5,
        terminalTtlMs: 5,
        sweepIntervalMs: 10,
        terminationGraceMs: 2,
      },
    });

    try {
      const started = await broker.startProcess(startRequest(owner));
      now = 20;
      await vi.advanceTimersByTimeAsync(15);

      expect(broker.inspect(started.resourceId, owner).resourceId).toBe(started.resourceId);
      expect(eventSink).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "execution.resource.removed" }));

      child.closeOnKill = true;
      now = 40;
      await vi.advanceTimersByTimeAsync(15);

      expect(() => broker.inspect(started.resourceId, owner)).toThrowError(
        expect.objectContaining({ code: AgentExecutionResourceErrorCodes.NotFound }),
      );
      expect(eventSink).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "execution.resource.removed",
          data: expect.objectContaining({ reason: "expired" }),
        }),
      );
      await broker.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a pending start during broker shutdown", async () => {
    let releaseSpawn!: (child: SeneraPersistentProcessChild) => void;
    const pendingChild = new Promise<SeneraPersistentProcessChild>((resolve) => {
      releaseSpawn = resolve;
    });
    const broker = createBroker(() => pendingChild);
    const starting = broker.startProcess(startRequest(sessionOwner("session-close-waits-start")));
    const closing = broker.close();

    let shutdownSettled = false;
    void closing.finally(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    const child = new FakePersistentChild();
    releaseSpawn(child);
    await expect(starting).rejects.toEqual(expect.objectContaining({ code: AgentExecutionResourceErrorCodes.Closed }));
    await closing;
    expect(child.killedSignals).toEqual(["SIGTERM"]);
  });

  it("replays an already-exited child close event when binding the resource", async () => {
    const child = new FakePersistentChild();
    child.emitClose(0, null);
    const broker = createBroker(async () => child);
    const owner = sessionOwner("session-exited-before-bind");

    const started = await broker.startProcess(startRequest(owner));
    expect(started.state).toBe("completed");
    await broker.releaseAll(owner);
    expect(() => broker.inspect(started.resourceId, owner)).toThrowError(
      expect.objectContaining({ code: AgentExecutionResourceErrorCodes.NotFound }),
    );
    await broker.close();
  });

  it("keeps process state authoritative when live event projection fails", async () => {
    const child = new FakePersistentChild();
    const broker = createBroker(async () => child);
    const owner = sessionOwner("session-events");
    const started = await broker.startProcess({
      ...startRequest(owner),
      correlation: {
        sessionId: owner.sessionId,
        requestId: "request-events",
        step: 1,
        toolCallId: "call-events",
        toolName: "ShellStartTool",
        onEvent: vi.fn(async () => {
          throw new Error("socket closed");
        }),
      },
    });

    child.stdout.emit("data", Buffer.from("still retained"));
    child.emit("close", 0, null);
    const snapshot = broker.inspect(started.resourceId, owner);

    expect(snapshot.state).toBe("completed");
    expect(snapshot.events).toContainEqual(expect.objectContaining({ kind: "output", text: "still retained" }));
    await broker.close();
  });

  it("runs a real cross-platform process through start, wait, write, and terminal replay", async () => {
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot: process.cwd() });
    const broker = new AgentExecutionResourceBroker({
      workspaceRoot: process.cwd(),
      limits: {
        maxActive: 1,
        maxBufferedBytes: 4_096,
        maxInputBytes: 1_024,
        maxWaitMs: 5_000,
        idleTtlMs: 60_000,
        terminalTtlMs: 60_000,
        sweepIntervalMs: 60_000,
        terminationGraceMs: 100,
      },
    });
    const owner = sessionOwner("session-real-process");
    try {
      const started = await broker.startProcess({
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('ready\\n');process.stdin.once('data',d=>process.stdout.write('echo:'+d.toString().trim()+'\\n',()=>process.exit(0)))",
        ],
        cwd: process.cwd(),
        executionEnv,
        owner,
        correlation: {
          sessionId: owner.sessionId,
          requestId: owner.requestId,
          step: 1,
          toolCallId: "call-real",
          toolName: "ShellStartTool",
        },
      });
      const ready = await broker.wait(started.resourceId, owner, started.cursor, 5_000);
      expect(outputText(ready)).toContain("ready");

      await broker.write(started.resourceId, owner, Buffer.from("continue\n"));
      const completed = await waitUntilTerminal(broker, started.resourceId, owner, ready.cursor);
      expect(outputText(completed)).toContain("echo:continue");
      expect(completed.state).toBe("completed");
      expect(completed.exitCode).toBe(0);
    } finally {
      await broker.close();
    }
  }, 10_000);
});

class FakePersistentChild extends EventEmitter implements SeneraPersistentProcessChild {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdinEvents = new EventEmitter();
  readonly stdinChunks: string[] = [];
  readonly killedSignals: NodeJS.Signals[] = [];
  stdinAcceptsWrite = true;
  closeOnKill = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdin = {
    write: (chunk: string | Buffer): boolean => {
      this.stdinChunks.push(chunk.toString());
      return this.stdinAcceptsWrite;
    },
    once: (event: "drain", listener: () => void): void => {
      this.stdinEvents.once(event, listener);
    },
    end: (): void => undefined,
  };

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedSignals.push(signal);
    if (this.closeOnKill) queueMicrotask(() => this.emitClose(null, signal));
    return true;
  }

  emitClose(exitCode: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = exitCode;
    this.signalCode = signal;
    this.emit("close", exitCode, signal);
  }
}

function createBroker(
  spawnPersistentProcess: (...args: never[]) => Promise<SeneraPersistentProcessChild>,
  overrides: Partial<AgentExecutionResourceLimits> = {},
  eventSink?: AgentExecutionResourceBrokerOptions["eventSink"],
) {
  return new AgentExecutionResourceBroker({
    workspaceRoot: process.cwd(),
    executionEnv: { spawnPersistentProcess } as never,
    eventSink,
    limits: {
      maxActive: 4,
      maxBufferedBytes: 1_024,
      maxInputBytes: 1_024,
      maxWaitMs: 10_000,
      idleTtlMs: 60_000,
      terminalTtlMs: 60_000,
      sweepIntervalMs: 60_000,
      terminationGraceMs: 10,
      ...overrides,
    },
  });
}

function resourceLimits(): AgentExecutionResourceLimits {
  return {
    maxActive: 4,
    maxBufferedBytes: 1_024,
    maxInputBytes: 1_024,
    maxWaitMs: 10_000,
    idleTtlMs: 60_000,
    terminalTtlMs: 60_000,
    sweepIntervalMs: 60_000,
    terminationGraceMs: 10,
  };
}

function sessionOwner(sessionId: string) {
  return {
    workspaceRoot: process.cwd(),
    sessionId,
    requestId: `request-${sessionId}`,
  };
}

function startRequest(owner: ReturnType<typeof sessionOwner>) {
  return {
    command: "shell",
    args: ["run"],
    cwd: process.cwd(),
    owner,
    correlation: {
      sessionId: owner.sessionId,
      requestId: owner.requestId,
      step: 1,
      toolCallId: "call-start",
      toolName: "ShellStartTool",
    },
  };
}

async function waitUntilTerminal(
  broker: AgentExecutionResourceBroker,
  resourceId: string,
  owner: ReturnType<typeof sessionOwner>,
  cursor: number,
) {
  let snapshot = await broker.wait(resourceId, owner, cursor, 5_000);
  const events = [...snapshot.events];
  while (!["completed", "failed", "cancelled"].includes(snapshot.state)) {
    snapshot = await broker.wait(resourceId, owner, snapshot.cursor, 5_000);
    events.push(...snapshot.events);
  }
  return { ...snapshot, events };
}

function outputText(snapshot: { events: Array<{ kind: string; text?: string }> }): string {
  return snapshot.events.map((event) => (event.kind === "output" ? event.text : "")).join("");
}
