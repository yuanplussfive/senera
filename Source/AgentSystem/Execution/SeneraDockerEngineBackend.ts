import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraShellExecutionResult,
} from "./SeneraExecutionTypes.js";
import type { SeneraProcessExecutionBackend, SeneraProcessExecutionRequest } from "./SeneraProcessExecutionBackend.js";
import { SeneraProcessOutputBuffer } from "./SeneraProcessOutputBuffer.js";
import type { SeneraShellInvocation } from "./SeneraShellPlatform.js";
import { SeneraShellDialects } from "./SeneraShellCommand.js";
import { isSeneraShellDialectCompatible } from "./SeneraShellCommand.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawnOptions,
} from "./SeneraPersistentProcessTypes.js";
import type { SeneraSandboxProcessEvent, SeneraSandboxWorkerClient } from "./SeneraSandboxWorkerTypes.js";
import { openSeneraTerminalSidecar } from "./SeneraTerminalSidecarClient.js";
import { SeneraSandboxTerminalSidecarChannel } from "./SeneraTerminalSidecarChannel.js";
import {
  SeneraTerminalCapabilityProviders,
  type SeneraTerminalBackend,
  type SeneraTerminalChild,
  type SeneraTerminalSpawnOptions,
} from "./SeneraTerminalTypes.js";
import {
  readAgentDockerEngineRuntimeContract,
  resolveAgentDockerEngineGuestWorkspaceRoot,
  type AgentDockerEngineSandboxProvider,
  type ResolvedAgentDockerEngineRuntimeContract,
} from "../Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";
import {
  prepareSeneraSandboxExecutionContext,
  releaseSeneraSandboxResources,
  type SeneraSandboxCleanupResource,
} from "./SeneraSandboxExecutionContext.js";
import {
  createSeneraSandboxTerminalDescriptor,
  projectSeneraSandboxTerminalMetadata,
} from "./SeneraSandboxTerminalDescriptor.js";

export interface SeneraDockerEngineBackendOptions {
  workspaceRoot: string;
  worker: SeneraSandboxWorkerClient;
  provider?: AgentDockerEngineSandboxProvider;
  runtimeContract?: ResolvedAgentDockerEngineRuntimeContract;
  runtimeReady?: () => boolean;
  requestIdFactory?: () => string;
  /** Override for the sandbox guest workspace root. Defaults to the runtime contract value when omitted. */
  guestWorkspaceRoot?: string;
}

export class SeneraDockerEngineBackend implements SeneraProcessExecutionBackend, SeneraTerminalBackend {
  readonly kind: AgentDockerEngineSandboxProvider;
  readonly shellDialect = SeneraShellDialects.Posix;
  readonly descriptor;
  private readonly resolvedContract: ResolvedAgentDockerEngineRuntimeContract;
  private readonly runtimeReady: () => boolean;
  private readonly requestIdFactory: () => string;
  private readonly guestWorkspaceRoot: string;

  constructor(private readonly options: SeneraDockerEngineBackendOptions) {
    this.resolvedContract =
      options.runtimeContract ?? readAgentDockerEngineRuntimeContract(options.provider ?? "docker-engine");
    this.kind = options.provider ?? this.resolvedContract.contract.provider;
    if (this.resolvedContract.contract.provider !== this.kind) {
      throw new Error(
        `Docker Engine backend contract/provider mismatch: ${this.resolvedContract.contract.provider} != ${this.kind}.`,
      );
    }
    this.descriptor = createSeneraSandboxTerminalDescriptor(
      `${this.kind}-sidecar`,
      SeneraTerminalCapabilityProviders.DockerEngine,
    );
    this.runtimeReady = options.runtimeReady ?? (() => true);
    this.requestIdFactory = options.requestIdFactory ?? randomUUID;
    this.guestWorkspaceRoot =
      options.guestWorkspaceRoot ?? resolveAgentDockerEngineGuestWorkspaceRoot(this.options.workspaceRoot, this.kind);
  }

