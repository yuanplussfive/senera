import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawnOptions,
} from "../../../Source/AgentSystem/Execution/SeneraPersistentProcessTypes.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraExecutionEnv,
} from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { AgentExecutionResourceBroker } from "../../../Source/AgentSystem/ExecutionResources/AgentExecutionResourceBroker.js";
import type {
  AgentExecutionResourceLimits,
  AgentExecutionResourceOwner,
} from "../../../Source/AgentSystem/ExecutionResources/AgentExecutionResourceTypes.js";
import { createShellCommandHostTool } from "../../../Source/AgentSystem/ToolRuntime/AgentShellCommandRuntime.js";
import { createAgentExecutionResourceHostHandlers } from "../../../Source/AgentSystem/ToolRuntime/AgentExecutionResourceRuntime.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import type { SeneraOutputSpool, SeneraOutputStream } from "../../../Source/AgentSystem/Execution/SeneraOutputSpool.js";

describe("Shell command runtime", () => {
  it("runs through the resolved sandbox plan and returns a short command inline", async () => {
    const child = new FakePersistentChild();
    const spawn = vi.fn(async () => {
      setImmediate(() => child.emitClose(0));
      return child;
    });
    const fixture = createFixture(spawn);

    try {
      const result = await fixture.run({ command: shellCommand("echo ok") });

      expect(result.response).toMatchObject({
        ok: true,
        result: { command: "echo ok", state: "completed", exitCode: 0 },
      });
      expect(result.outputCapture).toBe(fixture.outputSpool.descriptor);
      expect(spawn).toHaveBeenCalledWith(
        "echo ok",
        [],
        expect.objectContaining({
          maxDurationMs: 120_000,
          shellCommand: shellCommand("echo ok"),
          profile: expect.objectContaining({
            backend: "sandbox",
            sandbox: { network: "default", workspaceMount: "writable" },
          }),
        }),
      );
    } finally {
      await fixture.broker.close();
    }
  });

  it("returns completed stdout and stderr collected by the resumable resource", async () => {
    const child = new FakePersistentChild();
    const events: AgentDomainEvent[] = [];
    const fixture = createFixture(async () => {
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from("hello"));
        child.stderr.emit("data", Buffer.from("warning"));
        child.emitClose(0);
      });
      return child;
    }, events);

    try {
      const result = await fixture.run({ command: shellCommand("echo hello") });

      expect(result.response).toMatchObject({
        ok: true,
        result: {
          state: "completed",
          stdout: "hello",
          stderr: "warning",
          stdoutBytes: 5,
          stderrBytes: 7,
        },
      });
      expect(result).toMatchObject({ stdout: "hello", stderr: "warning", exitCode: 0 });
      expect(fixture.outputSpool.output).toEqual({ stdout: "hello", stderr: "warning" });
      await vi.waitFor(() =>
        expect(events.filter((event) => event.kind === "execution.resource.output")).toHaveLength(2),
      );
    } finally {
      await fixture.broker.close();
    }
  });

  it("promotes a command that outlives the initial yield to a resumable resource", async () => {
    const child = new FakePersistentChild();
    const fixture = createFixture(async () => child, [], 0.001);

    try {
      const result = await fixture.run({ command: shellCommand("npm run dev") });
      const projected = successResult(result.response);

      expect(projected).toMatchObject({ state: "running", exitCode: null });
      expect(projected.resourceId).toEqual(expect.stringMatching(/^res_/));
      expect(projected.cursor).toBeTypeOf("number");
      expect(result.outputCapture).toBeUndefined();

      child.stdout.emit("data", Buffer.from("ready"));
      const resumed = await fixture.broker.wait(
        String(projected.resourceId),
        fixture.owner,
        Number(projected.cursor),
        1_000,
      );
      expect(resumed.events).toContainEqual(expect.objectContaining({ kind: "output", text: "ready" }));

      child.emitClose(0);
      const completed = await fixture.broker.wait(resumed.resourceId, fixture.owner, resumed.cursor, 1_000);
      expect(completed).toMatchObject({ state: "completed", exitCode: 0 });
      const waitResult = await createAgentExecutionResourceHostHandlers(fixture.broker).wait(
        { resourceId: resumed.resourceId, cursor: resumed.cursor, timeoutMs: 0 },
        fixture.context,
      );
      expect(waitResult).toMatchObject({
        response: { ok: true, result: { state: "completed", exitCode: 0 } },
        outputCapture: fixture.outputSpool.descriptor,
      });
      expect(fixture.broker.takeOutputCapture(resumed.resourceId, fixture.owner)).toBeUndefined();
    } finally {
      await fixture.broker.close();
    }
  });

  it("does not turn successful execution into failure when event delivery disconnects", async () => {
    const child = new FakePersistentChild();
    const fixture = createFixture(async () => {
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from("retained"));
        child.emitClose(0);
      });
      return child;
    });

    try {
      const result = await fixture.run({ command: shellCommand("echo retained") }, async () => {
        throw new Error("socket disconnected");
      });

      expect(result.response.ok).toBe(true);
      expect(result.stdout).toBe("retained");
    } finally {
      await fixture.broker.close();
    }
  });

  it("clamps the resource maximum duration to the host tool deadline", async () => {
    const child = new FakePersistentChild();
    const spawn = vi.fn(
      async (_command: string, _args: readonly string[], _options: SeneraPersistentProcessSpawnOptions) => {
        setImmediate(() => child.emitClose(0));
        return child;
      },
    );
    const fixture = createFixture(spawn, [], 0.1, 1);

    try {
      await fixture.run({ command: shellCommand("echo bounded"), timeoutMs: 5_000 });
      expect(spawn).toHaveBeenCalledWith("echo bounded", [], expect.objectContaining({ maxDurationMs: 1_000 }));
    } finally {
      await fixture.broker.close();
    }
  });

  it.each([
    {
      label: "an untyped error whose message resembles cancellation",
      error: new Error("aborted"),
      expectedCode: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
    },
    {
      label: "a typed execution cancellation",
      error: new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "execution cancelled"),
      expectedCode: AgentExecutionErrorCodes.ToolProcessCancelled,
    },
  ])("classifies $label by protocol semantics", async ({ error, expectedCode }) => {
    const fixture = createFixture(async () => {
      throw error;
    });

    try {
      const result = await fixture.run({ command: shellCommand("echo outcome") });
      expect(result.response).toMatchObject({ ok: false, error: { code: expectedCode } });
    } finally {
      await fixture.broker.close();
    }
  });

  it("projects a typed Docker Worker diagnostic into the tool failure envelope", async () => {
    const diagnostic = {
      kind: "docker_engine_worker",
      backend: "docker-engine" as const,
      operation: "start",
      workerCode: "engine_unavailable",
      requestId: "sandbox-diagnostic",
      retryable: false,
    };
    const fixture = createFixture(async () => {
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SandboxUnavailable,
        "sandbox create failed",
        {},
        undefined,
        diagnostic,
      );
    });

    try {
      const result = await fixture.run({ command: shellCommand("echo outcome") });
      expect(result.response).toMatchObject({
        ok: false,
        error: {
          code: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
          details: {
            phase: "process_spawn",
            seneraExecutionCode: SeneraExecutionErrorCodes.SandboxUnavailable,
            seneraExecutionDiagnostic: diagnostic,
          },
        },
      });
    } finally {
      await fixture.broker.close();
    }
  });
});

