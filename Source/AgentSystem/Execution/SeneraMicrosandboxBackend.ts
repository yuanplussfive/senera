import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraShellExecutionResult,
} from "./SeneraExecutionTypes.js";
import { createSeneraProcessRootfsBundle } from "./SeneraProcessRootfsBundle.js";
import { SeneraProcessOutputBuffer } from "./SeneraProcessOutputBuffer.js";
import type { SeneraProcessExecutionBackend, SeneraProcessExecutionRequest } from "./SeneraProcessExecutionBackend.js";
import { resolveSeneraMicrosandboxSettings, type SeneraMicrosandboxSettings } from "./SeneraMicrosandboxDefaults.js";
import { projectMicrosandboxWorkspaceMount } from "./SeneraMicrosandboxPaths.js";
import { SeneraMicrosandboxDynamicSdkAdapter } from "./SeneraMicrosandboxSdkAdapter.js";
import type {
  SeneraMicrosandboxCreateRequest,
  SeneraMicrosandboxExecEvent,
  SeneraMicrosandboxSdkAdapter,
  SeneraMicrosandboxSession,
} from "./SeneraMicrosandboxTypes.js";
import type { SeneraShellInvocation } from "./SeneraShellPlatform.js";
import { SeneraShellDialects } from "./SeneraShellCommand.js";
import type { AgentSandboxRuntimePaths } from "../Sandbox/AgentSandboxRuntimePreparation.js";
import { openSeneraTerminalSidecar } from "./SeneraTerminalSidecarClient.js";
import { SeneraMicrosandboxTerminalSidecarChannel } from "./SeneraTerminalSidecarChannel.js";
import { resolvePreparedSeneraTerminalSidecarGuestRuntime } from "./SeneraTerminalSidecarGuestRuntime.js";
import type { SeneraTerminalSidecarRuntime } from "./SeneraTerminalSidecarRuntime.js";
import {
  attachSeneraExecutionDiagnostic,
  normalizeSeneraExecutionDiagnostic,
} from "./SeneraExecutionErrorDiagnostics.js";
import {
  SeneraTerminalCapabilityNames,
  SeneraTerminalCapabilityProviders,
  SeneraTerminalPersistenceScopes,
  type SeneraTerminalBackend,
  type SeneraTerminalChild,
  type SeneraTerminalSpawnOptions,
} from "./SeneraTerminalTypes.js";

export interface SeneraMicrosandboxBackendOptions {
  workspaceRoot: string;
  settings?: Partial<SeneraMicrosandboxSettings>;
  runtimePaths?: AgentSandboxRuntimePaths;
  sdk?: SeneraMicrosandboxSdkAdapter;
  sandboxNameFactory?: () => string;
  clock?: () => number;
  terminalRuntime?: SeneraTerminalSidecarRuntime;
}

export class SeneraMicrosandboxBackend implements SeneraProcessExecutionBackend, SeneraTerminalBackend {
  readonly kind = "microsandbox";
  readonly shellDialect = SeneraShellDialects.Posix;
  readonly descriptor = {
    id: "microsandbox-sidecar",
    boundary: "sandbox",
    shellDialect: SeneraShellDialects.Posix,
    capabilities: new Set([
      SeneraTerminalCapabilityNames.Persistent,
      SeneraTerminalCapabilityNames.InteractiveInput,
      SeneraTerminalCapabilityNames.Resize,
      SeneraTerminalCapabilityNames.Signals,
    ]),
    capabilityProviders: {
      [SeneraTerminalCapabilityNames.Persistent]: SeneraTerminalCapabilityProviders.GuestNodePty,
      [SeneraTerminalCapabilityNames.InteractiveInput]: SeneraTerminalCapabilityProviders.GuestNodePty,
      [SeneraTerminalCapabilityNames.Resize]: SeneraTerminalCapabilityProviders.GuestNodePty,
      [SeneraTerminalCapabilityNames.Signals]: SeneraTerminalCapabilityProviders.MicrosandboxSdk,
    },
    persistenceScope: SeneraTerminalPersistenceScopes.ExecutionResource,
  } as const;
  private readonly workspaceRoot: string;
  private readonly settings: SeneraMicrosandboxSettings;
  private readonly runtimePaths: AgentSandboxRuntimePaths | undefined;
  private readonly sdk: SeneraMicrosandboxSdkAdapter;
  private readonly sandboxNameFactory: () => string;
  private readonly clock: () => number;
  private readonly terminalRuntime: SeneraTerminalSidecarRuntime | undefined;
  private unavailableUntil = 0;
  private unavailableError: SeneraExecutionError | undefined;

  constructor(options: SeneraMicrosandboxBackendOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.settings = resolveSeneraMicrosandboxSettings(options.settings);
    this.runtimePaths = options.runtimePaths;
    this.sdk = options.sdk ?? new SeneraMicrosandboxDynamicSdkAdapter();
    this.sandboxNameFactory = options.sandboxNameFactory ?? (() => createMicrosandboxName(this.settings));
    this.clock = options.clock ?? Date.now;
    this.terminalRuntime = options.terminalRuntime;
  }

  resolveShellInvocation(command: string): SeneraShellInvocation {
    return {
      command: this.settings.guestShell.command,
      args: [...this.settings.guestShell.args, command],
    };
  }

  async executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult> {
    assertNotAborted(request.signal);
    assertMicrosandboxProfile(request.profile);
    this.throwIfTemporarilyUnavailable();
    const settings = this.effectiveSettings(request.profile);
    await prepareWritableMounts(request.profile);

    const mount = projectMicrosandboxWorkspaceMount({
      workspaceRoot: this.workspaceRoot,
      cwd: request.cwd,
      guestWorkspaceRoot: settings.guestWorkspaceRoot,
    });
    const materialized = await materializeRootfsBundles(request.profile);
    let session: SeneraMicrosandboxSession | undefined;
    let result: SeneraShellExecutionResult | undefined;
    let primaryError: SeneraExecutionError | undefined;

    try {
      session = (
        await this.createSession(
          request.profile,
          request.profile?.microsandbox?.guestWorkdir ?? mount.guestCwd,
          settings,
          materialized.rootfsCopies,
          request.timeoutMs,
        )
      ).session;
      result = await this.collectExecution(
        session,
        {
          ...request,
          cwd: request.profile?.microsandbox?.guestWorkdir ?? mount.guestCwd,
          env: {
            ...definedEnv(request.env),
            ...(request.profile?.microsandbox?.env ?? {}),
          },
        },
        settings.stopTimeoutMs,
      );
    } catch (error) {
      primaryError = error instanceof SeneraExecutionError ? error : toExecutionError(error, request);
    }

    let cleanupError: SeneraExecutionError | undefined;
    try {
      materialized.cleanup();
    } catch (error) {
      const materializedCleanupError = normalizeSeneraExecutionDiagnostic(
        error,
        SeneraExecutionErrorCodes.CleanupFailed,
        { reason: "rootfs_cleanup_failed", backend: this.kind },
      );
      cleanupError = materializedCleanupError;
    }

    if (cleanupError) {
      primaryError = primaryError
        ? attachSeneraExecutionDiagnostic(primaryError, "cleanup", cleanupError)
        : cleanupError;
    }
    if (primaryError) throw primaryError;
    return result!;
  }

  async spawn(
    command: string,
    args: readonly string[],
    options: SeneraTerminalSpawnOptions,
  ): Promise<SeneraTerminalChild> {
    assertNotAborted(options.signal);
    assertMicrosandboxProfile(options.profile);
    this.throwIfTemporarilyUnavailable();
    if (!options.maxDurationMs || options.maxDurationMs <= 0) {
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SpawnFailed,
        "A sandbox terminal requires a positive maximum duration.",
        { backend: this.descriptor.id },
      );
    }