  resolveShellInvocation(command: string): SeneraShellInvocation {
    const shell = this.resolvedContract.contract.guest.shell;
    return { command: shell.command, args: [...shell.arguments, command] };
  }

  async executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult> {
    assertDockerEngineRequest(request, this.runtimeReady(), this.kind);
    const contract = this.resolvedContract.contract;
    const context = await prepareSeneraSandboxExecutionContext({
      workspaceRoot: this.options.workspaceRoot,
      cwd: request.cwd,
      guestWorkspaceRoot: this.guestWorkspaceRoot,
      guestWorkdir: request.profile?.sandbox?.guestWorkdir,
      environment: request.env,
      profile: request.profile,
    });
    let handle: Awaited<ReturnType<SeneraSandboxWorkerClient["start"]>> | undefined;
    let result: SeneraShellExecutionResult | undefined;
    let primaryError: SeneraExecutionError | undefined;
    try {
      handle = await this.options.worker.start({
        requestId: this.requestIdFactory(),
        command: request.command,
        arguments: [...request.args],
        cwd: context.guestCwd,
        environment: context.environment,
        ...(request.stdin === undefined ? {} : { stdin: request.stdin }),
        interactive: false,
        workspaceMount: request.profile?.sandbox?.workspaceMount ?? "readonly",
        network: request.profile?.sandbox?.network ?? contract.defaults.network,
        rootfsCopies: context.rootfsCopies.map((copy) => ({
          sourcePath: copy.hostPath,
          guestPath: copy.guestPath,
        })),
        writableMounts: (request.profile?.sandbox?.writableMounts ?? []).map((entry) => ({
          sourcePath: entry.hostPath,
          guestPath: entry.guestPath,
        })),
        limits: {
          cpus: contract.defaults.cpuCount,
          memoryMiB: contract.defaults.memoryMiB,
          processCount: contract.defaults.processCount,
          timeoutMs: request.timeoutMs,
        },
      });
      if (request.stdin !== undefined) await handle.write(Buffer.from(request.stdin));
      await handle.endInput();
      result = await collectDockerEngineExecution(handle, request, this.kind);
    } catch (error) {
      primaryError = toDockerEngineExecutionError(error, request, this.kind);
    }
    await releaseSeneraSandboxResources(
      [...(primaryError && handle ? [dockerEngineProcessCleanup(handle)] : []), context.rootfsCleanup],
      {
        backend: this.kind,
        primaryError,
      },
    );
    if (!result) throw new Error("Docker Engine execution completed without a result or an error.");
    return result;
  }