class FakePersistentChild extends EventEmitter implements SeneraPersistentProcessChild {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = {
    write: (): boolean => true,
    once: (_event: "drain", _listener: () => void): void => undefined,
    end: (): void => undefined,
  };
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    void this.terminateTree(signal);
    return true;
  }

  async terminateTree(signal: NodeJS.Signals): Promise<void> {
    if (this.exitCode !== null || this.signalCode !== null) return;
    queueMicrotask(() => this.emitClose(null, signal));
  }

  emitClose(exitCode: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = exitCode;
    this.signalCode = signal;
    this.emit("close", exitCode, signal);
  }
}

function createFixture(
  spawnPersistentProcess: (
    command: string,
    args: readonly string[],
    options: SeneraPersistentProcessSpawnOptions,
  ) => Promise<SeneraPersistentProcessChild>,
  events: AgentDomainEvent[] = [],
  initialYieldSeconds = 0.1,
  timeoutSeconds = 120,
) {
  const workspaceRoot = process.cwd();
  const owner: AgentExecutionResourceOwner = {
    workspaceRoot,
    sessionId: "session-shell",
    requestId: "request-shell",
  };
  const executionEnv = {
    canonicalPath: async () => ({ ok: true as const, value: workspaceRoot }),
    spawnPersistentProcess,
  } as unknown as SeneraExecutionEnv;
  const broker = new AgentExecutionResourceBroker({
    workspaceRoot,
    limits: resourceLimits(),
  });
  const outputSpool = new MemoryOutputSpool();
  const handler = createShellCommandHostTool(broker, async () => outputSpool);
  const tool = shellTool();
  const config: AgentSystemConfig = {
    ModelProviders: [],
    ToolExecution: {
      TimeoutSeconds: timeoutSeconds,
      Resources: { InitialYieldSeconds: initialYieldSeconds },
    },
  };
  const context = {
    tool,
    config,
    workspaceRoot,
    registry: { getTool: () => tool },
    executionEnv,
    sessionId: owner.sessionId,
    requestId: owner.requestId,
    step: 2,
    toolCallId: "call-shell",
    executionPlan: sandboxPlan(),
  };

  return {
    broker,
    owner,
    outputSpool,
    context,
    run: (
      args: { command: ReturnType<typeof shellCommand>; timeoutMs?: number },
      onEvent: (event: AgentDomainEvent) => Promise<void> = async (event) => {
        events.push(event);
      },
    ) => handler(args, { ...context, onEvent }),
  };
}