    const settings = this.effectiveSettings(options.profile);
    await prepareWritableMounts(options.profile);
    const mount = projectMicrosandboxWorkspaceMount({
      workspaceRoot: this.workspaceRoot,
      cwd: options.cwd,
      guestWorkspaceRoot: settings.guestWorkspaceRoot,
    });
    const guestCwd = options.profile?.microsandbox?.guestWorkdir ?? mount.guestCwd;
    const materialized = await materializeRootfsBundles(options.profile);
    const runtime = this.resolveTerminalRuntime();
    let opened: { id: string; session: SeneraMicrosandboxSession } | undefined;
    try {
      opened = await this.createSession(
        options.profile,
        guestCwd,
        settings,
        [
          ...materialized.rootfsCopies,
          {
            hostPath: runtime.sourceRoot,
            guestPath: runtime.guestRoot,
          },
        ],
        options.maxDurationMs,
      );
      if (!opened.session.openTerminal) {
        throw new SeneraExecutionError(
          SeneraExecutionErrorCodes.SandboxUnavailable,
          "The configured microsandbox adapter does not support interactive terminals.",
          {
            backend: this.descriptor.id,
            reason: "terminal_capability_unsupported",
          },
        );
      }
      const handle = await opened.session.openTerminal({
        command: runtime.guestNodeCommand,
        args: [runtime.guestEntrypoint],
        cwd: guestCwd,
        env: {
          ...definedEnv(options.env),
          ...(options.profile?.microsandbox?.env ?? {}),
        },
      });
      const session = opened.session;
      return openSeneraTerminalSidecar({
        channel: new SeneraMicrosandboxTerminalSidecarChannel(handle, async () => {
          await stopSession(session, settings.stopTimeoutMs);
          materialized.cleanup();
        }),
        command,
        args,
        cwd: guestCwd,
        env: {
          ...definedEnv(options.env),
          ...(options.profile?.microsandbox?.env ?? {}),
        },
        columns: options.columns,
        rows: options.rows,
        terminalName: options.name ?? "xterm-256color",
        metadata: {
          requestedBoundary: "sandbox",
          effectiveBoundary: "sandbox",
          backendId: this.descriptor.id,
          shellDialect: this.descriptor.shellDialect,
          capabilities: [...this.descriptor.capabilities].sort(),
          capabilityProviders: this.descriptor.capabilityProviders,
          persistenceScope: this.descriptor.persistenceScope,
          sandboxId: opened.id,
        },
        signal: options.signal,
      });
    } catch (error) {
      if (opened) await stopSession(opened.session, settings.stopTimeoutMs);
      materialized.cleanup();
      if (isSandboxUnavailableError(error)) throw error;
      throw toTerminalSpawnError(error, command, args, guestCwd);
    }
  }

  private resolveTerminalRuntime(): SeneraTerminalSidecarRuntime {
    if (this.terminalRuntime) return this.terminalRuntime;
    if (this.runtimePaths) return resolvePreparedSeneraTerminalSidecarGuestRuntime(this.runtimePaths.baseDir);
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "Sandbox terminal runtime paths are not configured.",
      {
        backend: this.descriptor.id,
        reason: "terminal_runtime_unconfigured",
      },
    );
  }

  private async createSession(
    profile: SeneraProcessExecutionRequest["profile"],
    guestWorkdir: string,
    settings: SeneraMicrosandboxSettings,
    rootfsCopies: SeneraMicrosandboxCreateRequest["rootfsCopies"],
    maxDurationMs: number,
  ): Promise<{ id: string; session: SeneraMicrosandboxSession }> {
    const id = this.sandboxNameFactory();
    try {
      const session = await this.sdk.createSandbox({
        name: id,
        image: settings.image,
        workspaceRoot: this.workspaceRoot,
        guestWorkspaceRoot: settings.guestWorkspaceRoot,
        workspaceMount: profile?.microsandbox?.workspaceMount ?? "readonly",
        writableMounts: profile?.microsandbox?.writableMounts ?? [],
        guestWorkdir,
        rootfsCopies,
        env: profile?.microsandbox?.env ?? {},
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
        maxDurationSeconds: timeoutSeconds(maxDurationMs),
      });
      return { id, session };
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

  private effectiveSettings(profile: SeneraProcessExecutionRequest["profile"]): SeneraMicrosandboxSettings {
    return resolveSeneraMicrosandboxSettings({
      ...this.settings,
      image: profile?.microsandbox?.image ?? this.settings.image,
      guestWorkspaceRoot: profile?.microsandbox?.guestWorkspaceRoot ?? this.settings.guestWorkspaceRoot,
      network: profile?.microsandbox?.network ?? this.settings.network,
    });
  }

  private async collectExecution(
    session: SeneraMicrosandboxSession,
    request: SeneraProcessExecutionRequest & { env: Record<string, string> },
    cleanupTimeoutMs: number,
  ): Promise<SeneraShellExecutionResult> {
    const truncateOutput = request.outputOverflow === "truncate";
    const output = new SeneraProcessOutputBuffer({
      // Termination still aborts on overflow, but the output retained while the
      // sandbox is being killed must remain bounded as well.
      maxStdoutBytes: request.limits.maxStdoutBytes,
      maxStderrBytes: request.limits.maxStderrBytes,
    });
    let exitCode: number | null = null;
    let cancellationError: SeneraExecutionError | undefined;
    let cleanupPromise: Promise<void> | undefined;
    let primaryError: SeneraExecutionError | undefined;
    let outputSpoolFailure: SeneraExecutionError | undefined;
    let result: SeneraShellExecutionResult | undefined;
    let finalError: SeneraExecutionError | undefined;
    let rejectCancellation!: (error: unknown) => void;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const ensureCleanup = (): Promise<void> => (cleanupPromise ??= stopSession(session, cleanupTimeoutMs));
    const cancel = (error: SeneraExecutionError): void => {
      cancellationError ??= error;
      void ensureCleanup().then(
        () => rejectCancellation(cancellationError),
        () => rejectCancellation(cancellationError),
      );
    };
    const timer =
      request.timeoutMs > 0
        ? setTimeout(
            () =>
              cancel(
                new SeneraExecutionError(
                  SeneraExecutionErrorCodes.Timeout,
                  `命令执行超时，超过 ${request.timeoutMs}ms。`,
                  { timeoutMs: request.timeoutMs, backend: this.kind },
                ),
              ),
            request.timeoutMs,
          )
        : undefined;
    const abortListener = (): void => {
      cancel(new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted"));
    };

    request.signal?.addEventListener("abort", abortListener, { once: true });
    try {
      const iterator = session.exec(request)[Symbol.asyncIterator]();
      for (;;) {
        const next = await Promise.race([iterator.next(), cancellation]);
        if (next.done) break;
        const event = next.value;
        throwIfCancelled(cancellationError);
        await applyMicrosandboxExecEvent({
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
      result = {
        stdout: output.stdout(),
        stderr: output.stderr(),
        exitCode,
        signal: null,
        outputCapture: request.outputSpool?.descriptor,
        ...(truncateOutput
          ? {
              stdoutBytes: output.stdoutBytes,
              stderrBytes: output.stderrBytes,
              stdoutTruncated: output.stdoutTruncated,
              stderrTruncated: output.stderrTruncated,
            }
          : {}),
      };
    } catch (error) {
      primaryError = cancellationError ?? toExecutionError(error, request);
    } finally {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", abortListener);
      try {
        await request.outputSpool?.close();
      } catch (error) {
        outputSpoolFailure = normalizeSeneraExecutionDiagnostic(error, SeneraExecutionErrorCodes.Unknown, {
          reason: "output_spool_failed",
        });
      }
      cleanupPromise ??= stopSession(session, cleanupTimeoutMs);
      let cleanupError: SeneraExecutionError | undefined;
      try {
        await cleanupPromise;
      } catch (error) {
        cleanupError = normalizeSeneraExecutionDiagnostic(error, SeneraExecutionErrorCodes.CleanupFailed, {
          reason: "sandbox_cleanup_failed",
          backend: this.kind,
        });
      }
      finalError = primaryError;
      if (cleanupError) {
        finalError = finalError ? attachSeneraExecutionDiagnostic(finalError, "cleanup", cleanupError) : cleanupError;
      }
      if (outputSpoolFailure) {
        finalError = finalError
          ? attachSeneraExecutionDiagnostic(finalError, "outputSpool", outputSpoolFailure)
          : outputSpoolFailure;
      }
    }

    if (finalError) throw finalError;
    return result!;
  }
}

function assertMicrosandboxProfile(profile: SeneraProcessExecutionRequest["profile"]): void {
  if (profile?.backend === "local") {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "执行策略声明使用本地进程后端，已跳过 microsandbox。",
      {
        backend: "microsandbox",
        profile: profile.name,
      },
    );
  }

  if (profile?.backend === "sandbox" && !profile.microsandbox) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "沙箱进程缺少 microsandbox 执行画像，已跳过 microsandbox 后端。",
      {
        backend: "microsandbox",
        profile: profile.name,
      },
    );
  }
}

function throwIfCancelled(error: SeneraExecutionError | undefined): void {
  if (error) throw error;
}

async function applyMicrosandboxExecEvent(input: {
  event: SeneraMicrosandboxExecEvent;
  output: SeneraProcessOutputBuffer;
  request: SeneraProcessExecutionRequest;
  setExitCode: (code: number) => void;
  cancel: (error: SeneraExecutionError) => void;
}): Promise<void> {
  const handlers = {
    stdout: async ({ data }: Extract<SeneraMicrosandboxExecEvent, { kind: "stdout" }>) => {
      input.output.pushStdout(data);
      const accepted = input.request.outputSpool?.write("stdout", data) ?? true;
      if (accepted === false) await input.request.outputSpool?.waitForDrain("stdout");
      if (input.output.stdoutBytes <= input.request.limits.maxStdoutBytes) {
        input.request.onOutput?.({
          stream: "stdout",
          data: Buffer.from(data),
          totalBytes: input.output.stdoutBytes,
        });
      }
      enforceOutputLimit({
        actualBytes: input.output.stdoutBytes,
        maxBytes: input.request.limits.maxStdoutBytes,
        code: SeneraExecutionErrorCodes.StdoutLimitExceeded,
        message: `stdout 超过 ${input.request.limits.maxStdoutBytes} 字节。`,
        cancel: input.cancel,
        truncate: input.request.outputOverflow === "truncate",
      });
    },
    stderr: async ({ data }: Extract<SeneraMicrosandboxExecEvent, { kind: "stderr" }>) => {
      input.output.pushStderr(data);
      const accepted = input.request.outputSpool?.write("stderr", data) ?? true;
      if (accepted === false) await input.request.outputSpool?.waitForDrain("stderr");
      if (input.output.stderrBytes <= input.request.limits.maxStderrBytes) {
        input.request.onOutput?.({
          stream: "stderr",
          data: Buffer.from(data),
          totalBytes: input.output.stderrBytes,
        });
      }
      enforceOutputLimit({
        actualBytes: input.output.stderrBytes,
        maxBytes: input.request.limits.maxStderrBytes,
        code: SeneraExecutionErrorCodes.StderrLimitExceeded,
        message: `stderr 超过 ${input.request.limits.maxStderrBytes} 字节。`,
        cancel: input.cancel,
        truncate: input.request.outputOverflow === "truncate",
      });
    },
    exit: async ({ code }: Extract<SeneraMicrosandboxExecEvent, { kind: "exit" }>) => {
      input.setExitCode(code);
    },
  } satisfies {
    [K in SeneraMicrosandboxExecEvent["kind"]]: (
      event: Extract<SeneraMicrosandboxExecEvent, { kind: K }>,
    ) => Promise<void>;
  };

  await handlers[input.event.kind](input.event as never);
}

function enforceOutputLimit(input: {
  actualBytes: number;
  maxBytes: number;
  code: typeof SeneraExecutionErrorCodes.StdoutLimitExceeded | typeof SeneraExecutionErrorCodes.StderrLimitExceeded;
  message: string;
  cancel: (error: SeneraExecutionError) => void;
  truncate: boolean;
}): void {
  if (input.truncate || input.actualBytes <= input.maxBytes) return;
  input.cancel(
    new SeneraExecutionError(input.code, input.message, {
      maxBytes: input.maxBytes,
      actualBytes: input.actualBytes,
    }),
  );
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
    Object.entries(env ?? {}).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  );
}

const stoppedSessions = new WeakMap<SeneraMicrosandboxSession, Promise<void>>();

function stopSession(session: SeneraMicrosandboxSession, timeoutMs: number): Promise<void> {
  const existing = stoppedSessions.get(session);
  if (existing) return existing;
  const cleanup = stopSessionOnce(session, timeoutMs).catch((error: unknown) => {
    stoppedSessions.delete(session);
    throw error;
  });
  stoppedSessions.set(session, cleanup);
  return cleanup;
}

async function stopSessionOnce(session: SeneraMicrosandboxSession, timeoutMs: number): Promise<void> {
  try {
    await session.stop(timeoutMs);
    return;
  } catch (stopError) {
    try {
      await withDeadline(session.kill(), timeoutMs);
    } catch (killError) {
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.CleanupFailed,
        "microsandbox 在 stop 和 kill deadline 后仍未确认释放。",
        { reason: "sandbox_termination_unconfirmed", timeoutMs },
        new AggregateError([stopError, killError], "microsandbox cleanup failed."),
      );
    }
  }
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`cleanup exceeded ${timeoutMs}ms`)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function prepareWritableMounts(profile: SeneraProcessExecutionRequest["profile"]): Promise<void> {
  await Promise.all(
    (profile?.microsandbox?.writableMounts ?? []).map((mount) => mkdir(mount.hostPath, { recursive: true })),
  );
}