  async spawnPersistentProcess(
    command: string,
    args: readonly string[],
    options: SeneraPersistentProcessSpawnOptions,
  ): Promise<SeneraPersistentProcessChild> {
    const contract = this.resolvedContract.contract;
    const contractMaximumMs = contract.limits.maxExecutionSeconds * 1000;
    const timeoutMs = Math.min(options.maxDurationMs ?? contractMaximumMs, contractMaximumMs);
    assertDockerEngineRequest(
      {
        command,
        args,
        cwd: options.cwd,
        timeoutMs,
        limits: { timeoutMs, maxStdoutBytes: 1, maxStderrBytes: 1 },
        signal: options.signal,
        profile: options.profile,
      },
      this.runtimeReady(),
      this.kind,
    );
    const invocation = resolvePersistentSandboxInvocation(command, args, options, this);
    const context = await prepareSeneraSandboxExecutionContext({
      workspaceRoot: this.options.workspaceRoot,
      cwd: options.cwd,
      guestWorkspaceRoot: this.guestWorkspaceRoot,
      guestWorkdir: options.profile?.sandbox?.guestWorkdir,
      environment: options.env,
      profile: options.profile,
    });
    let handle: Awaited<ReturnType<SeneraSandboxWorkerClient["start"]>>;
    try {
      handle = await this.options.worker.start({
        requestId: this.requestIdFactory(),
        command: invocation.command,
        arguments: [...invocation.args],
        cwd: context.guestCwd,
        environment: context.environment,
        interactive: false,
        workspaceMount: options.profile?.sandbox?.workspaceMount ?? "readonly",
        network: options.profile?.sandbox?.network ?? contract.defaults.network,
        rootfsCopies: context.rootfsCopies.map((copy) => ({ sourcePath: copy.hostPath, guestPath: copy.guestPath })),
        writableMounts: (options.profile?.sandbox?.writableMounts ?? []).map((entry) => ({
          sourcePath: entry.hostPath,
          guestPath: entry.guestPath,
        })),
        limits: {
          cpus: contract.defaults.cpuCount,
          memoryMiB: contract.defaults.memoryMiB,
          processCount: contract.defaults.processCount,
          timeoutMs,
        },
      });
    } catch (error) {
      const primaryError = toDockerEnginePersistentSpawnError(error, command, args, context.guestCwd, this.kind);
      await releaseSeneraSandboxResources([context.rootfsCleanup], { backend: this.kind, primaryError });
      throw primaryError;
    }

    try {
      await releaseSeneraSandboxResources([context.rootfsCleanup], { backend: this.kind });
      return new SeneraSandboxPersistentProcessChild(handle, options.signal);
    } catch (error) {
      const primaryError = toDockerEnginePersistentSpawnError(error, command, args, context.guestCwd, this.kind);
      await releaseSeneraSandboxResources([dockerEngineProcessCleanup(handle)], {
        backend: this.kind,
        primaryError,
      });
      throw primaryError;
    }
  }

  async spawn(
    command: string,
    args: readonly string[],
    options: SeneraTerminalSpawnOptions,
  ): Promise<SeneraTerminalChild> {
    assertDockerEngineTerminalRequest(options, this.runtimeReady(), this.kind);
    const contract = this.resolvedContract.contract;
    const context = await prepareSeneraSandboxExecutionContext({
      workspaceRoot: this.options.workspaceRoot,
      cwd: options.cwd,
      guestWorkspaceRoot: this.guestWorkspaceRoot,
      guestWorkdir: options.profile?.sandbox?.guestWorkdir,
      environment: options.env,
      profile: options.profile,
    });
    let handle: Awaited<ReturnType<SeneraSandboxWorkerClient["start"]>>;
    try {
      handle = await this.options.worker.start({
        requestId: this.requestIdFactory(),
        command: contract.guest.terminal.command,
        arguments: [...contract.guest.terminal.arguments],
        cwd: context.guestCwd,
        environment: context.environment,
        interactive: true,
        workspaceMount: options.profile?.sandbox?.workspaceMount ?? "readonly",
        network: options.profile?.sandbox?.network ?? contract.defaults.network,
        rootfsCopies: context.rootfsCopies.map((copy) => ({ sourcePath: copy.hostPath, guestPath: copy.guestPath })),
        writableMounts: (options.profile?.sandbox?.writableMounts ?? []).map((entry) => ({
          sourcePath: entry.hostPath,
          guestPath: entry.guestPath,
        })),
        limits: {
          cpus: contract.defaults.cpuCount,
          memoryMiB: contract.defaults.memoryMiB,
          processCount: contract.defaults.processCount,
          timeoutMs: options.maxDurationMs as number,
        },
      });
    } catch (error) {
      const primaryError = toDockerEngineTerminalSpawnError(error, command, args, context.guestCwd, this.descriptor.id);
      await releaseSeneraSandboxResources([context.rootfsCleanup], {
        backend: this.descriptor.id,
        primaryError,
      });
      throw primaryError;
    }

    try {
      await releaseSeneraSandboxResources([context.rootfsCleanup], { backend: this.descriptor.id });
      return openSeneraTerminalSidecar({
        channel: new SeneraSandboxTerminalSidecarChannel(handle),
        command,
        args,
        cwd: context.guestCwd,
        env: context.environment,
        columns: options.columns,
        rows: options.rows,
        terminalName: options.name ?? "xterm-256color",
        metadata: projectSeneraSandboxTerminalMetadata(this.descriptor, handle.id),
        signal: options.signal,
      });
    } catch (error) {
      const primaryError = toDockerEngineTerminalSpawnError(error, command, args, context.guestCwd, this.descriptor.id);
      await releaseSeneraSandboxResources([dockerEngineProcessCleanup(handle)], {
        backend: this.descriptor.id,
        primaryError,
      });
      throw primaryError;
    }
  }
}