class MemoryOutputSpool implements SeneraOutputSpool {
  readonly descriptor = {
    directory: "memory-output-spool",
    files: { stdout: "memory-stdout", stderr: "memory-stderr" },
    truncated: { stdout: false, stderr: false },
  };
  readonly output = { stdout: "", stderr: "" };
  closed = false;
  cleaned = false;

  write(stream: SeneraOutputStream, data: Uint8Array): boolean {
    this.output[stream] += Buffer.from(data).toString();
    return true;
  }

  waitForDrain(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  cleanup(): Promise<void> {
    this.cleaned = true;
    return Promise.resolve();
  }
}

function resourceLimits(): AgentExecutionResourceLimits {
  return {
    maxActive: 4,
    maxBufferedBytes: 8_192,
    outputBatchMaxBytes: 1_024,
    outputBatchMaxDelayMs: 5,
    maxInputBytes: 1_024,
    initialYieldMs: 100,
    maxWaitMs: 5_000,
    idleTtlMs: 60_000,
    terminalTtlMs: 60_000,
    sweepIntervalMs: 60_000,
    terminationGraceMs: 20,
  };
}

function successResult(response: { ok: boolean; result?: unknown }): Record<string, unknown> {
  expect(response.ok).toBe(true);
  return response.result as Record<string, unknown>;
}

function shellCommand(script: string) {
  return { mode: "shell", dialect: "posix-sh", script } as const;
}

function shellTool(): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "shell",
      title: "Shell Tool",
      rootPath: process.cwd(),
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: "ShellCommandTool",
    loading: "Bootstrap",
    permissions: ["process:shell", "filesystem:workspace"],
    execution: {
      Targets: ["Sandbox", "Local"],
      Network: "Allow",
      Workspace: "ReadWrite",
    },
    handler: { kind: "HostCapability", capability: "shell.run" },
    runtime: {
      Lifecycle: "OneShot",
      ProtocolVersion: 2,
      ResultAssessment: "Unassessed",
      Capabilities: { OutputStreaming: true, Cancellation: true },
    },
    sources: [],
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

function sandboxPlan() {
  return {
    target: "Sandbox" as const,
    backend: "sandbox" as const,
    network: "default" as const,
    workspaceMount: "writable" as const,
    availableTargets: ["Sandbox"] as const,
  };
}
