import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraShellExecutionResult,
} from "./SeneraExecutionTypes.js";
import {
  createSeneraProcessRootfsBundle,
} from "./SeneraProcessRootfsBundle.js";
import { SeneraProcessOutputBuffer } from "./SeneraProcessOutputBuffer.js";
import type {
  SeneraProcessExecutionBackend,
  SeneraProcessExecutionRequest,
} from "./SeneraProcessExecutionBackend.js";
import {
  resolveSeneraMicrosandboxSettings,
  type SeneraMicrosandboxSettings,
} from "./SeneraMicrosandboxDefaults.js";
import { projectMicrosandboxWorkspaceMount } from "./SeneraMicrosandboxPaths.js";
import { SeneraMicrosandboxDynamicSdkAdapter } from "./SeneraMicrosandboxSdkAdapter.js";
import type {
  SeneraMicrosandboxCreateRequest,
  SeneraMicrosandboxExecEvent,
  SeneraMicrosandboxSdkAdapter,
  SeneraMicrosandboxSession,
} from "./SeneraMicrosandboxTypes.js";
import type { SeneraShellInvocation } from "./SeneraShellPlatform.js";
import type { AgentSandboxRuntimePaths } from "../Sandbox/AgentSandboxRuntimePreparation.js";

export interface SeneraMicrosandboxBackendOptions {
  workspaceRoot: string;
  settings?: Partial<SeneraMicrosandboxSettings>;
  runtimePaths?: AgentSandboxRuntimePaths;
  sdk?: SeneraMicrosandboxSdkAdapter;
  sandboxNameFactory?: () => string;
  clock?: () => number;
}

export class SeneraMicrosandboxBackend implements SeneraProcessExecutionBackend {
  readonly kind = "microsandbox";
  private readonly workspaceRoot: string;
  private readonly settings: SeneraMicrosandboxSettings;
  private readonly runtimePaths: AgentSandboxRuntimePaths | undefined;
  private readonly sdk: SeneraMicrosandboxSdkAdapter;
  private readonly sandboxNameFactory: () => string;
  private readonly clock: () => number;
  private unavailableUntil = 0;
  private unavailableError: SeneraExecutionError | undefined;

  constructor(options: SeneraMicrosandboxBackendOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.settings = resolveSeneraMicrosandboxSettings(options.settings);
    this.runtimePaths = options.runtimePaths;
    this.sdk = options.sdk ?? new SeneraMicrosandboxDynamicSdkAdapter();
    this.sandboxNameFactory = options.sandboxNameFactory ?? (() => createMicrosandboxName(this.settings));
    this.clock = options.clock ?? Date.now;
  }

  resolveShellInvocation(command: string): SeneraShellInvocation {
    return {
      command: this.settings.guestShell.command,
      args: [...this.settings.guestShell.args, command],
    };
  }

  async executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult> {
    assertNotAborted(request.signal);
    assertMicrosandboxProfile(request);
    this.throwIfTemporarilyUnavailable();
    const settings = this.effectiveSettings(request);
    await prepareWritableMounts(request);

    const mount = projectMicrosandboxWorkspaceMount({
      workspaceRoot: this.workspaceRoot,
      cwd: request.cwd,
      guestWorkspaceRoot: settings.guestWorkspaceRoot,
    });
    const materialized = await materializeRootfsBundles(request);
    let session: SeneraMicrosandboxSession | undefined;

    try {
      session = await this.createSession(
        request,
        request.profile?.microsandbox?.guestWorkdir ?? mount.guestCwd,
        settings,
        materialized.rootfsCopies,
      );
      return await this.collectExecution(session, {
        ...request,
        cwd: request.profile?.microsandbox?.guestWorkdir ?? mount.guestCwd,
        env: {
          ...definedEnv(request.env),
          ...(request.profile?.microsandbox?.env ?? {}),
        },
      });
    } finally {
      if (session) {
        await stopSession(session, this.settings.stopTimeoutMs);
      }
      materialized.cleanup();
    }
  }

