import type { ChildProcess } from "node:child_process";
import { spawn } from "cross-spawn";
import kill from "tree-kill";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraShellExecutionResult,
} from "./SeneraExecutionTypes.js";
import { SeneraProcessOutputBuffer } from "./SeneraProcessOutputBuffer.js";
import type { SeneraProcessExecutionBackend, SeneraProcessExecutionRequest } from "./SeneraProcessExecutionBackend.js";
import { resolveSeneraShellInvocation, resolveSeneraShellPlatform } from "./SeneraShellPlatform.js";
import { SeneraProcessEnvironmentPolicy } from "./SeneraProcessEnvironment.js";
import type { SeneraProcessEnvironmentPolicyOptions } from "./SeneraProcessEnvironment.js";
import { normalizeSeneraTerminationGraceMs } from "./SeneraTerminationPolicy.js";
import { attachSeneraExecutionDiagnostic } from "./SeneraExecutionErrorDiagnostics.js";

export type SeneraProcessTreeTerminator = (pid: number, signal: NodeJS.Signals) => Promise<void>;

export interface SeneraNodeProcessBackendOptions {
  terminateProcessTree?: SeneraProcessTreeTerminator;
  terminationGraceMs?: number;
  environmentPolicy?: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions;
}

export class SeneraNodeProcessBackend implements SeneraProcessExecutionBackend {
  readonly kind = "node-local";
  readonly shellDialect = resolveSeneraShellPlatform().family;
  private readonly terminateProcessTree: SeneraProcessTreeTerminator;
  private readonly terminationGraceMs: number;
  private readonly environmentPolicy: SeneraProcessEnvironmentPolicy;

  constructor(options: SeneraNodeProcessBackendOptions = {}) {
    this.terminateProcessTree = options.terminateProcessTree ?? terminateSeneraProcessTree;
    this.terminationGraceMs = normalizeSeneraTerminationGraceMs(options.terminationGraceMs);
    this.environmentPolicy =
      options.environmentPolicy instanceof SeneraProcessEnvironmentPolicy
        ? options.environmentPolicy
        : new SeneraProcessEnvironmentPolicy(options.environmentPolicy);
  }

  resolveShellInvocation(command: string) {
    return resolveSeneraShellInvocation(command);
  }

