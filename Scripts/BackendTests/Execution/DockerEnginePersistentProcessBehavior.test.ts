import { describe, expect, test, vi } from "vitest";
import { SeneraDockerEngineBackend } from "../../../Source/AgentSystem/Execution/SeneraDockerEngineBackend.js";
import type {
  SeneraSandboxProcessEvent,
  SeneraSandboxProcessHandle,
  SeneraSandboxWorkerClient,
} from "../../../Source/AgentSystem/Execution/SeneraSandboxWorkerTypes.js";
import type { AgentSandboxExecutionRequest } from "../../../Source/AgentSystem/Sandbox/Worker/AgentSandboxWorkerProtocol.js";
import type { SeneraOutputSpool } from "../../../Source/AgentSystem/Execution/SeneraOutputSpool.js";

describe("Docker Engine persistent process adapter", () => {
  test("projects the shell invocation and separates output before closing exactly once", async () => {
    const handle = new FakeSandboxProcessHandle();
    const worker = workerFor(handle);
    const backend = backendFor(worker);
    const child = await backend.spawnPersistentProcess("host-shell", [], {
      ...spawnOptions(),
      shellCommand: { mode: "shell", dialect: "posix-sh", script: "printf ready" },
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const closes: Array<{ code: number | null; signal: NodeJS.Signals | null }> = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
    child.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
    child.on("close", (code, signal) => closes.push({ code, signal }));

    handle.push({ kind: "output", stream: "stdout", data: Buffer.from("ready") });
    handle.push({ kind: "output", stream: "stderr", data: Buffer.from("warn") });
    handle.exit(0, null);
    await vi.waitFor(() => expect(closes).toEqual([{ code: 0, signal: null }]));

    expect(worker.start).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/bin/sh",
        arguments: ["-lc", "printf ready"],
        cwd: "/workspace",
        interactive: false,
        workspaceMount: "writable",
        network: "disabled",
      }),
    );
    expect(stdout).toEqual(["ready"]);
    expect(stderr).toEqual(["warn"]);
    expect(child.exitCode).toBe(0);
    expect(child.signalCode).toBeNull();
  });

  test("serializes stdin, publishes drain, and closes input after queued writes", async () => {
    const handle = new FakeSandboxProcessHandle();
    const child = await backendFor(workerFor(handle)).spawnPersistentProcess("node", ["server.js"], spawnOptions());
    const drained = new Promise<void>((resolve) => child.stdin.once("drain", resolve));

    expect(child.stdin.write("hello")).toBe(false);
    await drained;
    child.stdin.end();
    await vi.waitFor(() => expect(handle.endInput).toHaveBeenCalledOnce());

    expect(handle.write).toHaveBeenCalledWith(Buffer.from("hello"));
    expect(handle.invocations).toEqual(["write:hello", "end"]);
    handle.exit(0, null);
  });

  test("maps Node process-tree signals to the Worker protocol", async () => {
    const handle = new FakeSandboxProcessHandle();
    const child = await backendFor(workerFor(handle)).spawnPersistentProcess("node", ["server.js"], spawnOptions());

    await child.terminateTree("SIGINT");
    await child.terminateTree("SIGTERM");
    await child.terminateTree("SIGKILL");

    expect(handle.terminate.mock.calls).toEqual([["interrupt"], ["terminate"], ["kill"]]);
    handle.exit(null, "SIGKILL");
  });

  test("rejects an incompatible shell dialect before starting a Worker process", async () => {
    const handle = new FakeSandboxProcessHandle();
    const worker = workerFor(handle);
    const backend = backendFor(worker);

    await expect(
      backend.spawnPersistentProcess("host-shell", [], {
        ...spawnOptions(),
        shellCommand: { mode: "shell", dialect: "powershell", script: "Write-Output wrong-boundary" },
      }),
    ).rejects.toMatchObject({
      code: "spawn_failed",
      details: {
        reason: "shell_dialect_unsupported",
        requestedDialect: "powershell",
        availableDialect: "posix-sh",
      },
    });
    expect(worker.start).not.toHaveBeenCalled();
  });

  test("reports a worker stream that ends without an exit event", async () => {
    const handle = new FakeSandboxProcessHandle();
    const child = await backendFor(workerFor(handle)).spawnPersistentProcess("node", ["server.js"], spawnOptions());
    const errors: Error[] = [];
    child.on("error", (error) => errors.push(error));

    handle.end();

    await vi.waitFor(() =>
      expect(errors).toEqual([expect.objectContaining({ message: expect.stringContaining("exit event") })]),
    );
  });

  test("force-terminates one-shot execution when output capture fails", async () => {
    const handle = new FakeSandboxProcessHandle();
    const worker = workerFor(handle);
    const outputSpool = failingOutputSpool();
    const execution = backendFor(worker).executeProcess({
      command: "/usr/local/bin/node",
      args: ["--version"],
      cwd: process.cwd(),
      timeoutMs: 30_000,
      limits: { timeoutMs: 30_000, maxStdoutBytes: 1_024, maxStderrBytes: 1_024 },
      outputSpool,
      profile: {
        name: "sandbox-one-shot-test",
        kind: "shell",
        backend: "sandbox",
        sandbox: { workspaceMount: "readonly", network: "disabled" },
      },
    });
    await vi.waitFor(() => expect(worker.start).toHaveBeenCalledOnce());

    handle.push({ kind: "output", stream: "stdout", data: Buffer.from("ready") });

    await expect(execution).rejects.toThrow("capture failed");
    expect(handle.terminate).toHaveBeenCalledWith("kill");
    expect(outputSpool.close).toHaveBeenCalledOnce();
  });
});

