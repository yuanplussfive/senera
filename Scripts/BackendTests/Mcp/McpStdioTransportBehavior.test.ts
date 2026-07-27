import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import {
  AgentMcpStdioConnectionClosedError,
  AgentMcpStdioStartupError,
  AgentMcpStdioTransport,
  AgentMcpStdioTransportCloseError,
} from "../../../Source/AgentSystem/Mcp/AgentMcpStdioTransport.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawner,
} from "../../../Source/AgentSystem/Execution/SeneraPersistentProcessTypes.js";
import { createSeneraLocalPersistentProcessSpawner } from "../../../Source/AgentSystem/Execution/SeneraPersistentProcessSpawner.js";
import { terminateSeneraProcessTree } from "../../../Source/AgentSystem/Execution/SeneraProcessTreeTermination.js";

const FixtureReadyMethod = "senera/fixture-ready";
const ProcessExitPollIntervalMs = 25;
const ProcessExitTimeoutMs = 3_000;
const RealProcessTerminationGraceMs = 1_000;
const HoldProcessOpenSource = "setInterval(() => undefined, 1_000);";
const McpProcessTreeFixtureSource = `
const { spawn } = require("node:child_process");
const method = process.argv[1];
const holdSource = process.argv[2];
const descendant = spawn(process.execPath, ["--input-type=commonjs", "--eval", holdSource], {
  stdio: "ignore",
  windowsHide: true,
});
process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method, params: { descendantPid: descendant.pid } }) + "\\n");
setInterval(() => undefined, 1_000);
`;

describe("MCP stdio transport", () => {
  test("closes gracefully without sending process signals", async () => {
    const child = new FakePersistentProcessChild({ closeOnEnd: true });
    const transport = createTransport(child, 5);

    await transport.start();
    await transport.close();

    expect(child.signals).toEqual([]);
  });

  test("uses the configured grace before escalating to terminate", async () => {
    const expectedSignal = process.platform === "win32" ? "SIGKILL" : "SIGTERM";
    const child = new FakePersistentProcessChild({ closeOnSignal: expectedSignal });
    const transport = createTransport(child, 5);

    await transport.start();
    await transport.close();

    expect(child.treeSignals).toEqual([expectedSignal]);
  });

  test("reports a non-cooperative process after escalating to force kill", async () => {
    const child = new FakePersistentProcessChild();
    const transport = createTransport(child, 5);

    await transport.start();
    await expect(transport.close()).rejects.toBeInstanceOf(AgentMcpStdioTransportCloseError);

    expect(child.treeSignals).toEqual(process.platform === "win32" ? ["SIGKILL"] : ["SIGTERM", "SIGKILL"]);
  });

  test("terminates a real MCP process and its descendant", async () => {
    const transport = new AgentMcpStdioTransport({
      command: process.execPath,
      args: ["--input-type=commonjs", "--eval", McpProcessTreeFixtureSource, FixtureReadyMethod, HoldProcessOpenSource],
      cwd: process.cwd(),
      spawnPersistentProcess: createSeneraLocalPersistentProcessSpawner(),
      terminationGraceMs: RealProcessTerminationGraceMs,
    });
    let descendantPid: number | undefined;
    let rootPid: number | undefined;
    transport.onmessage = (message) => {
      if (!("method" in message) || message.method !== FixtureReadyMethod || !("params" in message)) return;
      const params = message.params;
      if (isRecord(params) && typeof params.descendantPid === "number") descendantPid = params.descendantPid;
    };

    try {
      await transport.start();
      rootPid = transport.pid ?? undefined;
      await vi.waitFor(() => expect(descendantPid).toEqual(expect.any(Number)), {
        timeout: ProcessExitTimeoutMs,
      });

      await transport.close();

      await waitForProcessExit(rootPid!, ProcessExitTimeoutMs);
      await waitForProcessExit(descendantPid!, ProcessExitTimeoutMs);
    } finally {
      await transport.close().catch(() => undefined);
      await forceTerminateFixtureProcess(rootPid);
      await forceTerminateFixtureProcess(descendantPid);
    }
  }, 10_000);

  test("rejects startup when the server exits immediately and preserves bounded stderr diagnostics", async () => {
    const child = new FakePersistentProcessChild();
    const transport = createTransport(child, 5);

    const starting = transport.start();
    await waitForListenerBinding(child, "close");
    child.emitStderr("fatal: configuration is invalid\n");
    child.emitClose(23);

    await expect(starting).rejects.toMatchObject({
      name: "AgentMcpStdioStartupError",
      exitCode: 23,
      signal: null,
      stderr: "fatal: configuration is invalid\n",
    } satisfies Partial<AgentMcpStdioStartupError>);
  });

  test("reports bounded exit diagnostics when a connected server closes unexpectedly", async () => {
    const child = new FakePersistentProcessChild();
    const transport = createTransport(child, 5);
    const errors: Error[] = [];
    transport.onerror = (error) => errors.push(error);

    await transport.start();
    child.emitStderr("fatal: runtime configuration is invalid\n");
    child.emitClose(23);

    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBeInstanceOf(AgentMcpStdioConnectionClosedError);
    expect(errors[0]).toMatchObject({
      command: "mcp-server",
      exitCode: 23,
      signal: null,
      stderr: "fatal: runtime configuration is invalid\n",
    } satisfies Partial<AgentMcpStdioConnectionClosedError>);
  });

  test("reclaims a child whose spawn completes after close begins", async () => {
    const child = new FakePersistentProcessChild({ closeOnEnd: true });
    let resolveSpawn!: (child: SeneraPersistentProcessChild) => void;
    const spawn = new Promise<SeneraPersistentProcessChild>((resolve) => {
      resolveSpawn = resolve;
    });
    const transport = new AgentMcpStdioTransport({
      command: "mcp-server",
      cwd: "C:/workspace",
      spawnPersistentProcess: () => spawn,
      terminationGraceMs: 5,
    });

    const starting = transport.start();
    const closing = transport.close();
    resolveSpawn(child);

    await expect(starting).rejects.toBeInstanceOf(AgentMcpStdioStartupError);
    await expect(closing).resolves.toBeUndefined();
    expect(child.stdinEnded).toBe(true);
  });

  test("rejects a backpressured send when stdin errors", async () => {
    const child = new FakePersistentProcessChild({ closeOnEnd: true });
    child.stdinAcceptsWrite = false;
    const transport = createTransport(child, 5);
    await transport.start();

    const sending = transport.send({ jsonrpc: "2.0", method: "ping" });
    child.emitStdinError(new Error("broken pipe"));

    await expect(sending).rejects.toThrow("broken pipe");
    await transport.close();
  });

  test("rejects an oversized protocol frame and bounds runtime stderr", async () => {
    const child = new FakePersistentProcessChild({ closeOnEnd: true });
    const transport = createTransport(child, 5, { maxFrameBytes: 8, maxStderrBytes: 4 });
    const errors: Error[] = [];
    const stderr: Buffer[] = [];
    transport.onerror = (error) => errors.push(error);
    transport.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    await transport.start();

    child.emitStderr("abcdef");
    child.emitStdout('{"jsonrpc":"2.0"}\n');

    await vi.waitFor(() => expect(errors.some((error) => error.message.includes("frame exceeded"))).toBe(true));
    expect(Buffer.concat(stderr).toString("utf8")).toBe("abcd");
    await transport.close();
  });

  test.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])("rejects invalid termination grace %s", (value) => {
    expect(() => createTransport(new FakePersistentProcessChild(), value)).toThrow(RangeError);
  });
});

