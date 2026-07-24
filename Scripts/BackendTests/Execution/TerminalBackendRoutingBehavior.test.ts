import { describe, expect, it } from "vitest";
import {
  TerminalSidecarClientFrameDecoder,
  encodeTerminalSidecarServerMessage,
  type TerminalSidecarClientMessage,
} from "@senera/terminal-sidecar";
import { SeneraMicrosandboxBackend } from "../../../Source/AgentSystem/Execution/SeneraMicrosandboxBackend.js";
import type {
  SeneraMicrosandboxCreateRequest,
  SeneraMicrosandboxExecRequest,
  SeneraMicrosandboxSdkAdapter,
  SeneraMicrosandboxSession,
  SeneraMicrosandboxTerminalEvent,
  SeneraMicrosandboxTerminalHandle,
  SeneraMicrosandboxTerminalRequest,
} from "../../../Source/AgentSystem/Execution/SeneraMicrosandboxTypes.js";
import { createSeneraAuthorizedTerminalSpawner } from "../../../Source/AgentSystem/Execution/SeneraTerminalSpawner.js";
import { resolveSeneraTerminalSidecarRuntime } from "../../../Source/AgentSystem/Execution/SeneraTerminalSidecarRuntime.js";
import {
  SeneraTerminalCapabilityNames,
  type SeneraTerminalBackend,
  type SeneraTerminalChild,
  type SeneraTerminalDisposable,
  type SeneraTerminalExitEvent,
  type SeneraTerminalSpawnOptions,
} from "../../../Source/AgentSystem/Execution/SeneraTerminalTypes.js";
import type { SeneraShellDialect } from "../../../Source/AgentSystem/Execution/SeneraShellCommand.js";

describe("terminal backend routing", () => {
  it("resolves a raw shell script only after selecting the sandbox backend", async () => {
    const sandbox = new FakeTerminalBackend("sandbox-posix", "sandbox", [SeneraTerminalCapabilityNames.Persistent]);
    const spawn = createSeneraAuthorizedTerminalSpawner({ sandbox });

    await spawn("host-shell-must-not-be-used", ["host-args"], {
      ...sandboxOptions(),
      shellCommand: { mode: "shell", dialect: "posix-sh", script: "printf sandbox-ok" },
    });

    expect(sandbox.spawnInvocations).toEqual([{ command: "/bin/sh", args: ["-lc", "printf sandbox-ok"] }]);
  });

  it("fails a sandbox selection with an unsupported dialect without starting local execution", async () => {
    const sandbox = new FakeTerminalBackend("sandbox-posix", "sandbox", [SeneraTerminalCapabilityNames.Persistent]);
    const local = new FakeTerminalBackend(
      "local-powershell",
      "local",
      [SeneraTerminalCapabilityNames.Persistent],
      "powershell",
    );
    const spawn = createSeneraAuthorizedTerminalSpawner({ sandbox, local });

    await expect(
      spawn("host-shell-must-not-be-used", [], {
        ...sandboxOptions(),
        shellCommand: { mode: "shell", dialect: "powershell", script: "Write-Output local-ok" },
      }),
    ).rejects.toMatchObject({ code: "sandbox_unavailable", details: { reason: "shell_dialect_unsupported" } });

    expect(sandbox.spawnInvocations).toEqual([]);
    expect(local.spawnInvocations).toEqual([]);
  });

  it("runs an interactive terminal inside microsandbox and releases the guest after exit", async () => {
    const session = new InteractiveMicrosandboxSession();
    const backend = new SeneraMicrosandboxBackend({
      workspaceRoot: process.cwd(),
      sdk: new FakeMicrosandboxSdk(session),
      sandboxNameFactory: () => "sandbox-terminal-test",
      terminalRuntime: resolveSeneraTerminalSidecarRuntime(),
    });

    const child = await backend.spawn(process.execPath, ["interactive"], sandboxOptions());
    const output: string[] = [];
    child.onData((data) => output.push(data.toString()));
    const exited = new Promise<SeneraTerminalExitEvent>((resolve) => child.onExit(resolve));

    await session.started;
    await child.write("hello\n");
    await child.signal("terminate");
    await expect(exited).resolves.toEqual({ exitCode: 0 });

    expect(output.join("")).toBe("ready> ");
    expect(session.writes).toEqual(["hello\n"]);
    expect(session.signals).toEqual([15]);
    expect(session.stopTimeouts).toEqual([1_000]);
    expect(child.metadata).toEqual(
      expect.objectContaining({
        backendId: "microsandbox-sidecar",
        requestedBoundary: "sandbox",
        effectiveBoundary: "sandbox",
        sandboxId: "sandbox-terminal-test",
        capabilityProviders: expect.objectContaining({ resize: "guest-node-pty" }),
        persistenceScope: "execution-resource",
      }),
    );
    expect(child.metadata.capabilities).toContain(SeneraTerminalCapabilityNames.Resize);
    expect(child.resize).toBeTypeOf("function");
  });

  it("runs a local selection through only a compatible local backend", async () => {
    const sandbox = new FakeTerminalBackend("sandbox-no-resize", "sandbox", [
      SeneraTerminalCapabilityNames.Persistent,
      SeneraTerminalCapabilityNames.InteractiveInput,
      SeneraTerminalCapabilityNames.Signals,
    ]);
    const local = new FakeTerminalBackend("local-full", "local", [
      SeneraTerminalCapabilityNames.Persistent,
      SeneraTerminalCapabilityNames.InteractiveInput,
      SeneraTerminalCapabilityNames.Resize,
      SeneraTerminalCapabilityNames.Signals,
    ]);
    const spawn = createSeneraAuthorizedTerminalSpawner({ local, sandbox });

    const child = await spawn("shell", [], {
      ...sandboxOptions(),
      requiredCapabilities: [SeneraTerminalCapabilityNames.Resize],
      profile: {
        ...sandboxOptions().profile!,
        backend: "local",
      },
    });

    expect(sandbox.spawnCalls).toBe(0);
    expect(local.spawnCalls).toBe(1);
    expect(child.metadata).toEqual(
      expect.objectContaining({
        requestedBoundary: "local",
        effectiveBoundary: "local",
        backendId: "local-full",
      }),
    );
  });
});