class FakeSandboxProcessHandle implements SeneraSandboxProcessHandle {
  readonly id = "sandbox-persistent";
  readonly events = new AsyncEventQueue<SeneraSandboxProcessEvent>();
  readonly invocations: string[] = [];
  readonly write = vi.fn(async (data: Uint8Array) => {
    this.invocations.push(`write:${Buffer.from(data).toString()}`);
  });
  readonly endInput = vi.fn(async () => {
    this.invocations.push("end");
  });
  readonly terminate = vi.fn(async (_signal: "interrupt" | "terminate" | "kill") => undefined);

  push(event: SeneraSandboxProcessEvent): void {
    this.events.push(event);
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.events.push({ kind: "exit", code, signal });
    this.events.end();
  }

  end(): void {
    this.events.end();
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private settled = false;

  push(value: T): void {
    if (this.settled) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    if (this.settled) return;
    this.settled = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.settled) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

function backendFor(worker: SeneraSandboxWorkerClient): SeneraDockerEngineBackend {
  return new SeneraDockerEngineBackend({
    workspaceRoot: process.cwd(),
    worker,
    provider: "docker-engine",
    requestIdFactory: () => "request-persistent",
  });
}

function workerFor(handle: SeneraSandboxProcessHandle) {
  return {
    start: vi.fn(async (_request: AgentSandboxExecutionRequest) => handle),
  } as unknown as SeneraSandboxWorkerClient & {
    start: ReturnType<typeof vi.fn<(request: AgentSandboxExecutionRequest) => Promise<SeneraSandboxProcessHandle>>>;
  };
}

function spawnOptions(): Parameters<SeneraDockerEngineBackend["spawnPersistentProcess"]>[2] {
  return {
    cwd: process.cwd(),
    windowsHide: true,
    maxDurationMs: 30_000,
    profile: {
      name: "sandbox-persistent-test",
      kind: "shell",
      backend: "sandbox",
      sandbox: { workspaceMount: "writable", network: "disabled" },
    },
  };
}

function failingOutputSpool(): SeneraOutputSpool {
  return {
    descriptor: {
      directory: "output-spool",
      files: { stdout: "stdout.txt", stderr: "stderr.txt" },
      truncated: { stdout: false, stderr: false },
    },
    write: vi.fn(() => {
      throw new Error("capture failed");
    }),
    waitForDrain: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
  };
}
