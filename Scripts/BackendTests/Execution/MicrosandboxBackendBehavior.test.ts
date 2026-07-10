import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SeneraMicrosandboxBackend } from "../../../Source/AgentSystem/Execution/SeneraMicrosandboxBackend.js";
import type { SeneraProcessExecutionRequest } from "../../../Source/AgentSystem/Execution/SeneraProcessExecutionBackend.js";
import type {
  SeneraMicrosandboxCreateRequest,
  SeneraMicrosandboxExecEvent,
  SeneraMicrosandboxExecRequest,
  SeneraMicrosandboxSdkAdapter,
  SeneraMicrosandboxSession,
} from "../../../Source/AgentSystem/Execution/SeneraMicrosandboxTypes.js";
import {
  SeneraExecutionErrorCodes,
} from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import {
  createTemporaryDirectory,
  removeDirectory,
} from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  while (temporaryDirectories.length > 0) {
    removeDirectory(temporaryDirectories.pop()!);
  }
});

describe("Microsandbox backend behavior", () => {
  test("projects workspace execution into the guest and collects process events", async () => {
    const workspaceRoot = createWorkspace();
    const session = new ScriptedMicrosandboxSession([
      { kind: "stdout", data: Buffer.from("sandbox output") },
      { kind: "stderr", data: Buffer.from("sandbox warning") },
      { kind: "exit", code: 7 },
    ]);
    const sdk = new RecordingMicrosandboxSdk(session);
    const backend = new SeneraMicrosandboxBackend({
      workspaceRoot,
      sdk,
      sandboxNameFactory: () => "sandbox-test",
    });

    const result = await backend.executeProcess(processRequest(workspaceRoot, {
      cwd: path.join(workspaceRoot, "Source", "AgentSystem"),
      env: { DEFINED: "yes", EMPTY: undefined },
    }));

    expect(result).toEqual({
      stdout: "sandbox output",
      stderr: "sandbox warning",
      exitCode: 7,
      signal: null,
    });
    expect(sdk.createRequests).toEqual([
      expect.objectContaining({
        name: "sandbox-test",
        image: "alpine",
        guestWorkspaceRoot: "/workspace",
        guestWorkdir: "/workspace/Source/AgentSystem",
        network: "disabled",
        maxDurationSeconds: 5,
      }),
    ]);
    expect(session.execRequests).toEqual([
      expect.objectContaining({
        command: "/bin/sh",
        args: ["-lc", "printf test"],
        cwd: "/workspace/Source/AgentSystem",
        env: { DEFINED: "yes" },
      }),
    ]);
    expect(session.stopCount).toBe(1);
    expect(session.killCount).toBe(0);
  });

  test("caches sandbox creation failure until the retry window expires", async () => {
    const workspaceRoot = createWorkspace();
    const sdk = new FailingMicrosandboxSdk();
    let now = 1_000;
    const backend = new SeneraMicrosandboxBackend({
      workspaceRoot,
      sdk,
      clock: () => now,
      settings: { unavailableRetryDelayMs: 30_000 },
    });
    const request = processRequest(workspaceRoot);

    await expect(backend.executeProcess(request)).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.SandboxUnavailable,
    });
    await expect(backend.executeProcess(request)).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.SandboxUnavailable,
    });
    expect(sdk.createCount).toBe(1);

    now += 30_001;
    await expect(backend.executeProcess(request)).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.SandboxUnavailable,
    });
    expect(sdk.createCount).toBe(2);
  });

  test.each([
    ["stdout", SeneraExecutionErrorCodes.StdoutLimitExceeded],
    ["stderr", SeneraExecutionErrorCodes.StderrLimitExceeded],
  ] as const)("kills the session when %s exceeds its byte budget", async (kind, code) => {
    const workspaceRoot = createWorkspace();
    const session = new ScriptedMicrosandboxSession([
      { kind, data: Buffer.from("too-large") },
    ] as SeneraMicrosandboxExecEvent[]);
    const backend = new SeneraMicrosandboxBackend({
      workspaceRoot,
      sdk: new RecordingMicrosandboxSdk(session),
    });

    await expect(backend.executeProcess(processRequest(workspaceRoot, {
      limits: {
        timeoutMs: 5_000,
        maxStdoutBytes: kind === "stdout" ? 3 : 1_024,
        maxStderrBytes: kind === "stderr" ? 3 : 1_024,
      },
    }))).rejects.toMatchObject({ code });

    expect(session.killCount).toBe(1);
    expect(session.stopCount).toBe(1);
  });

  test("aborts an active sandbox execution and still stops the session", async () => {
    const workspaceRoot = createWorkspace();
    const session = new BlockingMicrosandboxSession();
    const backend = new SeneraMicrosandboxBackend({
      workspaceRoot,
      sdk: new RecordingMicrosandboxSdk(session),
    });
    const controller = new AbortController();
    const pending = backend.executeProcess(processRequest(workspaceRoot, { signal: controller.signal }));
    await session.started;

    controller.abort("cancelled by operator");

    await expect(pending).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.Aborted });
    expect(session.killCount).toBe(1);
    expect(session.stopCount).toBe(1);
  });

  test("times out a blocked execution without relying on wall-clock delays", async () => {
    vi.useFakeTimers();
    const workspaceRoot = createWorkspace();
    const session = new BlockingMicrosandboxSession();
    const backend = new SeneraMicrosandboxBackend({
      workspaceRoot,
      sdk: new RecordingMicrosandboxSdk(session),
    });
    const pending = backend.executeProcess(processRequest(workspaceRoot, { timeoutMs: 1_000 }));
    const rejection = expect(pending).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.Timeout });
    await session.started;

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(session.killCount).toBe(1);
  });

  test("rejects local-only and incomplete plugin profiles before creating a sandbox", async () => {
    const workspaceRoot = createWorkspace();
    const sdk = new RecordingMicrosandboxSdk(new ScriptedMicrosandboxSession([]));
    const backend = new SeneraMicrosandboxBackend({ workspaceRoot, sdk });

    await expect(backend.executeProcess(processRequest(workspaceRoot, {
      profile: { name: "local", kind: "shell", backend: "local" },
    }))).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.SandboxUnavailable });
    await expect(backend.executeProcess(processRequest(workspaceRoot, {
      profile: { name: "plugin", kind: "plugin-process" },
    }))).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.SandboxUnavailable });
    expect(sdk.createRequests).toEqual([]);
  });
});

