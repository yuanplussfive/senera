import type { AgentToolProcessError } from "../Types/ToolRuntimeTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { cancelledToolProcessResult } from "./AgentToolCancellation.js";
import type {
  AgentToolProcessChild,
  AgentToolProcessRunResult,
  AgentToolProcessSpawner,
} from "./AgentToolProcessTypes.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import { failedToolProcessResult } from "./AgentToolProcessResultFactory.js";
import { type AgentToolProcessResponseParser } from "./AgentToolProcessResponseParser.js";
import { SeneraProcessOutputBuffer } from "../Execution/SeneraProcessOutputBuffer.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraExecutionErrorCode,
} from "../Execution/SeneraExecutionTypes.js";

export interface AgentToolProcessSessionOptions {
  spawnProcess: AgentToolProcessSpawner;
  responseParser: AgentToolProcessResponseParser;
  toolName: string;
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  requestPayload: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  signal?: AbortSignal;
  executionProfile?: SeneraProcessExecutionProfile;
}

export class AgentToolProcessSession {
  constructor(private readonly options: AgentToolProcessSessionOptions) {}

  run(): Promise<AgentToolProcessRunResult> {
    const processLabel = [this.options.command, ...this.options.args].join(" ");
    if (this.options.signal?.aborted) {
      return Promise.resolve(
        cancelledToolProcessResult({
          signal: this.options.signal,
          toolName: this.options.toolName,
          phase: "before_spawn",
          command: processLabel,
          cwd: this.options.cwd,
        }),
      );
    }

    return new Promise((resolve) => {
      const output = new SeneraProcessOutputBuffer({ encoding: "auto" });
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined = undefined;
      let child: AgentToolProcessChild | undefined;
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
      const killChild = (): void => {
        child?.kill("SIGTERM");
      };
      const abortListener = (): void => {
        killChild();
        settle(
          cancelledToolProcessResult({
            signal: this.options.signal,
            toolName: this.options.toolName,
            phase: "runtime",
            command: processLabel,
            cwd: this.options.cwd,
          }),
        );
      };

      try {
        child = this.options.spawnProcess(this.options.command, this.options.args, {
          cwd: this.options.cwd,
          env: {
            ...process.env,
            ...(this.options.env ?? {}),
          },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          timeoutMs: this.options.timeoutMs,
          limits: {
            timeoutMs: this.options.timeoutMs,
            maxStdoutBytes: this.options.maxStdoutBytes,
            maxStderrBytes: this.options.maxStderrBytes,
          },
          signal: this.options.signal,
          profile: this.options.executionProfile,
        });
      } catch (error) {
        settle(this.spawnFailure(error, processLabel));
        return;
      }

      this.options.signal?.addEventListener("abort", abortListener, { once: true });
      if (this.options.signal?.aborted) {
        abortListener();
        return;
      }

      timer = setTimeout(() => {
        killChild();
        settle(
          this.failure({
            code: AgentExecutionErrorCodes.ToolProcessTimeout,
            message: agentErrorMessage("toolProcess.timeout", {
              timeoutMs: this.options.timeoutMs,
              processLabel,
            }),
            details: {
              phase: AgentToolProcessErrorPhases.RuntimeExecution,
              modulePath: processLabel,
              cwd: this.options.cwd,
              timeoutMs: this.options.timeoutMs,
            },
          }),
        );
      }, this.options.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }

        output.pushStdout(chunk);
        if (output.stdoutBytes > this.options.maxStdoutBytes) {
          killChild();
          settle(
            this.failure({
              code: AgentExecutionErrorCodes.ToolProcessStdoutLimitExceeded,
              message: agentErrorMessage("toolProcess.stdoutLimitExceeded", {
                maxStdoutBytes: this.options.maxStdoutBytes,
                processLabel,
              }),
              details: {
                phase: AgentToolProcessErrorPhases.RuntimeExecution,
                modulePath: processLabel,
                cwd: this.options.cwd,
                maxStdoutBytes: this.options.maxStdoutBytes,
                actualBytes: output.stdoutBytes,
              },
            }),
          );
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }

        output.pushStderr(chunk);
        if (output.stderrBytes > this.options.maxStderrBytes) {
          killChild();
          settle(
            this.failure({
              code: AgentExecutionErrorCodes.ToolProcessStderrLimitExceeded,
              message: agentErrorMessage("toolProcess.stderrLimitExceeded", {
                maxStderrBytes: this.options.maxStderrBytes,
                processLabel,
              }),
              details: {
                phase: AgentToolProcessErrorPhases.RuntimeExecution,
                modulePath: processLabel,
                cwd: this.options.cwd,
                maxStderrBytes: this.options.maxStderrBytes,
                actualBytes: output.stderrBytes,
              },
            }),
          );
        }
      });

      child.on("error", (error) => {
        settle(this.spawnFailure(error, processLabel));
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

      child.stdin.end(this.options.requestPayload);
    });
  }

