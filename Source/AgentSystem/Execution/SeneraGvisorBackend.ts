import { randomUUID } from "node:crypto";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraShellExecutionResult,
} from "./SeneraExecutionTypes.js";
import type { SeneraProcessExecutionBackend, SeneraProcessExecutionRequest } from "./SeneraProcessExecutionBackend.js";
import { SeneraProcessOutputBuffer } from "./SeneraProcessOutputBuffer.js";
import { projectMicrosandboxWorkspaceMount } from "./SeneraMicrosandboxPaths.js";
import {
  materializeSeneraSandboxRootfs,
  prepareSeneraSandboxWritableMounts,
} from "./SeneraSandboxProfileMaterializer.js";
import type { SeneraShellInvocation } from "./SeneraShellPlatform.js";
import { SeneraShellDialects } from "./SeneraShellCommand.js";
import type { SeneraGvisorProcessEvent, SeneraGvisorWorkerClient } from "./SeneraGvisorTypes.js";
import type { AgentSandboxRuntimePaths } from "../Sandbox/AgentSandboxRuntimePreparation.js";
import { openSeneraTerminalSidecar } from "./SeneraTerminalSidecarClient.js";
import { SeneraGvisorTerminalSidecarChannel } from "./SeneraTerminalSidecarChannel.js";
import { resolvePreparedSeneraTerminalSidecarGuestRuntime } from "./SeneraTerminalSidecarGuestRuntime.js";
import {
  SeneraTerminalCapabilityNames,
  SeneraTerminalCapabilityProviders,
  SeneraTerminalPersistenceScopes,
  type SeneraTerminalBackend,
  type SeneraTerminalChild,
  type SeneraTerminalSpawnOptions,
} from "./SeneraTerminalTypes.js";
import {
  readAgentDockerEngineRuntimeContract,
  type AgentDockerEngineSandboxProvider,
  type ResolvedAgentDockerEngineRuntimeContract,
} from "../Sandbox/Gvisor/AgentGvisorRuntimeContract.js";

export interface SeneraGvisorBackendOptions {
  workspaceRoot: string;
  worker: SeneraGvisorWorkerClient;
  provider?: AgentDockerEngineSandboxProvider;
  runtimeContract?: ResolvedAgentDockerEngineRuntimeContract;
  runtimePaths?: AgentSandboxRuntimePaths;
  runtimeReady?: () => boolean;
  requestIdFactory?: () => string;
}

export class SeneraGvisorBackend implements SeneraProcessExecutionBackend, SeneraTerminalBackend {
  readonly kind: AgentDockerEngineSandboxProvider;
  readonly shellDialect = SeneraShellDialects.Posix;
  readonly descriptor;
  private readonly resolvedContract: ResolvedAgentDockerEngineRuntimeContract;
  private readonly runtimeReady: () => boolean;
  private readonly requestIdFactory: () => string;

