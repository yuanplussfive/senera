import type { AgentToolProcessError } from "../Types/ToolRuntimeTypes.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../Xml/AgentXmlStatus.js";
import { cancelledToolProcessResult } from "./AgentToolCancellation.js";
import type {
  AgentToolProcessRunResult,
  AgentToolProcessSpawner,
} from "./AgentToolProcessTypes.js";
import { failedToolProcessResult } from "./AgentToolProcessResultFactory.js";
import { AgentToolProcessResponseParser } from "./AgentToolProcessResponseParser.js";

export interface AgentToolProcessSessionOptions {
  spawnProcess: AgentToolProcessSpawner;
  responseParser: AgentToolProcessResponseParser;
  toolName: string;
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  requestXml: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  signal?: AbortSignal;
}

export class AgentToolProcessSession {
  constructor(private readonly options: AgentToolProcessSessionOptions) {}

  run(): Promise<AgentToolProcessRunResult> {
    const processLabel = [this.options.command, ...this.options.args].join(" ");
    if (this.options.signal?.aborted) {
      return Promise.resolve(cancelledToolProcessResult({
        signal: this.options.signal,
        toolName: this.options.toolName,
        phase: "before_spawn",
        command: processLabel,
        cwd: this.options.cwd,
      }));
    }

    return new Promise((resolve) => {
      const child = this.options.spawnProcess(this.options.command, this.options.args, {
        cwd: this.options.cwd,
        env: {
          ...process.env,
          ...(this.options.env ?? {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const output = new ProcessOutputBuffer();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (result: AgentToolProcessRunResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        this.options.signal?.removeEventListener("abort", abortListener);
        resolve(result);
      };
      const abortListener = (): void => {
        child.kill("SIGTERM");
        settle(cancelledToolProcessResult({
          signal: this.options.signal,
          toolName: this.options.toolName,
          phase: "runtime",
          command: processLabel,
          cwd: this.options.cwd,
        }));
      };

      this.options.signal?.addEventListener("abort", abortListener, { once: true });
      if (this.options.signal?.aborted) {
        abortListener();
        return;
      }

      timer = setTimeout(() => {
        child.kill("SIGTERM");
        settle(this.failure({
          code: AgentExecutionErrorCodes.ToolProcessTimeout,
          message: `工具进程超时，超过 ${this.options.timeoutMs}ms：${processLabel}`,
          details: {
            phase: AgentToolProcessErrorPhases.RuntimeExecution,
            modulePath: processLabel,
            cwd: this.options.cwd,
            timeoutMs: this.options.timeoutMs,
          },
        }));
      }, this.options.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }

        output.pushStdout(chunk);
        if (output.stdoutBytes > this.options.maxStdoutBytes) {
          child.kill("SIGTERM");
          settle(this.failure({
            code: AgentExecutionErrorCodes.ToolProcessStdoutLimitExceeded,
            message: `工具 stdout 超过 ${this.options.maxStdoutBytes} 字节：${processLabel}`,
            details: {
              phase: AgentToolProcessErrorPhases.RuntimeExecution,
              modulePath: processLabel,
              cwd: this.options.cwd,
              maxStdoutBytes: this.options.maxStdoutBytes,
              actualBytes: output.stdoutBytes,
            },
          }));
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }

        output.pushStderr(chunk);
        if (output.stderrBytes > this.options.maxStderrBytes) {
          child.kill("SIGTERM");
          settle(this.failure({
            code: AgentExecutionErrorCodes.ToolProcessStderrLimitExceeded,
            message: `工具 stderr 超过 ${this.options.maxStderrBytes} 字节：${processLabel}`,
            details: {
              phase: AgentToolProcessErrorPhases.RuntimeExecution,
              modulePath: processLabel,
              cwd: this.options.cwd,
              maxStderrBytes: this.options.maxStderrBytes,
              actualBytes: output.stderrBytes,
            },
          }));
        }
      });

      child.on("error", (error) => {
        settle(this.failure({
          code: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
          message: error instanceof Error ? error.message : String(error),
          details: {
            phase: AgentToolProcessErrorPhases.ProcessSpawn,
            modulePath: processLabel,
            cwd: this.options.cwd,
            command: this.options.command,
            args: this.options.args,
          },
          diagnostics: [
            {
              message: error instanceof Error ? error.message : String(error),
              pointer: "/",
              path: [],
              suggestion: "检查插件 Entry.Command、Entry.Args、Entry.Cwd 是否正确，以及工具包依赖是否已安装。",
            },
          ],
        }));
      });

      child.on("close", (exitCode, signal) => {
        if (settled) {
          return;
        }

        const stdout = output.stdout();
        const stderr = output.stderr();
        settle({
          response: this.options.responseParser.parse({
            stdout,
            stderr,
            exitCode,
            signal,
            modulePath: processLabel,
          }),
          stdout,
          stderr,
          exitCode,
          signal,
        });
      });

      child.stdin.end(this.options.requestXml);
    });
  }

  private failure(error: AgentToolProcessError): AgentToolProcessRunResult {
    return failedToolProcessResult(error);
  }
}

class ProcessOutputBuffer {
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrChunks: Buffer[] = [];
  stdoutBytes = 0;
  stderrBytes = 0;

  pushStdout(chunk: Buffer): void {
    this.stdoutChunks.push(chunk);
    this.stdoutBytes += chunk.byteLength;
  }

  pushStderr(chunk: Buffer): void {
    this.stderrChunks.push(chunk);
    this.stderrBytes += chunk.byteLength;
  }

  stdout(): string {
    return Buffer.concat(this.stdoutChunks).toString("utf8");
  }

  stderr(): string {
    return Buffer.concat(this.stderrChunks).toString("utf8");
  }
}
