import assert from "node:assert/strict";
import path from "node:path";
import {
  TerminalSidecarClientFrameDecoder,
  encodeTerminalSidecarServerMessage,
  type TerminalSidecarClientMessage,
  type TerminalSidecarServerMessage,
} from "@senera/terminal-sidecar";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
} from "../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { SeneraMicrosandboxBackend } from "../Source/AgentSystem/Execution/SeneraMicrosandboxBackend.js";
import { SeneraMicrosandboxDefaults } from "../Source/AgentSystem/Execution/SeneraMicrosandboxDefaults.js";
import { resolveSeneraTerminalSidecarRuntime } from "../Source/AgentSystem/Execution/SeneraTerminalSidecarRuntime.js";
import type {
  SeneraMicrosandboxCreateRequest,
  SeneraMicrosandboxExecEvent,
  SeneraMicrosandboxExecRequest,
  SeneraMicrosandboxSdkAdapter,
  SeneraMicrosandboxSession,
  SeneraMicrosandboxTerminalEvent,
  SeneraMicrosandboxTerminalHandle,
  SeneraMicrosandboxTerminalRequest,
} from "../Source/AgentSystem/Execution/SeneraMicrosandboxTypes.js";

const workspaceRoot = process.cwd();

async function main(): Promise<void> {
  const sdk = new FakeMicrosandboxSdkAdapter();
  const terminalRuntime = resolveSeneraTerminalSidecarRuntime();
  const backend = new SeneraMicrosandboxBackend({
    workspaceRoot,
    sdk,
    sandboxNameFactory: () => "senera-verify",
    terminalRuntime,
  });
  const env = new SeneraLocalExecutionEnv({
    workspaceRoot,
    processBackend: backend,
  });

  const result = await env.executeShell({
    command: "pwd",
    dialect: "posix-sh",
    cwd: path.join(workspaceRoot, "Source", "AgentSystem"),
    env: {
      SENERA_VERIFY: "1",
      SENERA_EMPTY: undefined,
    },
    limits: {
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    },
  });

  assert.equal(result.stdout, "sandbox-ok");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(sdk.createRequests.length, 1);
  assert.equal(sdk.createRequests[0]?.name, "senera-verify");
  assert.equal(sdk.createRequests[0]?.image, SeneraMicrosandboxDefaults.image);
  assert.equal(sdk.createRequests[0]?.guestWorkspaceRoot, "/workspace");
  assert.equal(sdk.createRequests[0]?.guestWorkdir, "/workspace/Source/AgentSystem");
  assert.deepEqual(sdk.createRequests[0]?.rootfsCopies, []);
  assert.deepEqual(sdk.createRequests[0]?.env, {});
  assert.equal(sdk.createRequests[0]?.network, "disabled");
  assert.equal(sdk.execRequests[0]?.command, "/bin/sh");
  assert.deepEqual(sdk.execRequests[0]?.args, ["-lc", "pwd"]);
  assert.deepEqual(sdk.execRequests[0]?.env, { SENERA_VERIFY: "1" });

  await backend.executeProcess({
    command: "npm",
    args: ["run", "tool"],
    cwd: path.join(workspaceRoot, "System", "Plugins", "AskUserToolPlugin"),
    env: {
      SENERA_VERIFY: "plugin",
    },
    timeoutMs: 5_000,
    limits: {
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    },
    profile: {
      name: "node-plugin",
      kind: "mcp-server",
      microsandbox: {
        image: "node:22-bookworm-slim",
        guestWorkspaceRoot: "/workspace",
        guestWorkdir: "/opt/senera/runtime/System/Plugins/AskUserToolPlugin",
        workspaceMount: "readonly",
        network: "disabled",
        rootfsCopies: [
          {
            hostPath: path.join(workspaceRoot, "System", "Plugins", "AskUserToolPlugin"),
            guestPath: "/opt/senera/runtime",
          },
        ],
        rootfsBundles: [
          {
            workspaceRoot,
            packageRoot: path.join(workspaceRoot, "Plugins", "WeatherToolPlugin"),
            guestPath: "/opt/senera/bundles",
          },
        ],
        writableMounts: [
          {
            hostPath: path.join(workspaceRoot, "Plugins", "WeatherToolPlugin", ".state"),
            guestPath: "/workspace/Plugins/WeatherToolPlugin/.state",
            quotaMiB: 256,
          },
        ],
        env: {
          SENERA_TOOL_CONTEXT_WORKSPACE_ROOT: "/workspace",
          SENERA_TOOL_CONTEXT_PLUGIN_ROOT: "/opt/senera/runtime/System/Plugins/AskUserToolPlugin",
        },
      },
    },
  });
  assert.equal(sdk.createRequests[1]?.image, "node:22-bookworm-slim");
  assert.equal(sdk.createRequests[1]?.guestWorkdir, "/opt/senera/runtime/System/Plugins/AskUserToolPlugin");
  assert.deepEqual(sdk.createRequests[1]?.rootfsCopies, [
    {
      hostPath: path.join(workspaceRoot, "System", "Plugins", "AskUserToolPlugin"),
      guestPath: "/opt/senera/runtime",
    },
    {
      hostPath: sdk.createRequests[1]?.rootfsCopies[1]?.hostPath ?? "",
      guestPath: "/opt/senera/bundles",
    },
  ]);
  assert.match(sdk.createRequests[1]?.rootfsCopies[1]?.hostPath ?? "", /senera-rootfs-bundle-/);
  assert.deepEqual(sdk.createRequests[1]?.env, {
    SENERA_TOOL_CONTEXT_WORKSPACE_ROOT: "/workspace",
    SENERA_TOOL_CONTEXT_PLUGIN_ROOT: "/opt/senera/runtime/System/Plugins/AskUserToolPlugin",
  });
  assert.equal(sdk.execRequests[1]?.cwd, "/opt/senera/runtime/System/Plugins/AskUserToolPlugin");
  assert.deepEqual(sdk.execRequests[1]?.env, {
    SENERA_VERIFY: "plugin",
    SENERA_TOOL_CONTEXT_WORKSPACE_ROOT: "/workspace",
    SENERA_TOOL_CONTEXT_PLUGIN_ROOT: "/opt/senera/runtime/System/Plugins/AskUserToolPlugin",
  });

  const terminal = await backend.spawn("/bin/sh", ["-lc", "printf terminal-ok"], {
    cwd: workspaceRoot,
    columns: 120,
    rows: 32,
    maxDurationMs: 5_000,
  });
  const terminalExit = new Promise<number>((resolve) => terminal.onExit(({ exitCode }) => resolve(exitCode)));
  await terminal.write("terminal-input\n");
  await terminal.resize?.(132, 40);
  await terminal.signal("terminate");
  assert.equal(await terminalExit, 0);

  assert.equal(sdk.createRequests[2]?.image, SeneraMicrosandboxDefaults.image);
  assert.deepEqual(sdk.createRequests[2]?.rootfsCopies, [
    {
      hostPath: sdk.createRequests[2]?.rootfsCopies[0]?.hostPath ?? "",
      guestPath: terminalRuntime.guestRoot,
    },
  ]);
  assert.equal(sdk.createRequests[2]?.rootfsCopies[0]?.hostPath, terminalRuntime.sourceRoot);
  assert.deepEqual(sdk.terminalRequests, [
    {
      command: terminalRuntime.guestNodeCommand,
      args: [terminalRuntime.guestEntrypoint],
      cwd: "/workspace",
      env: {},
    },
  ]);
  assert.deepEqual(sdk.terminalInputs, ["terminal-input\n"]);
  assert.deepEqual(sdk.terminalResizes, [{ columns: 132, rows: 40 }]);
  assert.deepEqual(sdk.terminalSignals, ["terminate"]);

  const unavailableSdk = new UnavailableMicrosandboxSdkAdapter();
  const unavailableBackend = new SeneraMicrosandboxBackend({
    workspaceRoot,
    sdk: unavailableSdk,
    settings: {
      unavailableRetryDelayMs: 30_000,
    },
    clock: () => 10_000,
  });
  const unavailableRequest = {
    command: "/bin/sh",
    args: ["-lc", "true"],
    cwd: workspaceRoot,
    timeoutMs: 5_000,
    limits: {
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    },
  };
  await assert.rejects(
    () => unavailableBackend.executeProcess(unavailableRequest),
    (error: unknown) =>
      error instanceof SeneraExecutionError && error.code === SeneraExecutionErrorCodes.SandboxUnavailable,
  );
  await assert.rejects(
    () => unavailableBackend.executeProcess(unavailableRequest),
    (error: unknown) =>
      error instanceof SeneraExecutionError && error.code === SeneraExecutionErrorCodes.SandboxUnavailable,
  );
  assert.equal(unavailableSdk.createCount, 1);

  await assert.rejects(
    () =>
      new SeneraMicrosandboxBackend({
        workspaceRoot,
        sdk: new UnavailableMicrosandboxSdkAdapter(),
      }).executeProcess({
        command: "/bin/sh",
        args: ["-lc", "true"],
        cwd: workspaceRoot,
        timeoutMs: 5_000,
        limits: {
          timeoutMs: 5_000,
          maxStdoutBytes: 1024,
          maxStderrBytes: 1024,
        },
      }),
    (error: unknown) =>
      error instanceof SeneraExecutionError && error.code === SeneraExecutionErrorCodes.SandboxUnavailable,
  );

  const limitSession = new FakeMicrosandboxSession([{ kind: "stdout", data: Buffer.from("too-large") }]);
  await assert.rejects(
    () =>
      new SeneraMicrosandboxBackend({
        workspaceRoot,
        sdk: new FakeMicrosandboxSdkAdapter(limitSession),
      }).executeProcess({
        command: "/bin/sh",
        args: ["-lc", "echo too-large"],
        cwd: workspaceRoot,
        timeoutMs: 5_000,
        limits: {
          timeoutMs: 5_000,
          maxStdoutBytes: 3,
          maxStderrBytes: 1024,
        },
      }),
    (error: unknown) =>
      error instanceof SeneraExecutionError && error.code === SeneraExecutionErrorCodes.StdoutLimitExceeded,
  );
  assert.equal(limitSession.stopCount, 1);
  assert.equal(limitSession.killCount, 0);

  console.log("Senera microsandbox backend verification passed.");
}