  private failure(error: AgentToolProcessError): AgentToolProcessRunResult {
    return failedToolProcessResult(error);
  }

  private spawnFailure(error: unknown, processLabel: string): AgentToolProcessRunResult {
    const projection = projectSpawnFailure(error);
    return this.failure({
      code: projection.code,
      message: projection.message,
      details: {
        phase: projection.phase,
        modulePath: processLabel,
        cwd: this.options.cwd,
        command: this.options.command,
        args: this.options.args,
        seneraExecutionCode: error instanceof SeneraExecutionError ? error.code : undefined,
      },
      diagnostics: [
        {
          message: projection.message,
          pointer: "/",
          path: [],
          suggestion: projection.suggestion,
        },
      ],
    });
  }
}

const SpawnFailureProjectionBySeneraCode = {
  [SeneraExecutionErrorCodes.Aborted]: {
    code: AgentExecutionErrorCodes.ToolProcessCancelled,
    phase: AgentToolProcessErrorPhases.RuntimeExecution,
    suggestion: agentErrorMessage("toolProcess.suggestion.cancelled"),
  },
  [SeneraExecutionErrorCodes.InvalidWorkspacePath]: {
    code: AgentExecutionErrorCodes.ToolProcessConfigurationInvalid,
    phase: AgentToolProcessErrorPhases.ConfigurationValidation,
    suggestion: agentErrorMessage("toolProcess.suggestion.invalidWorkspacePath"),
  },
  [SeneraExecutionErrorCodes.Timeout]: {
    code: AgentExecutionErrorCodes.ToolProcessTimeout,
    phase: AgentToolProcessErrorPhases.RuntimeExecution,
    suggestion: agentErrorMessage("toolProcess.suggestion.timeout"),
  },
  [SeneraExecutionErrorCodes.StdoutLimitExceeded]: {
    code: AgentExecutionErrorCodes.ToolProcessStdoutLimitExceeded,
    phase: AgentToolProcessErrorPhases.RuntimeExecution,
    suggestion: agentErrorMessage("toolProcess.suggestion.stdoutLimit"),
  },
  [SeneraExecutionErrorCodes.StderrLimitExceeded]: {
    code: AgentExecutionErrorCodes.ToolProcessStderrLimitExceeded,
    phase: AgentToolProcessErrorPhases.RuntimeExecution,
    suggestion: agentErrorMessage("toolProcess.suggestion.stderrLimit"),
  },
  [SeneraExecutionErrorCodes.SandboxUnavailable]: {
    code: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
    phase: AgentToolProcessErrorPhases.ProcessSpawn,
    suggestion: agentErrorMessage("toolProcess.suggestion.sandboxUnavailable"),
  },
  [SeneraExecutionErrorCodes.SpawnFailed]: {
    code: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
    phase: AgentToolProcessErrorPhases.ProcessSpawn,
    suggestion: agentErrorMessage("toolProcess.suggestion.spawnFailed"),
  },
  [SeneraExecutionErrorCodes.Unknown]: {
    code: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
    phase: AgentToolProcessErrorPhases.ProcessSpawn,
    suggestion: agentErrorMessage("toolProcess.suggestion.unknown"),
  },
} satisfies Record<
  SeneraExecutionErrorCode,
  {
    code: (typeof AgentExecutionErrorCodes)[keyof typeof AgentExecutionErrorCodes];
    phase: (typeof AgentToolProcessErrorPhases)[keyof typeof AgentToolProcessErrorPhases];
    suggestion: string;
  }
>;

function projectSpawnFailure(error: unknown): {
  code: (typeof AgentExecutionErrorCodes)[keyof typeof AgentExecutionErrorCodes];
  phase: (typeof AgentToolProcessErrorPhases)[keyof typeof AgentToolProcessErrorPhases];
  message: string;
  suggestion: string;
} {
  const base =
    error instanceof SeneraExecutionError
      ? SpawnFailureProjectionBySeneraCode[error.code]
      : {
          code: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
          phase: AgentToolProcessErrorPhases.ProcessSpawn,
          suggestion: agentErrorMessage("toolProcess.suggestion.spawnFailed"),
        };

  return {
    ...base,
    message: error instanceof Error ? error.message : String(error),
  };
}
