import path from "node:path";
import { spawn } from "cross-spawn";
import kill from "tree-kill";
import { z } from "zod";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import { AgentToolProcessProtocol } from "./AgentToolProcessProtocol.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import { cancelledToolProcessResult } from "./AgentToolCancellation.js";
import { resolveToolExecutionConfig } from "./AgentDefaults.js";

const ShellCommandArgumentsSchema = z
  .object({
    command: z.string().trim().min(1),
    cwd: z.string().trim().min(1).optional(),
    timeoutMs: z.coerce.number().int().positive().max(30 * 60 * 1000).optional(),
    justification: z.string().trim().min(1).optional(),
  })
  .strict();

type ShellCommandArguments = z.infer<typeof ShellCommandArgumentsSchema>;

export const runShellCommandHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ShellCommandArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return shellFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "ShellCommandTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
      })),
    });
  }

  const cwdResult = resolveWorkspaceCwd(context.workspaceRoot, parsed.data.cwd);
  if (!cwdResult.ok) {
    return shellFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: cwdResult.message,
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        cwd: parsed.data.cwd,
        workspaceRoot: context.workspaceRoot,
      },
      diagnostics: [
        {
          message: cwdResult.message,
          pointer: "/cwd",
          path: ["cwd"],
          suggestion: "把 cwd 设置为工作区内的相对路径，例如 .、Frontend、Plugins/ToolName。",
        },
      ],
    });
  }

  const toolExecution = resolveToolExecutionConfig(context.config);

  return runShellCommand(parsed.data, {
    cwd: cwdResult.cwd,
    defaultTimeoutMs: toolExecution.TimeoutMs,
    maxStdoutBytes: toolExecution.MaxStdoutBytes,
    maxStderrBytes: toolExecution.MaxStderrBytes,
    signal: context.signal,
  });
};

function runShellCommand(
  request: ShellCommandArguments,
  options: {
    cwd: string;
    defaultTimeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
    signal?: AbortSignal;
  },
): Promise<AgentToolProcessRunResult> {
  const shell = resolveShell();
  const timeoutMs = request.timeoutMs ?? options.defaultTimeoutMs;

  if (options.signal?.aborted) {
    return Promise.resolve(cancelledToolProcessResult({
      signal: options.signal,
      phase: "before_spawn",
      command: request.command,
      cwd: options.cwd,
    }));
  }

  return new Promise((resolve) => {
    const child = spawn(shell.command, [...shell.args, request.command], {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const counters = {
      stdoutBytes: 0,
      stderrBytes: 0,
    };
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abortListener = (): void => {
      killProcessTree(child.pid);
      settle(cancelledToolProcessResult({
        signal: options.signal,
        phase: "runtime",
        command: request.command,
        cwd: options.cwd,
      }));
    };

    const settle = (result: AgentToolProcessRunResult): void => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener("abort", abortListener);
      resolve(result);
    };

    options.signal?.addEventListener("abort", abortListener, { once: true });
    if (options.signal?.aborted) {
      abortListener();
      return;
    }

    timer = setTimeout(() => {
      killProcessTree(child.pid);
      settle(shellFailure({
        code: AgentExecutionErrorCodes.ToolProcessTimeout,
        message: `命令执行超时，超过 ${timeoutMs}ms：${request.command}`,
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          cwd: options.cwd,
          command: request.command,
          timeoutMs,
        },
      }));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      appendChunk({
        chunk,
        chunks: stdoutChunks,
        bytesKey: "stdoutBytes",
        counters,
        limit: options.maxStdoutBytes,
        onLimit: () => {
          killProcessTree(child.pid);
          settle(shellFailure({
            code: AgentExecutionErrorCodes.ToolProcessStdoutLimitExceeded,
            message: `命令 stdout 超过 ${options.maxStdoutBytes} 字节：${request.command}`,
            details: {
              phase: AgentToolProcessErrorPhases.RuntimeExecution,
              cwd: options.cwd,
              command: request.command,
              maxStdoutBytes: options.maxStdoutBytes,
              actualBytes: counters.stdoutBytes,
            },
          }));
        },
      });
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      appendChunk({
        chunk,
        chunks: stderrChunks,
        bytesKey: "stderrBytes",
        counters,
        limit: options.maxStderrBytes,
        onLimit: () => {
          killProcessTree(child.pid);
          settle(shellFailure({
            code: AgentExecutionErrorCodes.ToolProcessStderrLimitExceeded,
            message: `命令 stderr 超过 ${options.maxStderrBytes} 字节：${request.command}`,
            details: {
              phase: AgentToolProcessErrorPhases.RuntimeExecution,
              cwd: options.cwd,
              command: request.command,
              maxStderrBytes: options.maxStderrBytes,
              actualBytes: counters.stderrBytes,
            },
          }));
        },
      });
    });

    child.on("error", (error: Error) => {
      settle(shellFailure({
        code: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
        message: error.message,
        details: {
          phase: AgentToolProcessErrorPhases.ProcessSpawn,
          cwd: options.cwd,
          command: request.command,
        },
      }));
    });

    child.on("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      settle({
        response: {
          protocol: AgentToolProcessProtocol,
          ok: true,
          result: {
            command: request.command,
            cwd: options.cwd,
            exitCode,
            signal,
            stdout,
            stderr,
          },
        },
        stdout,
        stderr,
        exitCode,
        signal,
      });
    });
  });
}

function resolveWorkspaceCwd(
  workspaceRoot: string,
  cwd: string | undefined,
): { ok: true; cwd: string } | { ok: false; message: string } {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, cwd ?? ".");
  const relative = path.relative(root, resolved);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

  return inside
    ? { ok: true, cwd: resolved }
    : { ok: false, message: `cwd 超出工作区：${cwd ?? "."}` };
}

function resolveShell(): { command: string; args: string[] } {
  return process.platform === "win32"
    ? { command: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-Command"] }
    : { command: "/bin/sh", args: ["-lc"] };
}

function appendChunk(options: {
  chunk: Buffer;
  chunks: Buffer[];
  bytesKey: "stdoutBytes" | "stderrBytes";
  counters: Record<"stdoutBytes" | "stderrBytes", number>;
  limit: number;
  onLimit: () => void;
}): void {
  options.chunks.push(options.chunk);
  options.counters[options.bytesKey] += options.chunk.byteLength;
  if (options.counters[options.bytesKey] > options.limit) {
    options.onLimit();
  }
}

function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return;
  kill(pid, "SIGTERM", () => undefined);
}

function shellFailure(error: NonNullable<AgentToolProcessRunResult["response"]["error"]>): AgentToolProcessRunResult {
  return {
    response: {
      protocol: AgentToolProcessProtocol,
      ok: false,
      error,
    },
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
  };
}
