import type { ExecEvent } from "microsandbox";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import type {
  SeneraMicrosandboxCreateRequest,
  SeneraMicrosandboxExecEvent,
  SeneraMicrosandboxExecRequest,
  SeneraMicrosandboxSdkAdapter,
  SeneraMicrosandboxSession,
  SeneraMicrosandboxTerminalEvent,
  SeneraMicrosandboxTerminalHandle,
  SeneraMicrosandboxTerminalRequest,
} from "./SeneraMicrosandboxTypes.js";

interface MicrosandboxModule {
  isInstalled(): boolean;
  setRuntimeLibkrunfwPath(path: string): void;
  setup(): MicrosandboxSetupBuilder;
  Sandbox: {
    builder(name: string): MicrosandboxSandboxBuilder;
  };
}

interface MicrosandboxSetupBuilder {
  baseDir(path: string): this;
  install(): Promise<void>;
}

interface MicrosandboxSandboxBuilder {
  image(image: string): this;
  cpus(value: number): this;
  memory(value: number): this;
  pullPolicy(policy: string): this;
  workdir(path: string): this;
  envs(env: Record<string, string>): this;
  ephemeral(enabled: boolean): this;
  replace(): this;
  disableMetricsSample(): this;
  quietLogs(): this;
  maxDuration(seconds: number): this;
  volume(path: string, configure: (mount: MicrosandboxVolumeMount) => MicrosandboxVolumeMount): this;
  patch(configure: (patch: MicrosandboxRootfsPatch) => MicrosandboxRootfsPatch): this;
  disableNetwork(): this;
  create(): Promise<MicrosandboxSandbox>;
}

interface MicrosandboxVolumeMount {
  bind(path: string): this;
  nosuid(): this;
  nodev(): this;
  readonly(): this;
  quota(value: number): this;
}

interface MicrosandboxRootfsPatch {
  copyDir(hostPath: string, guestPath: string, options: { replace: boolean }): this;
}

interface MicrosandboxSandbox {
  execStreamWith(
    command: string,
    configure: (builder: MicrosandboxExecBuilder) => MicrosandboxExecBuilder,
  ): Promise<MicrosandboxExecHandle>;
  stopWithTimeout(timeoutMs: number): Promise<unknown>;
  kill(): Promise<unknown>;
}

interface MicrosandboxExecHandle {
  recv(): Promise<ExecEvent | null>;
  takeStdin?(): Promise<MicrosandboxExecSink | null>;
  signal?(signal: number): Promise<void>;
  kill?(): Promise<void>;
}

interface MicrosandboxExecSink {
  write(data: Uint8Array | string): Promise<void>;
}

interface MicrosandboxExecBuilder {
  args(args: readonly string[]): this;
  cwd(path: string): this;
  envs(env: Record<string, string>): this;
  timeout(milliseconds: number): this;
  tty(enabled: boolean): this;
  stdinNull(): this;
  stdinPipe?(): this;
  stdinBytes(data: Buffer): this;
}

type MicrosandboxModuleLoader = () => Promise<MicrosandboxModule>;

export class SeneraMicrosandboxDynamicSdkAdapter implements SeneraMicrosandboxSdkAdapter {
  private modulePromise: Promise<MicrosandboxModule> | undefined;
  private runtimePreparePromise: Promise<void> | undefined;

  constructor(private readonly moduleLoader: MicrosandboxModuleLoader = () => import("microsandbox")) {}

  async isInstalled(): Promise<boolean> {
    try {
      return (await this.load()).isInstalled();
    } catch {
      return false;
    }
  }

  async createSandbox(request: SeneraMicrosandboxCreateRequest): Promise<SeneraMicrosandboxSession> {
    const microsandbox = await this.load();
    await this.prepareRuntime(microsandbox, request);
    const builder = microsandbox.Sandbox.builder(request.name)
      .image(request.image)
      .cpus(request.cpus)
      .memory(request.memoryMiB)
      .pullPolicy(request.pullPolicy)
      .workdir(request.guestWorkdir)
      .envs(request.env)
      .ephemeral(true)
      .replace()
      .disableMetricsSample()
      .quietLogs()
      .maxDuration(request.maxDurationSeconds)
      .volume(request.guestWorkspaceRoot, (mount) =>
        applyWorkspaceMountMode(mount.bind(request.workspaceRoot).nosuid().nodev(), request.workspaceMount),
      );

    const mounted = request.writableMounts.reduce(
      (current, writableMount) =>
        current.volume(writableMount.guestPath, (mount) =>
          mount
            .bind(writableMount.hostPath)
            .nosuid()
            .nodev()
            .quota(writableMount.quotaMiB ?? 1),
        ),
      builder,
    );

    const patched =
      request.rootfsCopies.length > 0
        ? mounted.patch((patch) =>
            request.rootfsCopies.reduce(
              (current, copy) => current.copyDir(copy.hostPath, copy.guestPath, { replace: true }),
              patch,
            ),
          )
        : mounted;

    const sandbox = await (request.network === "disabled" ? patched.disableNetwork() : patched).create();

    return new SeneraMicrosandboxSdkSession(sandbox);
  }

