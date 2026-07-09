import { spawn } from "cross-spawn";
import kill from "tree-kill";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraShellExecutionResult,
} from "./SeneraExecutionTypes.js";
import { SeneraProcessOutputBuffer } from "./SeneraProcessOutputBuffer.js";
import type {
  SeneraProcessExecutionBackend,
  SeneraProcessExecutionRequest,
} from "./SeneraProcessExecutionBackend.js";

export class SeneraNodeProcessBackend implements SeneraProcessExecutionBackend {
  readonly kind = "node-local";

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
      let timer: ReturnType<typeof setTimeout> | undefined;

      const killChild = (): void => {
        if (child.pid === undefined) return;
        kill(child.pid, "SIGTERM", () => undefined);
      };
      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        request.signal?.removeEventListener("abort", abortListener);
        callback();
      };
      const abortListener = (): void => {
        killChild();
        settle(() => reject(new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted")));
      };
      const rejectWith = (error: SeneraExecutionError): void => {
        killChild();
        settle(() => reject(error));
      };

      request.signal?.addEventListener("abort", abortListener, { once: true });
      if (request.signal?.aborted) {
        abortListener();
        return;
      }

      timer = request.timeoutMs > 0
        ? setTimeout(() =>
            rejectWith(new SeneraExecutionError(
              SeneraExecutionErrorCodes.Timeout,
              `命令执行超时，超过 ${request.timeoutMs}ms。`,
              { timeoutMs: request.timeoutMs },
            )),
          request.timeoutMs)
        : undefined;

      child.stdout?.on("data", (chunk: Buffer) => {
        output.pushStdout(chunk);
        if (output.stdoutBytes > request.limits.maxStdoutBytes) {
          rejectWith(new SeneraExecutionError(
            SeneraExecutionErrorCodes.StdoutLimitExceeded,
            `stdout 超过 ${request.limits.maxStdoutBytes} 字节。`,
            {
              maxStdoutBytes: request.limits.maxStdoutBytes,
              actualBytes: output.stdoutBytes,
            },
          ));
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output.pushStderr(chunk);
        if (output.stderrBytes > request.limits.maxStderrBytes) {
          rejectWith(new SeneraExecutionError(
            SeneraExecutionErrorCodes.StderrLimitExceeded,
            `stderr 超过 ${request.limits.maxStderrBytes} 字节。`,
            {
              maxStderrBytes: request.limits.maxStderrBytes,
              actualBytes: output.stderrBytes,
            },
          ));
        }
      });
      child.on("error", (error) => {
        settle(() => reject(new SeneraExecutionError(
          SeneraExecutionErrorCodes.SpawnFailed,
          error instanceof Error ? error.message : String(error),
          {
            command: request.command,
            args: request.args,
            cwd: request.cwd,
          },
          error instanceof Error ? error : undefined,
        )));
      });
      child.on("close", (exitCode, signal) => {
        settle(() => resolve({
          stdout: output.stdout(),
          stderr: output.stderr(),
          exitCode,
          signal,
        }));
      });

      child.stdin?.end(request.stdin);
    });
  }
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