class FakeMicrosandboxSdkAdapter implements SeneraMicrosandboxSdkAdapter {
  readonly createRequests: SeneraMicrosandboxCreateRequest[] = [];
  readonly execRequests: SeneraMicrosandboxExecRequest[] = [];

  constructor(
    private readonly session = new FakeMicrosandboxSession([
      { kind: "stdout", data: Buffer.from("sandbox-ok") },
      { kind: "exit", code: 0 },
    ]),
  ) {}

  async isInstalled(): Promise<boolean> {
    return true;
  }

  async createSandbox(request: SeneraMicrosandboxCreateRequest): Promise<SeneraMicrosandboxSession> {
    this.createRequests.push(request);
    return {
      exec: (execRequest) => {
        this.execRequests.push(execRequest);
        return this.session.exec(execRequest);
      },
      openTerminal: (terminalRequest) => this.session.openTerminal(terminalRequest),
      stop: (timeoutMs) => this.session.stop(timeoutMs),
      kill: () => this.session.kill(),
    };
  }

  get terminalRequests(): readonly SeneraMicrosandboxTerminalRequest[] {
    return this.session.terminalRequests;
  }

  get terminalInputs(): readonly string[] {
    return this.session.terminalInputs;
  }

  get terminalResizes(): readonly { columns: number; rows: number }[] {
    return this.session.terminalResizes;
  }