class FakeMicrosandboxSdk implements SeneraMicrosandboxSdkAdapter {
  constructor(private readonly session: SeneraMicrosandboxSession) {}

  async createSandbox(_request: SeneraMicrosandboxCreateRequest): Promise<SeneraMicrosandboxSession> {
    return this.session;
  }
}

class InteractiveMicrosandboxSession implements SeneraMicrosandboxSession {
  readonly writes: string[] = [];
  readonly signals: number[] = [];
  readonly stopTimeouts: number[] = [];
  private readonly decoder = new TerminalSidecarClientFrameDecoder();
  private readonly events = new AsyncEventQueue<SeneraMicrosandboxTerminalEvent>();
  private readonly didStart = deferred<void>();
  readonly started = this.didStart.promise;

  async *exec(_request: SeneraMicrosandboxExecRequest) {
    yield { kind: "exit", code: 0 } as const;
  }

  async openTerminal(request: SeneraMicrosandboxTerminalRequest): Promise<SeneraMicrosandboxTerminalHandle> {
    expect(request.command).toBe("/usr/local/bin/node");
    expect(request.args[0]).toMatch(/senera-terminal-sidecar\.js$/);
    this.events.push({ kind: "started", pid: 17 });
    return {
      events: this.events,
      write: async (data) => {
        for (const message of this.decoder.push(Buffer.from(data))) this.handleMessage(message);
      },
      signal: async (signal) => {
        this.signals.push(signal);
        this.events.push({ kind: "exit", code: signal === 9 ? 137 : 0 });
        this.events.close();
      },
      kill: async () => {
        this.events.push({ kind: "exit", code: 137 });
        this.events.close();
      },
    };
  }

  async stop(timeoutMs: number): Promise<void> {
    this.stopTimeouts.push(timeoutMs);
  }

  async kill(): Promise<void> {
    this.events.push({ kind: "exit", code: 137 });
    this.events.close();
  }