  async executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult> {
    assertNotAborted(request.signal);

    return new Promise((resolve, reject) => {
      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: this.environmentPolicy.project(process.env, request.env),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      const truncateOutput = request.outputOverflow === "truncate";
      const output = new SeneraProcessOutputBuffer({
        encoding: "auto",
        // Keep the buffer bounded in both policies. `terminate` still aborts on overflow,
        // but must not retain the oversized chunk while the process tree is being stopped.
        maxStdoutBytes: request.limits.maxStdoutBytes,
        maxStderrBytes: request.limits.maxStderrBytes,
      });
      let settled = false;
      let terminalError: SeneraExecutionError | undefined;
      let terminationComplete = false;
      let terminationError: SeneraExecutionError | undefined;
      let rejectionFinalizationStarted = false;
      let timer: ReturnType<typeof setTimeout> | undefined = undefined;
      let resolveChildClosed: () => void;
      const childClosed = new Promise<void>((resolve) => {
        resolveChildClosed = resolve;
      });

      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        request.signal?.removeEventListener("abort", abortListener);
        callback();
      };
      const abortListener = (): void => {
        rejectWith(new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted"));
      };
      const rejectWith = (error: SeneraExecutionError): void => {
        if (settled || terminalError) return;
        terminalError = error;
        void terminateChildProcess({
          child,
          childClosed,
          terminateProcessTree: this.terminateProcessTree,
          graceMs: this.terminationGraceMs,
        }).then(
          () => {
            terminationComplete = true;
            finalizeRejection();
          },
          (error) => {
            terminationComplete = true;
            terminationError = normalizeTerminationError(error);
            finalizeRejection();
          },
        );
      };

      const finalizeRejection = (): void => {
        if (!terminationComplete || rejectionFinalizationStarted || settled) return;
        rejectionFinalizationStarted = true;
        void closeOutputSpool(request.outputSpool).then(
          () => settle(() => reject(buildRejectionError(terminalError!, terminationError))),
          (error) =>
            settle(() => reject(buildRejectionError(terminalError!, terminationError, outputSpoolError(error)))),
        );
      };

      request.signal?.addEventListener("abort", abortListener, { once: true });
      if (request.signal?.aborted) {
        abortListener();
        return;
      }

      timer =
        request.timeoutMs > 0
          ? setTimeout(
              () =>
                rejectWith(
                  new SeneraExecutionError(
                    SeneraExecutionErrorCodes.Timeout,
                    `命令执行超时，超过 ${request.timeoutMs}ms。`,
                    { timeoutMs: request.timeoutMs },
                  ),
                ),
              request.timeoutMs,
            )
          : undefined;

      child.stdout?.on("data", (chunk: Buffer) => {
        if (terminalError) return;
        try {
          output.pushStdout(chunk);
          const accepted = request.outputSpool?.write("stdout", chunk) ?? true;
          if (output.stdoutBytes <= request.limits.maxStdoutBytes) {
            request.onOutput?.({ stream: "stdout", data: chunk, totalBytes: output.stdoutBytes });
          }
          if (accepted === false) {
            child.stdout?.pause();
            void request.outputSpool?.waitForDrain("stdout").then(
              () => child.stdout?.resume(),
              (error) => rejectWith(outputSpoolError(error)),
            );
          }
          if (!truncateOutput && output.stdoutBytes > request.limits.maxStdoutBytes) {
            rejectWith(
              new SeneraExecutionError(
                SeneraExecutionErrorCodes.StdoutLimitExceeded,
                `stdout 超过 ${request.limits.maxStdoutBytes} 字节。`,
                {
                  maxStdoutBytes: request.limits.maxStdoutBytes,
                  actualBytes: output.stdoutBytes,
                },
              ),
            );
          }
        } catch (error) {
          rejectWith(outputSpoolError(error));
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (terminalError) return;
        try {
          output.pushStderr(chunk);
          const accepted = request.outputSpool?.write("stderr", chunk) ?? true;
          if (output.stderrBytes <= request.limits.maxStderrBytes) {
            request.onOutput?.({ stream: "stderr", data: chunk, totalBytes: output.stderrBytes });
          }
          if (accepted === false) {
            child.stderr?.pause();
            void request.outputSpool?.waitForDrain("stderr").then(
              () => child.stderr?.resume(),
              (error) => rejectWith(outputSpoolError(error)),
            );
          }
          if (!truncateOutput && output.stderrBytes > request.limits.maxStderrBytes) {
            rejectWith(
              new SeneraExecutionError(
                SeneraExecutionErrorCodes.StderrLimitExceeded,
                `stderr 超过 ${request.limits.maxStderrBytes} 字节。`,
                {
                  maxStderrBytes: request.limits.maxStderrBytes,
                  actualBytes: output.stderrBytes,
                },
              ),
            );
          }
        } catch (error) {
          rejectWith(outputSpoolError(error));
        }
      });
      child.on("error", (error) => {
        if (terminalError) {
          return;
        }
        const spawnError = new SeneraExecutionError(
          SeneraExecutionErrorCodes.SpawnFailed,
          error instanceof Error ? error.message : String(error),
          {
            command: request.command,
            args: request.args,
            cwd: request.cwd,
          },
          error instanceof Error ? error : undefined,
        );
        void closeOutputSpool(request.outputSpool).then(
          () => settle(() => reject(spawnError)),
          () => settle(() => reject(spawnError)),
        );
      });
      child.on("close", (exitCode, signal) => {
        resolveChildClosed();
        if (terminalError) {
          finalizeRejection();
          return;
        }
        void closeOutputSpool(request.outputSpool).then(
          () =>
            settle(() =>
              resolve({
                stdout: output.stdout(),
                stderr: output.stderr(),
                exitCode,
                signal,
                outputCapture: request.outputSpool?.descriptor,
                ...(truncateOutput
                  ? {
                      stdoutBytes: output.stdoutBytes,
                      stderrBytes: output.stderrBytes,
                      stdoutTruncated: output.stdoutTruncated,
                      stderrTruncated: output.stderrTruncated,
                    }
                  : {}),
              }),
            ),
          (error) => settle(() => reject(outputSpoolError(error))),
        );
      });

      child.stdin?.end(request.stdin);
    });
  }
}

function closeOutputSpool(spool: SeneraProcessExecutionRequest["outputSpool"]): Promise<void> {
  return spool?.close() ?? Promise.resolve();
}

function outputSpoolError(error: unknown): SeneraExecutionError {
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.Unknown,
    error instanceof Error ? error.message : String(error),
    { reason: "output_spool_failed" },
    error instanceof Error ? error : undefined,
  );
}