  get terminalSignals(): readonly string[] {
    return this.session.terminalSignals;
  }
}

class UnavailableMicrosandboxSdkAdapter implements SeneraMicrosandboxSdkAdapter {
  createCount = 0;

  async isInstalled(): Promise<boolean> {
    return false;
  }

  async createSandbox(_request: SeneraMicrosandboxCreateRequest): Promise<SeneraMicrosandboxSession> {
    this.createCount += 1;
    throw new Error("unreachable");
  }
}

class FakeMicrosandboxSession implements SeneraMicrosandboxSession {
  killCount = 0;
  stopCount = 0;
  readonly terminalRequests: SeneraMicrosandboxTerminalRequest[] = [];
  readonly terminalInputs: string[] = [];
  readonly terminalResizes: Array<{ columns: number; rows: number }> = [];
  readonly terminalSignals: string[] = [];
  private readonly terminalDecoder = new TerminalSidecarClientFrameDecoder();
  private readonly terminalEvents = new AsyncEventQueue<SeneraMicrosandboxTerminalEvent>();

  constructor(private readonly events: readonly SeneraMicrosandboxExecEvent[]) {}

  async *exec(_request: SeneraMicrosandboxExecRequest): AsyncIterable<SeneraMicrosandboxExecEvent> {
    yield* this.events;
  }

