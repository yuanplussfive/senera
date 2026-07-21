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

describe("MCP stdio transport", () => {
  test("closes gracefully without sending process signals", async () => {
    const child = new FakePersistentProcessChild({ closeOnEnd: true });
    const transport = createTransport(child, 5);

    await transport.start();
    await transport.close();

    expect(child.signals).toEqual([]);
  });

  test("uses the configured grace before escalating to terminate", async () => {
    const child = new FakePersistentProcessChild({ closeOnSignal: "SIGTERM" });
    const transport = createTransport(child, 5);

    await transport.start();
    await transport.close();

    expect(child.signals).toEqual(["SIGTERM"]);
  });

  test("reports a non-cooperative process after escalating to force kill", async () => {
    const child = new FakePersistentProcessChild();
    const transport = createTransport(child, 5);

    await transport.start();
    await expect(transport.close()).rejects.toBeInstanceOf(AgentMcpStdioTransportCloseError);

    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

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

class FakePersistentProcessChild extends EventEmitter implements SeneraPersistentProcessChild {
  readonly signals: NodeJS.Signals[] = [];
  readonly stdout = new EventEmitter() as SeneraPersistentProcessChild["stdout"];
  readonly stderr = new EventEmitter() as NonNullable<SeneraPersistentProcessChild["stderr"]>;
  readonly stdin: SeneraPersistentProcessChild["stdin"];
  stdinEnded = false;
  stdinAcceptsWrite = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

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