function createTransport(
  child: FakePersistentProcessChild,
  terminationGraceMs: number,
  limits: { maxFrameBytes?: number; maxStderrBytes?: number } = {},
): AgentMcpStdioTransport {
  const spawn = vi.fn<SeneraPersistentProcessSpawner>(async () => child);
  return new AgentMcpStdioTransport({
    command: "mcp-server",
    cwd: "C:/workspace",
    spawnPersistentProcess: spawn,
    terminationGraceMs,
    ...limits,
  });
}

async function waitForListenerBinding(child: EventEmitter, event: string): Promise<void> {
  for (let attempt = 0; attempt < 8 && child.listenerCount(event) === 0; attempt += 1) {
    await Promise.resolve();
  }
  expect(child.listenerCount(event)).toBeGreaterThan(0);
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, ProcessExitPollIntervalMs));
  }
  expect(isProcessRunning(pid)).toBe(false);
}

async function forceTerminateFixtureProcess(pid: number | undefined): Promise<void> {
  if (pid === undefined || !isProcessRunning(pid)) return;
  await terminateSeneraProcessTree(pid, "SIGKILL").catch(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process exited between the liveness check and the cleanup signal.
    }
  });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class FakePersistentProcessChild extends EventEmitter implements SeneraPersistentProcessChild {
  readonly signals: NodeJS.Signals[] = [];
  readonly treeSignals: NodeJS.Signals[] = [];
  readonly stdout = new EventEmitter() as SeneraPersistentProcessChild["stdout"];
  readonly stderr = new EventEmitter() as NonNullable<SeneraPersistentProcessChild["stderr"]>;
  readonly stdin: SeneraPersistentProcessChild["stdin"];
  stdinEnded = false;
  stdinAcceptsWrite = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly pid = 999_999;

  constructor(
    private readonly behavior: {
      closeOnEnd?: boolean;
      closeOnSignal?: NodeJS.Signals;
    } = {},
  ) {
    super();
    const stdinEvents = new EventEmitter();
    this.stdin = {
      write: () => this.stdinAcceptsWrite,
      once: (event, listener) => {
        stdinEvents.once(event, listener);
      },
      on: (event, listener) => {
        stdinEvents.on(event, listener);
      },
      off: (event, listener) => {
        stdinEvents.off(event, listener);
      },
      end: () => {
        this.stdinEnded = true;
        if (this.behavior.closeOnEnd) this.emitClose();
      },
    };
    this.emitStdinError = (error: Error): void => {
      stdinEvents.emit("error", error);
    };
  }

  override on(event: "error", listener: (error: Error) => void): this;
  override on(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): this;
  override on(event: string, listener: Parameters<EventEmitter["on"]>[1]): this {
    return super.on(event, listener);
  }

  override once(event: "close", listener: () => void): this;
  override once(event: string, listener: Parameters<EventEmitter["once"]>[1]): this {
    return super.once(event, listener);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    if (this.behavior.closeOnSignal === signal) this.emitClose(null, signal);
    return true;
  }

  async terminateTree(signal: NodeJS.Signals): Promise<void> {
    this.treeSignals.push(signal);
    if (this.behavior.closeOnSignal === signal) this.emitClose(null, signal);
  }

  emitStderr(value: string): void {
    (this.stderr as EventEmitter).emit("data", Buffer.from(value));
  }

  emitStdout(value: string): void {
    (this.stdout as EventEmitter).emit("data", Buffer.from(value));
  }

  emitStdinError: (error: Error) => void = () => undefined;

  emitClose(exitCode: number | null = 0, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = exitCode;
    this.signalCode = signal;
    this.emit("close", exitCode, signal);
  }
}