  private handleMessage(message: TerminalSidecarClientMessage): void {
    const handlers = {
      open: () => {
        this.emitSidecar({ type: "ready", protocolVersion: 1, pid: 23 });
        this.emitSidecar({ type: "output", sequence: 1, data: "ready> " });
        this.didStart.resolve();
      },
      write: (value: Extract<TerminalSidecarClientMessage, { type: "write" }>) => {
        this.writes.push(value.input);
        this.emitSidecar({ type: "ack", requestId: value.requestId, operation: "write" });
      },
      resize: (value: Extract<TerminalSidecarClientMessage, { type: "resize" }>) => {
        this.emitSidecar({ type: "ack", requestId: value.requestId, operation: "resize" });
      },
      signal: (value: Extract<TerminalSidecarClientMessage, { type: "signal" }>) => {
        const signal = { interrupt: 2, terminate: 15, kill: 9 } as const;
        this.signals.push(signal[value.signal]);
        this.emitSidecar({ type: "ack", requestId: value.requestId, operation: "signal" });
        this.emitSidecar({ type: "exit", exitCode: 0 });
        this.events.push({ kind: "exit", code: 0 });
        this.events.close();
      },
      close: (value: Extract<TerminalSidecarClientMessage, { type: "close" }>) => {
        this.emitSidecar({ type: "ack", requestId: value.requestId, operation: "close" });
      },
    } satisfies {
      [K in TerminalSidecarClientMessage["type"]]: (value: Extract<TerminalSidecarClientMessage, { type: K }>) => void;
    };
    handlers[message.type](message as never);
  }

  private emitSidecar(message: Parameters<typeof encodeTerminalSidecarServerMessage>[0]): void {
    this.events.push({ kind: "output", stream: "stdout", data: encodeTerminalSidecarServerMessage(message) });
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const value = this.values.shift();
      if (value !== undefined) yield value;
      else if (this.closed) return;
      else {
        const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
        if (result.done) return;
        yield result.value;
      }
    }
  }
}

class FakeTerminalBackend implements SeneraTerminalBackend {
  readonly descriptor;
  spawnCalls = 0;
  readonly spawnInvocations: Array<{ command: string; args: string[] }> = [];

  constructor(
    id: string,
    boundary: "local" | "sandbox",
    capabilities: readonly (typeof SeneraTerminalCapabilityNames)[keyof typeof SeneraTerminalCapabilityNames][],
    shellDialect: SeneraShellDialect = boundary === "sandbox" ? "posix-sh" : "powershell",
  ) {
    this.descriptor = { id, boundary, shellDialect, capabilities: new Set(capabilities) };
  }

  resolveShellInvocation(command: string) {
    return this.descriptor.shellDialect === "posix-sh"
      ? { command: "/bin/sh", args: ["-lc", command] }
      : { command: "pwsh.exe", args: ["-Command", command] };
  }

  async spawn(command: string, args: readonly string[], _options: SeneraTerminalSpawnOptions) {
    this.spawnCalls += 1;
    this.spawnInvocations.push({ command, args: [...args] });
    return new FakeTerminalChild(this.descriptor);
  }
}

class FakeTerminalChild implements SeneraTerminalChild {
  readonly metadata;
  readonly pid = 9;

  constructor(descriptor: SeneraTerminalBackend["descriptor"]) {
    this.metadata = {
      requestedBoundary: descriptor.boundary,
      effectiveBoundary: descriptor.boundary,
      backendId: descriptor.id,
      shellDialect: descriptor.shellDialect,
      capabilities: [...descriptor.capabilities],
    };
  }

  async write(): Promise<void> {}
  async resize(): Promise<void> {}
  async signal(): Promise<void> {}
  onData(): SeneraTerminalDisposable {
    return noOpDisposable();
  }
  onError(): SeneraTerminalDisposable {
    return noOpDisposable();
  }
  onExit(): SeneraTerminalDisposable {
    return noOpDisposable();
  }
}

function sandboxOptions(): SeneraTerminalSpawnOptions {
  return {
    cwd: process.cwd(),
    columns: 100,
    rows: 30,
    maxDurationMs: 5_000,
    profile: {
      name: "sandbox-terminal",
      kind: "shell",
      backend: "sandbox",
      microsandbox: {
        workspaceMount: "writable",
        network: "disabled",
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function noOpDisposable(): SeneraTerminalDisposable {
  return { dispose() {} };
}