  private load(): Promise<MicrosandboxModule> {
    this.modulePromise ??= this.moduleLoader();
    return this.modulePromise;
  }

  private prepareRuntime(microsandbox: MicrosandboxModule, request: SeneraMicrosandboxCreateRequest): Promise<void> {
    if (!request.runtime) {
      return Promise.resolve();
    }

    const runtime = request.runtime;
    this.runtimePreparePromise ??= this.installRuntime(microsandbox, runtime).catch((error: unknown) => {
      this.runtimePreparePromise = undefined;
      throw error;
    });
    return this.runtimePreparePromise;
  }

  private async installRuntime(
    microsandbox: MicrosandboxModule,
    runtime: NonNullable<SeneraMicrosandboxCreateRequest["runtime"]>,
  ): Promise<void> {
    if (microsandbox.isInstalled()) {
      return;
    }

    process.env.MSB_PATH = runtime.msbPath;
    microsandbox.setRuntimeLibkrunfwPath(runtime.libkrunfwPath);
    if (!microsandbox.isInstalled()) {
      await microsandbox.setup().baseDir(runtime.baseDir).install();
    }
  }
}

function applyWorkspaceMountMode<TMount extends { readonly(): TMount }>(
  mount: TMount,
  mode: SeneraMicrosandboxCreateRequest["workspaceMount"],
): TMount {
  return mode === "readonly" ? mount.readonly() : mount;
}

class SeneraMicrosandboxSdkSession implements SeneraMicrosandboxSession {
  constructor(private readonly sandbox: MicrosandboxSandbox) {}

  async *exec(request: SeneraMicrosandboxExecRequest): AsyncIterable<SeneraMicrosandboxExecEvent> {
    const handle = await this.sandbox.execStreamWith(request.command, (builder) => {
      const configured = builder
        .args([...request.args])
        .cwd(request.cwd)
        .envs(request.env)
        .timeout(request.timeoutMs)
        .tty(false);
      return request.stdin === undefined ? configured.stdinNull() : configured.stdinBytes(Buffer.from(request.stdin));
    });

    for await (const event of readMicrosandboxExecEvents(handle)) {
      const normalized = normalizeMicrosandboxExecEvent(event);
      if (normalized) yield normalized;
    }
  }

  async openTerminal(request: SeneraMicrosandboxTerminalRequest): Promise<SeneraMicrosandboxTerminalHandle> {
    const handle = await this.sandbox.execStreamWith(request.command, (builder) => {
      const configured = builder
        .args([...request.args])
        .cwd(request.cwd)
        .envs(request.env)
        .tty(false);
      if (!configured.stdinPipe) throw terminalCapabilityUnavailable("stdin-pipe");
      return configured.stdinPipe();
    });
    if (!handle.takeStdin || !handle.signal || !handle.kill) {
      await handle.kill?.().catch(() => undefined);
      throw terminalCapabilityUnavailable("interactive-control");
    }
    const signal = handle.signal.bind(handle);
    const kill = handle.kill.bind(handle);
    const stdin = await handle.takeStdin();
    if (!stdin) {
      await kill().catch(() => undefined);
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SpawnFailed,
        "microsandbox terminal did not provide an interactive stdin channel.",
        { backend: "microsandbox-terminal" },
      );
    }
    return {
      events: readMicrosandboxTerminalEvents(handle),
      write: (data) => stdin.write(data),
      signal,
      kill,
    };
  }

  async stop(timeoutMs: number): Promise<void> {
    await this.sandbox.stopWithTimeout(timeoutMs);
  }

  async kill(): Promise<void> {
    await this.sandbox.kill();
  }
}

function terminalCapabilityUnavailable(capability: string): SeneraExecutionError {
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.SandboxUnavailable,
    `microsandbox does not expose the ${capability} terminal capability.`,
    {
      backend: "microsandbox-terminal",
      reason: "terminal_capability_unsupported",
      capability,
    },
  );
}

async function* readMicrosandboxTerminalEvents(
  handle: MicrosandboxExecHandle,
): AsyncIterable<SeneraMicrosandboxTerminalEvent> {
  const receiver = (handle as unknown as { inner?: { recv(): Promise<unknown> } }).inner ?? handle;
  for (;;) {
    const event = await receiver.recv();
    if (event === null) return;
    yield normalizeMicrosandboxTerminalEvent(event);
  }
}