class RecordingMicrosandboxSdk implements SeneraMicrosandboxSdkAdapter {
  readonly createRequests: SeneraMicrosandboxCreateRequest[] = [];

  constructor(private readonly session: SeneraMicrosandboxSession) {}

  async isInstalled(): Promise<boolean> {
    return true;
  }

  async createSandbox(request: SeneraMicrosandboxCreateRequest): Promise<SeneraMicrosandboxSession> {
    this.createRequests.push(request);
    return this.session;
  }
}

class FailingMicrosandboxSdk implements SeneraMicrosandboxSdkAdapter {
  createCount = 0;

  async isInstalled(): Promise<boolean> {
    return false;
  }

  async createSandbox(): Promise<SeneraMicrosandboxSession> {
    this.createCount += 1;
    throw new Error("runtime unavailable");
  }
}

class ScriptedMicrosandboxSession implements SeneraMicrosandboxSession {
  readonly execRequests: SeneraMicrosandboxExecRequest[] = [];
  stopCount = 0;
  killCount = 0;

  constructor(private readonly events: readonly SeneraMicrosandboxExecEvent[]) {}

  async *exec(request: SeneraMicrosandboxExecRequest): AsyncIterable<SeneraMicrosandboxExecEvent> {
    this.execRequests.push(request);
    yield* this.events;
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
  }

  async kill(): Promise<void> {
    this.killCount += 1;
  }
}

class BlockingMicrosandboxSession implements SeneraMicrosandboxSession {
  private resolveStarted!: () => void;
  private release!: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  stopCount = 0;
  killCount = 0;

  async *exec(): AsyncIterable<SeneraMicrosandboxExecEvent> {
    this.resolveStarted();
    await this.gate;
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
  }

  async kill(): Promise<void> {
    this.killCount += 1;
    this.release();
  }
}

function processRequest(
  workspaceRoot: string,
  overrides: Partial<SeneraProcessExecutionRequest> = {},
): SeneraProcessExecutionRequest {
  return {
    command: "/bin/sh",
    args: ["-lc", "printf test"],
    cwd: workspaceRoot,
    timeoutMs: 5_000,
    limits: {
      timeoutMs: 5_000,
      maxStdoutBytes: 1_024,
      maxStderrBytes: 1_024,
    },
    ...overrides,
  };
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-microsandbox");
  temporaryDirectories.push(workspace);
  return workspace;
}