class SeneraSandboxPersistentProcessChild extends EventEmitter implements SeneraPersistentProcessChild {
  private readonly stdoutEvents = new EventEmitter();
  private readonly stderrEvents = new EventEmitter();
  private readonly inputEvents = new EventEmitter();
  private inputQueue: Promise<void> = Promise.resolve();
  private inputEnded = false;
  private closed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  readonly stdout: SeneraPersistentProcessChild["stdout"] = {
    on: (event, listener) => {
      this.stdoutEvents.on(event, listener);
    },
  };

  readonly stderr: NonNullable<SeneraPersistentProcessChild["stderr"]> = {
    on: (event, listener) => {
      this.stderrEvents.on(event, listener);
    },
  };

  readonly stdin: SeneraPersistentProcessChild["stdin"] = {
    write: (chunk) => this.queueInput(() => this.handle.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))),
    once: (event, listener) => {
      this.inputEvents.once(event, listener);
    },
    on: (event, listener) => {
      this.inputEvents.on(event, listener);
    },
    off: (event, listener) => {
      this.inputEvents.off(event, listener);
    },
    end: () => {
      if (this.inputEnded) return;
      this.inputEnded = true;
      this.queueInputOperation(() => this.handle.endInput());
    },
  };

  constructor(
    private readonly handle: Awaited<ReturnType<SeneraSandboxWorkerClient["start"]>>,
    signal?: AbortSignal,
  ) {
    super();
    const abort = (): void => {
      void this.terminateTree("SIGKILL").catch((error) => this.emit("error", asError(error)));
    };
    signal?.addEventListener("abort", abort, { once: true });
    this.once("close", () => signal?.removeEventListener("abort", abort));
    setImmediate(() => void this.consumeEvents());
    if (signal?.aborted) abort();
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.closed) return false;
    void this.terminateTree(signal).catch((error) => this.emit("error", asError(error)));
    return true;
  }

  async terminateTree(signal: NodeJS.Signals): Promise<void> {
    await this.handle.terminate(projectSandboxSignal(signal));
  }

  private queueInput(operation: () => Promise<void>): boolean {
    if (this.closed || this.inputEnded) return false;
    this.queueInputOperation(operation);
    return false;
  }

  private queueInputOperation(operation: () => Promise<void>): void {
    this.inputQueue = this.inputQueue
      .then(operation)
      .catch((error) => this.emit("error", asError(error)))
      .then(() => {
        this.inputEvents.emit("drain");
      });
  }

  private async consumeEvents(): Promise<void> {
    try {
      for await (const event of this.handle.events) {
        if (event.kind === "output") {
          (event.stream === "stdout" ? this.stdoutEvents : this.stderrEvents).emit("data", event.data);
          continue;
        }
        this.finish(event.code, event.signal);
        return;
      }
      throw new Error("Sandbox worker event stream ended before publishing an exit event.");
    } catch (error) {
      this.emit("error", asError(error));
      this.finish(null, null);
    }
  }

  private finish(exitCode: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    this.closed = true;
    this.exitCode = exitCode;
    this.signalCode = signal;
    this.emit("close", exitCode, signal);
  }
}