const MicrosandboxTerminalEventProjectors = {
  started: (event: Record<string, unknown>): SeneraMicrosandboxTerminalEvent => ({
    kind: "started",
    pid: readRequiredNumber(event, "pid", "started"),
  }),
  stdout: (event: Record<string, unknown>): SeneraMicrosandboxTerminalEvent => ({
    kind: "output",
    stream: "stdout",
    data: readRequiredBuffer(event, "stdout"),
  }),
  stderr: (event: Record<string, unknown>): SeneraMicrosandboxTerminalEvent => ({
    kind: "output",
    stream: "stderr",
    data: readRequiredBuffer(event, "stderr"),
  }),
  output: (event: Record<string, unknown>): SeneraMicrosandboxTerminalEvent => ({
    kind: "output",
    stream: "stdout",
    data: readRequiredBuffer(event, "output"),
  }),
  exited: (event: Record<string, unknown>): SeneraMicrosandboxTerminalEvent => ({
    kind: "exit",
    code: readRequiredNumber(event, "code", "exited"),
  }),
} satisfies Record<string, (event: Record<string, unknown>) => SeneraMicrosandboxTerminalEvent>;

function normalizeMicrosandboxTerminalEvent(event: unknown): SeneraMicrosandboxTerminalEvent {
  const record = readMicrosandboxEventRecord(event);
  const kind = readMicrosandboxTerminalEventKind(record);
  const projector = kind ? MicrosandboxTerminalEventProjectors[kind] : undefined;
  if (projector) return projector(record);
  throw invalidMicrosandboxTerminalEvent(event, kind);
}

function readMicrosandboxTerminalEventKind(
  event: Record<string, unknown>,
): keyof typeof MicrosandboxTerminalEventProjectors | undefined {
  const value = typeof event.kind === "string" ? event.kind : event.eventType;
  return typeof value === "string" && value in MicrosandboxTerminalEventProjectors
    ? (value as keyof typeof MicrosandboxTerminalEventProjectors)
    : undefined;
}

function readMicrosandboxEventRecord(event: unknown): Record<string, unknown> {
  if (event && typeof event === "object" && !Array.isArray(event)) return event as Record<string, unknown>;
  throw invalidMicrosandboxTerminalEvent(event);
}

function readRequiredNumber(event: Record<string, unknown>, key: string, kind: string): number {
  const value = event[key];
  if (typeof value === "number") return value;
  throw invalidMicrosandboxTerminalEvent(event, kind, `missing_${key}`);
}

function readRequiredBuffer(event: Record<string, unknown>, kind: string): Buffer {
  const value = event.data;
  if (typeof value === "string" || value instanceof Uint8Array) return Buffer.from(value);
  throw invalidMicrosandboxTerminalEvent(event, kind, "missing_data");
}

function invalidMicrosandboxTerminalEvent(
  event: unknown,
  kind?: string,
  reason = "unknown_kind",
): SeneraExecutionError {
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.SpawnFailed,
    "microsandbox returned an invalid terminal event.",
    {
      backend: "microsandbox-terminal",
      reason: "terminal_event_invalid",
      eventKind: kind,
      eventReason: reason,
      event: summarizeMicrosandboxEvent(event),
    },
  );
}

async function* readMicrosandboxExecEvents(handle: MicrosandboxExecHandle): AsyncIterable<ExecEvent> {
  for (;;) {
    const event = await handle.recv();
    if (event === null) return;
    yield event;
  }
}

const MicrosandboxExecEventProjectors = {
  started: (_event: Extract<ExecEvent, { kind: "started" }>): undefined => undefined,
  stdout: (event: Extract<ExecEvent, { kind: "stdout" }>): SeneraMicrosandboxExecEvent => ({
    kind: "stdout",
    data: Buffer.from(event.data),
  }),
  stderr: (event: Extract<ExecEvent, { kind: "stderr" }>): SeneraMicrosandboxExecEvent => ({
    kind: "stderr",
    data: Buffer.from(event.data),
  }),
  exited: (event: Extract<ExecEvent, { kind: "exited" }>): SeneraMicrosandboxExecEvent => ({
    kind: "exit",
    code: event.code,
  }),
} satisfies {
  [K in ExecEvent["kind"]]: (event: Extract<ExecEvent, { kind: K }>) => SeneraMicrosandboxExecEvent | undefined;
};

function normalizeMicrosandboxExecEvent(event: ExecEvent): SeneraMicrosandboxExecEvent | undefined {
  const kind = readMicrosandboxExecEventKind(event);
  const projector = kind ? MicrosandboxExecEventProjectors[kind] : undefined;
  if (!projector) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "microsandbox 返回了无法识别的执行事件，已跳过 microsandbox 后端。",
      {
        eventKind: kind,
        event: summarizeMicrosandboxEvent(event),
      },
    );
  }

  return projector(event as never);
}

function readMicrosandboxExecEventKind(event: ExecEvent): ExecEvent["kind"] | undefined {
  return event && typeof event === "object" && "kind" in event
    ? (event as { kind?: ExecEvent["kind"] }).kind
    : undefined;
}

function summarizeMicrosandboxEvent(event: unknown): unknown {
  if (!event || typeof event !== "object") {
    return event;
  }

  return Object.fromEntries(
    Object.entries(event as Record<string, unknown>)
      .filter(([key]) => key !== "data")
      .slice(0, 8),
  );
}