function normalizeTerminationError(error: unknown): SeneraExecutionError {
  if (error instanceof SeneraExecutionError) return error;
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.CleanupFailed,
    error instanceof Error ? error.message : String(error),
    { reason: "process_tree_termination_failed" },
    error instanceof Error ? error : undefined,
  );
}

interface TerminateChildProcessOptions {
  child: ChildProcess;
  childClosed: Promise<void>;
  terminateProcessTree: SeneraProcessTreeTerminator;
  graceMs: number;
}

async function terminateChildProcess(options: TerminateChildProcessOptions): Promise<void> {
  const { child, childClosed, terminateProcessTree, graceMs } = options;
  const pid = child.pid;
  if (pid === undefined || hasExited(child)) return;

  if (process.platform === "win32") {
    const forceAcknowledged = await requestTreeTermination(terminateProcessTree, pid, "SIGKILL", graceMs);
    const closed = await waitForChildExit(child, childClosed, graceMs);
    if (closed && hasExited(child)) return;
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.CleanupFailed,
      `进程树 ${pid} 未在 deadline 内确认终止。`,
      {
        pid,
        reason: "process_tree_termination_unconfirmed",
        rootExited: hasExited(child),
        processTreeAlive: false,
        gracefulAcknowledged: false,
        forceAcknowledged,
        platform: process.platform,
      },
    );
  }

  const gracefulAcknowledged = await requestTreeTermination(terminateProcessTree, pid, "SIGTERM", graceMs);
  const gracefullyClosed = await waitForChildExit(child, childClosed, graceMs);
  if (gracefullyClosed && hasExited(child) && !isProcessTreeAlive(pid)) return;

  const forceAcknowledged = await requestTreeTermination(terminateProcessTree, pid, "SIGKILL", graceMs);
  const forceClosed = await waitForChildExit(child, childClosed, graceMs);
  if (!forceClosed || !hasExited(child) || !forceAcknowledged || isProcessTreeAlive(pid)) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.CleanupFailed,
      `进程树 ${pid} 未在 deadline 内确认终止。`,
      {
        pid,
        reason: "process_tree_termination_unconfirmed",
        rootExited: hasExited(child),
        processTreeAlive: isProcessTreeAlive(pid),
        gracefulAcknowledged,
        forceAcknowledged,
        platform: process.platform,
      },
    );
  }
}

async function requestTreeTermination(
  terminateProcessTree: SeneraProcessTreeTerminator,
  pid: number,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = Promise.resolve()
    .then(() => terminateProcessTree(pid, signal))
    .then(
      () => true,
      () => false,
    );
  try {
    return await Promise.race([
      attempt,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function terminateSeneraProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return new Promise((resolve, reject) => {
    kill(pid, signal, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function waitForChildExit(child: ChildProcess, childClosed: Promise<void>, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(closed);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    void childClosed.then(() => finish(true));
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function isProcessTreeAlive(pid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return false;
  }
}

function buildRejectionError(
  primary: SeneraExecutionError,
  cleanupError?: SeneraExecutionError,
  outputSpoolErrorValue?: SeneraExecutionError,
): SeneraExecutionError {
  let result = primary;
  if (cleanupError) result = attachSeneraExecutionDiagnostic(result, "cleanup", cleanupError);
  if (outputSpoolErrorValue) {
    result = attachSeneraExecutionDiagnostic(result, "outputSpool", outputSpoolErrorValue);
  }
  return result;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
  }
}