async function collectDockerEngineExecution(
  handle: Awaited<ReturnType<SeneraSandboxWorkerClient["start"]>>,
  request: SeneraProcessExecutionRequest,
  provider: AgentDockerEngineSandboxProvider,
): Promise<SeneraShellExecutionResult> {
  const output = new SeneraProcessOutputBuffer({
    maxStdoutBytes: request.limits.maxStdoutBytes,
    maxStderrBytes: request.limits.maxStderrBytes,
  });
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let cancellation: SeneraExecutionError | undefined;
  let rejectCancellation!: (error: SeneraExecutionError) => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });
  const cancel = (error: SeneraExecutionError): void => {
    if (cancellation) return;
    cancellation = error;
    void handle.terminate(error.code === SeneraExecutionErrorCodes.Aborted ? "kill" : "terminate").finally(() => {
      rejectCancellation(error);
    });
  };
  const timer =
    Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
      ? setTimeout(() => {
          cancel(
            new SeneraExecutionError(SeneraExecutionErrorCodes.Timeout, `命令执行超时，超过 ${request.timeoutMs}ms。`, {
              backend: provider,
              timeoutMs: request.timeoutMs,
            }),
          );
        }, request.timeoutMs)
      : undefined;
  timer?.unref();
  const abort = (): void => cancel(new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted"));
  request.signal?.addEventListener("abort", abort, { once: true });
  try {
    const iterator = handle.events[Symbol.asyncIterator]();
    for (;;) {
      const next = await Promise.race([iterator.next(), cancelled]);
      if (next.done) break;
      await applyDockerEngineEvent(next.value, output, request, provider, cancel, (event) => {
        exitCode = event.code;
        exitSignal = event.signal;
      });
    }
    if (cancellation) throw cancellation;
    return {
      stdout: output.stdout(),
      stderr: output.stderr(),
      exitCode,
      signal: exitSignal,
      outputCapture: request.outputSpool?.descriptor,
      ...(request.outputOverflow === "truncate"
        ? {
            stdoutBytes: output.stdoutBytes,
            stderrBytes: output.stderrBytes,
            stdoutTruncated: output.stdoutTruncated,
            stderrTruncated: output.stderrTruncated,
          }
        : {}),
    };
  } finally {
    if (timer) clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
    await request.outputSpool?.close();
  }
}

async function applyDockerEngineEvent(
  event: SeneraSandboxProcessEvent,
  output: SeneraProcessOutputBuffer,
  request: SeneraProcessExecutionRequest,
  provider: AgentDockerEngineSandboxProvider,
  cancel: (error: SeneraExecutionError) => void,
  setExit: (event: Extract<SeneraSandboxProcessEvent, { kind: "exit" }>) => void,
): Promise<void> {
  if (event.kind === "exit") {
    setExit(event);
    return;
  }
  const before = event.stream === "stdout" ? output.stdoutBytes : output.stderrBytes;
  if (event.stream === "stdout") output.pushStdout(event.data);
  else output.pushStderr(event.data);
  const totalBytes = event.stream === "stdout" ? output.stdoutBytes : output.stderrBytes;
  const accepted = request.outputSpool?.write(event.stream, event.data) ?? true;
  if (!accepted) await request.outputSpool?.waitForDrain(event.stream);
  const maxBytes = event.stream === "stdout" ? request.limits.maxStdoutBytes : request.limits.maxStderrBytes;
  if (before < maxBytes) request.onOutput?.({ stream: event.stream, data: event.data, totalBytes });
  if (request.outputOverflow !== "truncate" && totalBytes > maxBytes) {
    cancel(
      new SeneraExecutionError(
        event.stream === "stdout"
          ? SeneraExecutionErrorCodes.StdoutLimitExceeded
          : SeneraExecutionErrorCodes.StderrLimitExceeded,
        `${event.stream} 超过 ${maxBytes} 字节。`,
        { maxBytes, actualBytes: totalBytes, backend: provider },
      ),
    );
  }
}

