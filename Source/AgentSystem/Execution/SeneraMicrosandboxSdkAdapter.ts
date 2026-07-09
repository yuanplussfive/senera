import type { ExecEvent, ExecHandle, Sandbox } from "microsandbox";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
} from "./SeneraExecutionTypes.js";
import type {
  SeneraMicrosandboxCreateRequest,
  SeneraMicrosandboxExecEvent,
  SeneraMicrosandboxExecRequest,
  SeneraMicrosandboxSdkAdapter,
  SeneraMicrosandboxSession,
} from "./SeneraMicrosandboxTypes.js";

type MicrosandboxModule = typeof import("microsandbox");

export class SeneraMicrosandboxDynamicSdkAdapter implements SeneraMicrosandboxSdkAdapter {
  private modulePromise: Promise<MicrosandboxModule> | undefined;
  private runtimePreparePromise: Promise<void> | undefined;

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
      .volume(
        request.guestWorkspaceRoot,
        (mount) => applyWorkspaceMountMode(
          mount
          .bind(request.workspaceRoot)
          .nosuid()
          .nodev(),
          request.workspaceMount,
        ),
      );

    const mounted = request.writableMounts.reduce(
      (current, writableMount) => current.volume(
        writableMount.guestPath,
        (mount) => mount
          .bind(writableMount.hostPath)
          .nosuid()
          .nodev()
          .quota(writableMount.quotaMiB ?? 1),
      ),
      builder,
    );

    const patched = request.rootfsCopies.length > 0
      ? mounted.patch((patch) =>
          request.rootfsCopies.reduce(
            (current, copy) => current.copyDir(copy.hostPath, copy.guestPath, { replace: true }),
            patch,
          ))
      : mounted;

    const sandbox = await (
      request.network === "disabled"
        ? patched.disableNetwork()
        : patched
    ).create();

    return new SeneraMicrosandboxSdkSession(sandbox);
  }

  private load(): Promise<MicrosandboxModule> {
    this.modulePromise ??= import("microsandbox");
    return this.modulePromise;
  }

  private prepareRuntime(
    microsandbox: MicrosandboxModule,
    request: SeneraMicrosandboxCreateRequest,
  ): Promise<void> {
    if (!request.runtime) {
      return Promise.resolve();
    }

    const runtime = request.runtime;
    this.runtimePreparePromise ??= (async () => {
      process.env.MSB_PATH = runtime.msbPath;
      microsandbox.setRuntimeLibkrunfwPath(runtime.libkrunfwPath);
      if (!microsandbox.isInstalled()) {
        await microsandbox.setup().baseDir(runtime.baseDir).install();
      }
    })();
    return this.runtimePreparePromise;
  }
}

function applyWorkspaceMountMode<TMount extends { readonly(): TMount }>(
  mount: TMount,
  mode: SeneraMicrosandboxCreateRequest["workspaceMount"],
): TMount {
  return mode === "readonly" ? mount.readonly() : mount;
}

class SeneraMicrosandboxSdkSession implements SeneraMicrosandboxSession {
  constructor(private readonly sandbox: Sandbox) {}

  async *exec(request: SeneraMicrosandboxExecRequest): AsyncIterable<SeneraMicrosandboxExecEvent> {
    const handle = await this.sandbox.execStreamWith(
      request.command,
      (builder) => {
        const configured = builder
          .args([...request.args])
          .cwd(request.cwd)
          .envs(request.env)
          .timeout(request.timeoutMs)
          .tty(false);
        return request.stdin === undefined
          ? configured.stdinNull()
          : configured.stdinBytes(Buffer.from(request.stdin));
      },
    );

    for await (const event of readMicrosandboxExecEvents(handle)) {
      const normalized = normalizeMicrosandboxExecEvent(event);
      if (normalized) yield normalized;
    }
  }

  async stop(timeoutMs: number): Promise<void> {
    await this.sandbox.stopWithTimeout(timeoutMs);
  }

  async kill(): Promise<void> {
    await this.sandbox.kill();
  }
}

async function* readMicrosandboxExecEvents(handle: ExecHandle): AsyncIterable<ExecEvent> {
  for (;;) {
    const event = await handle.recv();
    if (event === null) return;
    yield event;
  }
}

const MicrosandboxExecEventProjectors = {
  started: (_event: Extract<ExecEvent, { kind: "started" }>): undefined => undefined,
  stdout: (event: Extract<ExecEvent, { kind: "stdout" }>): SeneraMicrosandboxExecEvent =>
    ({ kind: "stdout", data: Buffer.from(event.data) }),
  stderr: (event: Extract<ExecEvent, { kind: "stderr" }>): SeneraMicrosandboxExecEvent =>
    ({ kind: "stderr", data: Buffer.from(event.data) }),
  exited: (event: Extract<ExecEvent, { kind: "exited" }>): SeneraMicrosandboxExecEvent =>
    ({ kind: "exit", code: event.code }),
} satisfies {
  [K in ExecEvent["kind"]]: (
    event: Extract<ExecEvent, { kind: K }>,
  ) => SeneraMicrosandboxExecEvent | undefined;
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