async function materializeRootfsBundles(profile: SeneraProcessExecutionRequest["profile"]): Promise<{
  rootfsCopies: SeneraMicrosandboxCreateRequest["rootfsCopies"];
  cleanup(): void;
}> {
  const bundles = await Promise.all(
    (profile?.microsandbox?.rootfsBundles ?? []).map(async (bundle) => ({
      bundle: await createSeneraProcessRootfsBundle({
        workspaceRoot: bundle.workspaceRoot,
        packageRoot: bundle.packageRoot,
      }),
      guestPath: bundle.guestPath,
    })),
  );

  return {
    rootfsCopies: [
      ...(profile?.microsandbox?.rootfsCopies ?? []),
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

function isSandboxUnavailableError(error: unknown): error is SeneraExecutionError {
  return error instanceof SeneraExecutionError && error.code === SeneraExecutionErrorCodes.SandboxUnavailable;
}

function toTerminalSpawnError(
  error: unknown,
  command: string,
  args: readonly string[],
  cwd: string,
): SeneraExecutionError {
  if (error instanceof SeneraExecutionError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.SpawnFailed,
    cause.message,
    { command, args, cwd, backend: "microsandbox-sidecar" },
    cause,
  );
}

function toExecutionError(error: unknown, request: SeneraProcessExecutionRequest): SeneraExecutionError {
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
