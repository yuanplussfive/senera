import { describe, expect, test, vi } from "vitest";
import { createSeneraProcessBackendSpawner } from "../../../Source/AgentSystem/Execution/SeneraProcessBackendSpawner.js";
import type {
  SeneraProcessExecutionBackend,
  SeneraProcessExecutionRequest,
} from "../../../Source/AgentSystem/Execution/SeneraProcessExecutionBackend.js";
import type { SeneraShellExecutionResult } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import type { AgentToolProcessSpawnOptions } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessTypes.js";

describe("Process backend spawner behavior", () => {
  test("starts once on stdin end and forwards the complete process contract", async () => {
    const backend = new ControlledBackend();
    const spawner = createSeneraProcessBackendSpawner(backend);
    const options = createOptions();
    const child = spawner("runtime-command", ["first", "second"], options);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const closed = waitForClose(child);

    child.stdin.end("payload");
    child.stdin.end("ignored second payload");
    backend.resolve({ stdout: "standard output", stderr: "standard error", exitCode: 7, signal: null });

    await expect(closed).resolves.toEqual([7, null]);
    expect(Buffer.concat(stdout).toString("utf8")).toBe("standard output");
    expect(Buffer.concat(stderr).toString("utf8")).toBe("standard error");
    expect(backend.requests).toEqual([
      {
        command: "runtime-command",
        args: ["first", "second"],
        cwd: options.cwd,
        env: options.env,
        stdin: "payload",
        timeoutMs: options.timeoutMs,
        limits: options.limits,
        signal: expect.any(AbortSignal),
        profile: options.profile,
      },
    ]);
  });

  test("emits backend failures through the child error channel", async () => {
    const backend = new ControlledBackend();
    const child = createSeneraProcessBackendSpawner(backend)("command", [], createOptions());
    const error = new Error("backend unavailable");
    const emitted = new Promise<Error>((resolve) => child.on("error", resolve));

    child.stdin.end();
    backend.reject(error);

    await expect(emitted).resolves.toBe(error);
  });

  test("propagates external cancellation to the backend", async () => {
    const controller = new AbortController();
    controller.abort();
    const backend = new ControlledBackend();
    const child = createSeneraProcessBackendSpawner(backend)(
      "command",
      [],
      createOptions({ signal: controller.signal }),
    );
    const closed = waitForClose(child);

    child.stdin.end();
    expect(backend.requests[0]?.signal?.aborted).toBe(true);
    backend.resolve({ stdout: "", stderr: "", exitCode: 0, signal: null });

    await expect(closed).resolves.toEqual([0, null]);
  });

  test("kills pending executions and emits a single SIGTERM close event", async () => {
    const backend = new ControlledBackend();
    const child = createSeneraProcessBackendSpawner(backend)("command", [], createOptions());
    const closeListener = vi.fn();
    child.on("close", closeListener);
    child.on("error", () => undefined);
    child.stdin.end();

    expect(child.kill("SIGKILL")).toBe(true);
    expect(child.kill()).toBe(true);
    backend.reject(new Error("aborted backend"));
    await Promise.resolve();

    expect(backend.requests[0]?.signal?.aborted).toBe(true);
    expect(closeListener).toHaveBeenCalledTimes(1);
    expect(closeListener).toHaveBeenCalledWith(null, "SIGTERM");
  });
});

class ControlledBackend implements SeneraProcessExecutionBackend {
  readonly kind = "controlled";
  readonly requests: SeneraProcessExecutionRequest[] = [];
  private resolveExecution?: (result: SeneraShellExecutionResult) => void;
  private rejectExecution?: (error: Error) => void;

  executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult> {
    this.requests.push(request);
    return new Promise((resolve, reject) => {
      this.resolveExecution = resolve;
      this.rejectExecution = reject;
    });
  }

  resolve(result: SeneraShellExecutionResult): void {
    this.resolveExecution?.(result);
  }

  reject(error: Error): void {
    this.rejectExecution?.(error);
  }
}

function createOptions(overrides: Partial<AgentToolProcessSpawnOptions> = {}): AgentToolProcessSpawnOptions {
  return {
    cwd: process.cwd(),
    env: { SENERA_SPAWNER_TEST: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    timeoutMs: 2_000,
    limits: {
      timeoutMs: 2_000,
      maxStdoutBytes: 1_024,
      maxStderrBytes: 1_024,
    },
    profile: {
      name: "test-process",
      kind: "plugin-process",
      backend: "local",
      localFallback: "deny",
    },
    ...overrides,
  };
}

function waitForClose(child: ReturnType<ReturnType<typeof createSeneraProcessBackendSpawner>>) {
  return new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    child.on("close", (exitCode, signal) => resolve([exitCode, signal]));
  });
}