  constructor(private readonly options: SeneraGvisorBackendOptions) {
    this.resolvedContract =
      options.runtimeContract ?? readAgentDockerEngineRuntimeContract(options.provider ?? "gvisor");
    this.kind = options.provider ?? this.resolvedContract.contract.provider;
    if (this.resolvedContract.contract.provider !== this.kind) {
      throw new Error(
        `Docker Engine backend contract/provider mismatch: ${this.resolvedContract.contract.provider} != ${this.kind}.`,
      );
    }
    this.descriptor = {
      id: `${this.kind}-sidecar`,
      boundary: "sandbox" as const,
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
        [SeneraTerminalCapabilityNames.Signals]: SeneraTerminalCapabilityProviders.DockerEngine,
      },
      persistenceScope: SeneraTerminalPersistenceScopes.ExecutionResource,
    };
    this.runtimeReady = options.runtimeReady ?? (() => true);
    this.requestIdFactory = options.requestIdFactory ?? randomUUID;
  }

  resolveShellInvocation(command: string): SeneraShellInvocation {
    const shell = this.resolvedContract.contract.guest.shell;
    return { command: shell.command, args: [...shell.arguments, command] };
  }

  async executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult> {
    assertGvisorRequest(request, this.runtimeReady(), this.kind);
    await prepareSeneraSandboxWritableMounts(request.profile);
    const contract = this.resolvedContract.contract;
    const mount = projectMicrosandboxWorkspaceMount({
      workspaceRoot: this.options.workspaceRoot,
      cwd: request.cwd,
      guestWorkspaceRoot: request.profile?.sandbox?.guestWorkspaceRoot ?? contract.guest.workspaceRoot,
    });
    const materialized = await materializeSeneraSandboxRootfs(request.profile);
    try {
      const handle = await this.options.worker.start({
        requestId: this.requestIdFactory(),
        command: request.command,
        arguments: [...request.args],
        cwd: request.profile?.sandbox?.guestWorkdir ?? mount.guestCwd,
        environment: {
          ...definedEnvironment(request.env),
          ...(request.profile?.sandbox?.env ?? {}),
        },
        ...(request.stdin === undefined ? {} : { stdin: request.stdin }),
        interactive: false,
        workspaceMount: request.profile?.sandbox?.workspaceMount ?? "readonly",
        network: request.profile?.sandbox?.network ?? contract.defaults.network,
        rootfsCopies: materialized.rootfsCopies.map((copy) => ({
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
      return await collectGvisorExecution(handle, request, this.kind);
    } catch (error) {
      if (error instanceof SeneraExecutionError) throw error;
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SpawnFailed,
        cause.message,
        { backend: this.kind, command: request.command, args: request.args, cwd: request.cwd },
        cause,
      );
    } finally {
      materialized.cleanup();
    }
  }

  async spawn(
    command: string,
    args: readonly string[],
    options: SeneraTerminalSpawnOptions,
  ): Promise<SeneraTerminalChild> {
    assertGvisorTerminalRequest(options, this.runtimeReady(), this.kind);
    await prepareSeneraSandboxWritableMounts(options.profile);
    const contract = this.resolvedContract.contract;
    const mount = projectMicrosandboxWorkspaceMount({
      workspaceRoot: this.options.workspaceRoot,
      cwd: options.cwd,
      guestWorkspaceRoot: options.profile?.sandbox?.guestWorkspaceRoot ?? contract.guest.workspaceRoot,
    });
    const guestCwd = options.profile?.sandbox?.guestWorkdir ?? mount.guestCwd;
    const materialized = await materializeSeneraSandboxRootfs(options.profile);
    try {
      if (!this.options.runtimePaths) {
        throw new SeneraExecutionError(
          SeneraExecutionErrorCodes.SandboxUnavailable,
          "Docker Engine sandbox terminal runtime paths are not configured.",
          { backend: this.descriptor.id, reason: "terminal_runtime_unconfigured" },
        );
      }
      const terminalRuntime = resolvePreparedSeneraTerminalSidecarGuestRuntime(this.options.runtimePaths.baseDir);
      const handle = await this.options.worker.start({
        requestId: this.requestIdFactory(),
        command: terminalRuntime.guestNodeCommand,
        arguments: [terminalRuntime.guestEntrypoint],
        cwd: guestCwd,
        environment: {
          ...definedEnvironment(options.env),
          ...(options.profile?.sandbox?.env ?? {}),
        },
        interactive: true,
        workspaceMount: options.profile?.sandbox?.workspaceMount ?? "readonly",
        network: options.profile?.sandbox?.network ?? contract.defaults.network,
        rootfsCopies: [
          ...materialized.rootfsCopies.map((copy) => ({ sourcePath: copy.hostPath, guestPath: copy.guestPath })),
          { sourcePath: terminalRuntime.sourceRoot, guestPath: terminalRuntime.guestRoot },
        ],
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
      materialized.cleanup();
      return openSeneraTerminalSidecar({
        channel: new SeneraGvisorTerminalSidecarChannel(handle),
        command,
        args,
        cwd: guestCwd,
        env: {
          ...definedEnvironment(options.env),
          ...(options.profile?.sandbox?.env ?? {}),
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
          sandboxId: handle.id,
        },
        signal: options.signal,
      });
    } catch (error) {
      materialized.cleanup();
      if (error instanceof SeneraExecutionError) throw error;
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SpawnFailed,
        cause.message,
        { backend: this.descriptor.id, command, args, cwd: guestCwd },
        cause,
      );
    }
  }
}

async function collectGvisorExecution(
  handle: Awaited<ReturnType<SeneraGvisorWorkerClient["start"]>>,
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
  const timer = setTimeout(() => {
    cancel(
      new SeneraExecutionError(SeneraExecutionErrorCodes.Timeout, `命令执行超时，超过 ${request.timeoutMs}ms。`, {
        backend: provider,
        timeoutMs: request.timeoutMs,
      }),
    );
  }, request.timeoutMs);
  timer.unref();
  const abort = (): void => cancel(new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted"));
  request.signal?.addEventListener("abort", abort, { once: true });
  try {
    const iterator = handle.events[Symbol.asyncIterator]();
    for (;;) {
      const next = await Promise.race([iterator.next(), cancelled]);
      if (next.done) break;
      await applyGvisorEvent(next.value, output, request, provider, cancel, (event) => {
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
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
    await request.outputSpool?.close();
  }
}

async function applyGvisorEvent(
  event: SeneraGvisorProcessEvent,
  output: SeneraProcessOutputBuffer,
  request: SeneraProcessExecutionRequest,
  provider: AgentDockerEngineSandboxProvider,
  cancel: (error: SeneraExecutionError) => void,
  setExit: (event: Extract<SeneraGvisorProcessEvent, { kind: "exit" }>) => void,
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

function assertGvisorRequest(
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

function assertGvisorTerminalRequest(
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
  assertGvisorRequest(
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

function definedEnvironment(environment: NodeJS.ProcessEnv | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment ?? {}).flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : [])),
  );
}