  private async createSession(
    request: SeneraProcessExecutionRequest,
    guestWorkdir: string,
    settings: SeneraMicrosandboxSettings,
    rootfsCopies: SeneraMicrosandboxCreateRequest["rootfsCopies"],
  ): Promise<SeneraMicrosandboxSession> {
    try {
      return await this.sdk.createSandbox({
        name: this.sandboxNameFactory(),
        image: settings.image,
        workspaceRoot: this.workspaceRoot,
        guestWorkspaceRoot: settings.guestWorkspaceRoot,
        workspaceMount: request.profile?.microsandbox?.workspaceMount ?? "readonly",
        writableMounts: request.profile?.microsandbox?.writableMounts ?? [],
        guestWorkdir,
        rootfsCopies,
        env: request.profile?.microsandbox?.env ?? {},
        cpus: settings.cpus,
        memoryMiB: settings.memoryMiB,
        network: settings.network,
        pullPolicy: settings.pullPolicy,
        runtime: this.runtimePaths
          ? {
            baseDir: this.runtimePaths.baseDir,
            msbPath: this.runtimePaths.msbPath,
            libkrunfwPath: this.runtimePaths.libkrunfwPath,
          }
          : undefined,
        maxDurationSeconds: timeoutSeconds(request.timeoutMs),
      });
    } catch (error) {
      const unavailableError = new SeneraExecutionError(
        SeneraExecutionErrorCodes.SandboxUnavailable,
        "microsandbox 无法创建执行沙箱。",
        {
          backend: this.kind,
          image: settings.image,
        },
        error instanceof Error ? error : undefined,
      );
      this.markTemporarilyUnavailable(unavailableError);
      throw unavailableError;
    }
  }

  private throwIfTemporarilyUnavailable(): void {
    if (this.clock() < this.unavailableUntil && this.unavailableError) {
      throw this.unavailableError;
    }
  }

  private markTemporarilyUnavailable(error: SeneraExecutionError): void {
    this.unavailableError = error;
    this.unavailableUntil = this.clock() + this.settings.unavailableRetryDelayMs;
  }

  private effectiveSettings(request: SeneraProcessExecutionRequest): SeneraMicrosandboxSettings {
    return resolveSeneraMicrosandboxSettings({
      ...this.settings,
      image: request.profile?.microsandbox?.image ?? this.settings.image,
      guestWorkspaceRoot: request.profile?.microsandbox?.guestWorkspaceRoot ?? this.settings.guestWorkspaceRoot,
      network: request.profile?.microsandbox?.network ?? this.settings.network,
    });
  }

  private async collectExecution(
    session: SeneraMicrosandboxSession,
    request: SeneraProcessExecutionRequest & { env: Record<string, string> },
  ): Promise<SeneraShellExecutionResult> {
    const output = new SeneraProcessOutputBuffer();
    let exitCode: number | null = null;
    let cancellationError: SeneraExecutionError | undefined;
    const cancel = (error: SeneraExecutionError): void => {
      cancellationError ??= error;
      void session.kill().catch(() => undefined);
    };
    const timer = request.timeoutMs > 0
      ? setTimeout(() => cancel(new SeneraExecutionError(
          SeneraExecutionErrorCodes.Timeout,
          `命令执行超时，超过 ${request.timeoutMs}ms。`,
          { timeoutMs: request.timeoutMs, backend: this.kind },
        )), request.timeoutMs)
      : undefined;
    const abortListener = (): void => {
      cancel(new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted"));
    };

    request.signal?.addEventListener("abort", abortListener, { once: true });
    try {
      for await (const event of session.exec(request)) {
        throwIfCancelled(cancellationError);
        applyMicrosandboxExecEvent({
          event,
          output,
          request,
          setExitCode: (code) => {
            exitCode = code;
          },
          cancel,
        });
      }
      throwIfCancelled(cancellationError);
      return {
        stdout: output.stdout(),
        stderr: output.stderr(),
        exitCode,
        signal: null,
      };
    } catch (error) {
      if (cancellationError) throw cancellationError;
      throw toExecutionError(error, request);
    } finally {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", abortListener);
    }
  }
}

function assertMicrosandboxProfile(request: SeneraProcessExecutionRequest): void {
  if (request.profile?.backend === "local") {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "执行策略声明使用本地进程后端，已跳过 microsandbox。",
      {
        backend: "microsandbox",
        profile: request.profile.name,
      },
    );
  }

  if (request.profile?.kind === "plugin-process" && !request.profile.microsandbox) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "插件进程缺少 microsandbox 执行画像，已跳过 microsandbox 后端。",
      {
        backend: "microsandbox",
        profile: request.profile.name,
      },
    );
  }
}

function throwIfCancelled(error: SeneraExecutionError | undefined): void {
  if (error) throw error;
}