  async openTerminal(request: SeneraMicrosandboxTerminalRequest): Promise<SeneraMicrosandboxTerminalHandle> {
    this.terminalRequests.push(request);
    this.terminalEvents.push({ kind: "started", pid: 17 });
    return {
      events: this.terminalEvents,
      write: async (data) => {
        for (const message of this.terminalDecoder.push(Buffer.from(data))) this.handleTerminalMessage(message);
      },
      signal: async (signal) => {
        this.terminalSignals.push(String(signal));
      },
      kill: async () => {
        this.terminalEvents.push({ kind: "exit", code: 137 });
        this.terminalEvents.close();
      },
    };
  }

  async stop(_timeoutMs: number): Promise<void> {
    this.stopCount += 1;
  }

  async kill(): Promise<void> {
    this.killCount += 1;
  }

  private handleTerminalMessage(message: TerminalSidecarClientMessage): void {
    const handlers = {
      open: () => this.emitTerminal({ type: "ready", protocolVersion: 1, pid: 23 }),
      write: (value: Extract<TerminalSidecarClientMessage, { type: "write" }>) => {
        this.terminalInputs.push(value.input);
        this.acknowledge(value);
      },
      resize: (value: Extract<TerminalSidecarClientMessage, { type: "resize" }>) => {
        this.terminalResizes.push({ columns: value.columns, rows: value.rows });
        this.acknowledge(value);
      },
      signal: (value: Extract<TerminalSidecarClientMessage, { type: "signal" }>) => {
        this.terminalSignals.push(value.signal);
        this.acknowledge(value);
        this.emitTerminal({ type: "exit", exitCode: 0 });
        this.terminalEvents.push({ kind: "exit", code: 0 });
        this.terminalEvents.close();
      },
      close: (value: Extract<TerminalSidecarClientMessage, { type: "close" }>) => this.acknowledge(value),
    } satisfies {
      [K in TerminalSidecarClientMessage["type"]]: (value: Extract<TerminalSidecarClientMessage, { type: K }>) => void;
    };
    handlers[message.type](message as never);
  }

  private acknowledge(message: Exclude<TerminalSidecarClientMessage, { type: "open" }>): void {
    this.emitTerminal({
      type: "ack",
      requestId: message.requestId,
      operation: message.type,
    });
  }

  private emitTerminal(message: TerminalSidecarServerMessage): void {
    this.terminalEvents.push({
      kind: "output",
      stream: "stdout",
      data: encodeTerminalSidecarServerMessage(message),
    });
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
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
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.closed) return;
      const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      if (result.done) return;
      yield result.value;
    }
  }
}

await main();