function assertDockerEngineRequest(
  request: SeneraProcessExecutionRequest,
  runtimeReady: boolean,
  provider: AgentDockerEngineSandboxProvider,
): void {
  if (request.signal?.aborted) throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
  if (request.profile?.backend !== "sandbox" || !request.profile.sandbox) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      `${provider} execution requires an explicit sandbox profile.`,
      { backend: provider, profile: request.profile?.name },
    );
  }
  if (!runtimeReady) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      `The ${provider} runtime is not ready. Wait for sandbox preparation to finish.`,
      { backend: provider, reason: "sandbox_runtime_not_ready" },
    );
  }
}

function assertDockerEngineTerminalRequest(
  options: SeneraTerminalSpawnOptions,
  runtimeReady: boolean,
  provider: AgentDockerEngineSandboxProvider,
): void {
  if (!options.maxDurationMs || options.maxDurationMs <= 0) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SpawnFailed,
      `A ${provider} terminal requires a positive maximum duration.`,
      { backend: `${provider}-sidecar` },
    );
  }
  assertDockerEngineRequest(
    {
      command: "terminal",
      args: [],
      cwd: options.cwd,
      timeoutMs: options.maxDurationMs,
      limits: { maxStdoutBytes: 1, maxStderrBytes: 1, timeoutMs: options.maxDurationMs },
      profile: options.profile,
      signal: options.signal,
    },
    runtimeReady,
    provider,
  );
}

function toDockerEngineExecutionError(
  error: unknown,
  request: SeneraProcessExecutionRequest,
  provider: AgentDockerEngineSandboxProvider,
): SeneraExecutionError {
  if (error instanceof SeneraExecutionError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.SpawnFailed,
    cause.message,
    { backend: provider, command: request.command, args: request.args, cwd: request.cwd },
    cause,
  );
}

function toDockerEngineTerminalSpawnError(
  error: unknown,
  command: string,
  args: readonly string[],
  cwd: string,
  backend: string,
): SeneraExecutionError {
  if (error instanceof SeneraExecutionError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.SpawnFailed,
    cause.message,
    { backend, command, args, cwd },
    cause,
  );
}

function toDockerEnginePersistentSpawnError(
  error: unknown,
  command: string,
  args: readonly string[],
  cwd: string,
  backend: string,
): SeneraExecutionError {
  if (error instanceof SeneraExecutionError) return error;
  const cause = asError(error);
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.SpawnFailed,
    cause.message,
    { backend, command, args, cwd, lifecycle: "persistent" },
    cause,
  );
}

function resolvePersistentSandboxInvocation(
  command: string,
  args: readonly string[],
  options: SeneraPersistentProcessSpawnOptions,
  backend: Pick<SeneraDockerEngineBackend, "resolveShellInvocation" | "shellDialect">,
): { command: string; args: readonly string[] } {
  const shellCommand = options.shellCommand;
  if (!shellCommand) return { command, args };
  if (!isSeneraShellDialectCompatible(shellCommand.dialect, backend.shellDialect)) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SpawnFailed,
      `Shell dialect ${shellCommand.dialect} is not supported by the sandbox persistent process backend.`,
      {
        reason: "shell_dialect_unsupported",
        requestedDialect: shellCommand.dialect,
        availableDialect: backend.shellDialect,
        backend: "sandbox-persistent",
      },
    );
  }
  return backend.resolveShellInvocation(shellCommand.script);
}

function projectSandboxSignal(signal: NodeJS.Signals): "interrupt" | "terminate" | "kill" {
  if (signal === "SIGINT") return "interrupt";
  if (signal === "SIGKILL") return "kill";
  return "terminate";
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function dockerEngineProcessCleanup(
  handle: Awaited<ReturnType<SeneraSandboxWorkerClient["start"]>>,
): SeneraSandboxCleanupResource {
  return {
    diagnosticKey: "cleanup",
    reason: "docker_engine_process_cleanup_failed",
    release: () => handle.terminate("kill"),
  };
}