function applyMicrosandboxExecEvent(input: {
  event: SeneraMicrosandboxExecEvent;
  output: SeneraProcessOutputBuffer;
  request: SeneraProcessExecutionRequest;
  setExitCode: (code: number) => void;
  cancel: (error: SeneraExecutionError) => void;
}): void {
  const handlers = {
    stdout: ({ data }: Extract<SeneraMicrosandboxExecEvent, { kind: "stdout" }>) => {
      input.output.pushStdout(data);
      enforceOutputLimit({
        actualBytes: input.output.stdoutBytes,
        maxBytes: input.request.limits.maxStdoutBytes,
        code: SeneraExecutionErrorCodes.StdoutLimitExceeded,
        message: `stdout 超过 ${input.request.limits.maxStdoutBytes} 字节。`,
        cancel: input.cancel,
      });
    },
    stderr: ({ data }: Extract<SeneraMicrosandboxExecEvent, { kind: "stderr" }>) => {
      input.output.pushStderr(data);
      enforceOutputLimit({
        actualBytes: input.output.stderrBytes,
        maxBytes: input.request.limits.maxStderrBytes,
        code: SeneraExecutionErrorCodes.StderrLimitExceeded,
        message: `stderr 超过 ${input.request.limits.maxStderrBytes} 字节。`,
        cancel: input.cancel,
      });
    },
    exit: ({ code }: Extract<SeneraMicrosandboxExecEvent, { kind: "exit" }>) => {
      input.setExitCode(code);
    },
  } satisfies {
    [K in SeneraMicrosandboxExecEvent["kind"]]: (
      event: Extract<SeneraMicrosandboxExecEvent, { kind: K }>,
    ) => void;
  };

  handlers[input.event.kind](input.event as never);
}

function enforceOutputLimit(input: {
  actualBytes: number;
  maxBytes: number;
  code: typeof SeneraExecutionErrorCodes.StdoutLimitExceeded | typeof SeneraExecutionErrorCodes.StderrLimitExceeded;
  message: string;
  cancel: (error: SeneraExecutionError) => void;
}): void {
  if (input.actualBytes <= input.maxBytes) return;
  input.cancel(new SeneraExecutionError(input.code, input.message, {
    maxBytes: input.maxBytes,
    actualBytes: input.actualBytes,
  }));
}

function createMicrosandboxName(settings: SeneraMicrosandboxSettings): string {
  const entropy = randomUUID().replaceAll("-", "").slice(0, settings.sandboxNameEntropyLength);
  return `${settings.sandboxNamePrefix}-${entropy}`;
}

function timeoutSeconds(timeoutMs: number): number {
  return Math.max(1, Math.ceil(timeoutMs / 1000));
}

function definedEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? {}).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : []),
  );
}

async function stopSession(session: SeneraMicrosandboxSession, timeoutMs: number): Promise<void> {
  await session.stop(timeoutMs).catch(async () => {
    await session.kill().catch(() => undefined);
  });
}

async function prepareWritableMounts(request: SeneraProcessExecutionRequest): Promise<void> {
  await Promise.all(
    (request.profile?.microsandbox?.writableMounts ?? [])
      .map((mount) => mkdir(mount.hostPath, { recursive: true })),
  );
}

async function materializeRootfsBundles(request: SeneraProcessExecutionRequest): Promise<{
  rootfsCopies: SeneraMicrosandboxCreateRequest["rootfsCopies"];
  cleanup(): void;
}> {
  const bundles = await Promise.all(
    (request.profile?.microsandbox?.rootfsBundles ?? []).map(async (bundle) => ({
      bundle: await createSeneraProcessRootfsBundle({
        workspaceRoot: bundle.workspaceRoot,
        packageRoot: bundle.packageRoot,
      }),
      guestPath: bundle.guestPath,
    })),
  );

  return {
    rootfsCopies: [
      ...(request.profile?.microsandbox?.rootfsCopies ?? []),
      ...bundles.map(({ bundle, guestPath }) => ({
        hostPath: bundle.rootPath,
        guestPath,
      })),
    ],
    cleanup: () => {
      for (const { bundle } of bundles) {
        bundle.cleanup();
      }
    },
  };
}

function toExecutionError(
  error: unknown,
  request: SeneraProcessExecutionRequest,
): SeneraExecutionError {
  if (error instanceof SeneraExecutionError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.SpawnFailed,
    cause.message,
    {
      command: request.command,
      args: request.args,
      cwd: request.cwd,
      backend: "microsandbox",
    },
    cause,
  );
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
  }
}
