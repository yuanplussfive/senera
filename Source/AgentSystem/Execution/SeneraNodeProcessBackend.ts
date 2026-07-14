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

const DEFAULT_TERMINATION_GRACE_MS = 500;

export type SeneraProcessTreeTerminator = (pid: number, signal: NodeJS.Signals) => Promise<void>;

export interface SeneraNodeProcessBackendOptions {
  terminateProcessTree?: SeneraProcessTreeTerminator;
  terminationGraceMs?: number;
}

export class SeneraNodeProcessBackend implements SeneraProcessExecutionBackend {
  readonly kind = "node-local";
  private readonly terminateProcessTree: SeneraProcessTreeTerminator;
  private readonly terminationGraceMs: number;

  constructor(options: SeneraNodeProcessBackendOptions = {}) {
    this.terminateProcessTree = options.terminateProcessTree ?? terminateProcessTree;
    this.terminationGraceMs = normalizeTerminationGrace(options.terminationGraceMs);
  }

  async executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult> {
    assertNotAborted(request.signal);
    assertLocalBackendAllowed(request);

    return new Promise((resolve, reject) => {
      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: {
          ...process.env,
          ...(request.env ?? {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const output = new SeneraProcessOutputBuffer({ encoding: "auto" });
      let settled = false;
      let terminalError: SeneraExecutionError | undefined;
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
        const settleRejection = (): void => settle(() => reject(terminalError!));
        void terminateChildProcess({
          child,
          childClosed,
          terminateProcessTree: this.terminateProcessTree,
          graceMs: this.terminationGraceMs,
        }).then(settleRejection, settleRejection);
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
        output.pushStdout(chunk);
        if (output.stdoutBytes > request.limits.maxStdoutBytes) {
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
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (terminalError) return;
        output.pushStderr(chunk);
        if (output.stderrBytes > request.limits.maxStderrBytes) {
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
      });
      child.on("error", (error) => {
        if (terminalError) {
          settle(() => reject(terminalError!));
          return;
        }
        settle(() =>
          reject(
            new SeneraExecutionError(
              SeneraExecutionErrorCodes.SpawnFailed,
              error instanceof Error ? error.message : String(error),
              {
                command: request.command,
                args: request.args,
                cwd: request.cwd,
              },
              error instanceof Error ? error : undefined,
            ),
          ),
        );
      });
      child.on("close", (exitCode, signal) => {
        resolveChildClosed();
        if (terminalError) {
          settle(() => reject(terminalError!));
          return;
        }
        settle(() =>
          resolve({
            stdout: output.stdout(),
            stderr: output.stderr(),
            exitCode,
            signal,
          }),
        );
      });

      child.stdin?.end(request.stdin);
    });
  }
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

  try {
    void terminateProcessTree(pid, "SIGTERM").catch(() => undefined);
  } catch {
    // Synchronous terminator failures follow the same bounded force-kill path.
  }
  await waitForClose(childClosed, graceMs);
  if (hasExited(child)) return;

  try {
    child.kill("SIGKILL");
  } catch {
    // The process may have exited between the state check and the signal.
  }
  await waitForClose(childClosed, graceMs);
}

function terminateProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
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

function waitForClose(childClosed: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    void childClosed.then(finish);
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function normalizeTerminationGrace(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TERMINATION_GRACE_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("terminationGraceMs must be a positive finite number.");
  }
  return Math.max(1, Math.trunc(value));
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
  }
}

function assertLocalBackendAllowed(request: SeneraProcessExecutionRequest): void {
  if (request.profile?.backend === "sandbox" && request.profile.localFallback === "deny") {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "执行策略要求使用沙箱，已拒绝本地进程后端。",
      {
        backend: "node-local",
        profile: request.profile.name,
      },
    );
  }
}
