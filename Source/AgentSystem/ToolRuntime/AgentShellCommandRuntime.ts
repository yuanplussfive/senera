import { z } from "zod";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import {
  createToolProcessSuccessResponse,
  toolProcessFailureResult,
} from "./AgentToolProcessEnvelope.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../Xml/AgentXmlStatus.js";
import { cancelledToolProcessResult } from "./AgentToolCancellation.js";
import { resolveToolExecutionConfig } from "../AgentDefaults.js";
import { resolveWorkspacePath } from "../Execution/SeneraWorkspacePath.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraExecutionErrorCode,
} from "../Execution/SeneraExecutionTypes.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import { resolveAgentToolExecutionPolicy } from "./AgentToolExecutionPolicy.js";

const ShellExecutionProfileName = "host-shell";

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

  const cwdResult = resolveWorkspacePath(context.workspaceRoot, parsed.data.cwd);
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
  const executionProfile = buildShellExecutionProfile(context.tool);
  try {
    const result = await context.executionEnv.executeShell({
      command: parsed.data.command,
      cwd: cwdResult.absolutePath,
      timeoutMs: parsed.data.timeoutMs,
      limits: {
        timeoutMs: toolExecution.TimeoutMs,
        maxStdoutBytes: toolExecution.MaxStdoutBytes,
        maxStderrBytes: toolExecution.MaxStderrBytes,
      },
      signal: context.signal,
      profile: executionProfile,
    });

    return {
      response: createToolProcessSuccessResponse({
        command: parsed.data.command,
        cwd: cwdResult.absolutePath,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal,
    };
  } catch (error) {
    return shellExecutionFailure({
      error,
      command: parsed.data.command,
      cwd: cwdResult.absolutePath,
      timeoutMs: parsed.data.timeoutMs ?? toolExecution.TimeoutMs,
      signal: context.signal,
    });
  }
};

function buildShellExecutionProfile(tool: Parameters<AgentHostToolHandler>[1]["tool"]): SeneraProcessExecutionProfile {
  const policy = resolveAgentToolExecutionPolicy(tool);
  const local = policy.mode === "local";
  return {
    name: ShellExecutionProfileName,
    kind: "shell",
    backend: local ? "local" : "sandbox",
    localFallback: policy.localFallback,
    microsandbox: local
      ? undefined
      : {
          network: policy.network,
          workspaceMount: policy.workspaceMount,
        },
  };
}

function shellFailure(error: NonNullable<AgentToolProcessRunResult["response"]["error"]>): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}

function shellExecutionFailure(input: {
  error: unknown;
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): AgentToolProcessRunResult {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  if (input.signal?.aborted || message === "aborted") {
    return cancelledToolProcessResult({
      signal: input.signal,
      phase: "runtime",
      command: input.command,
      cwd: input.cwd,
    });
  }

  const code = shellErrorCode(input.error);

  return shellFailure({
    code,
    message: code === AgentExecutionErrorCodes.ToolProcessTimeout
      ? `命令执行超时，超过 ${input.timeoutMs}ms：${input.command}`
      : message,
    details: {
      phase: code === AgentExecutionErrorCodes.ToolProcessSpawnFailed
        ? AgentToolProcessErrorPhases.ProcessSpawn
        : AgentToolProcessErrorPhases.RuntimeExecution,
      cwd: input.cwd,
      command: input.command,
      timeoutMs: input.timeoutMs,
      seneraExecutionCode: input.error instanceof SeneraExecutionError
        ? input.error.code
        : undefined,
    },
  });
}

const AgentShellErrorCodeBySeneraCode = {
  [SeneraExecutionErrorCodes.Aborted]: AgentExecutionErrorCodes.ToolProcessCancelled,
  [SeneraExecutionErrorCodes.InvalidWorkspacePath]: AgentExecutionErrorCodes.InvalidToolArguments,
  [SeneraExecutionErrorCodes.Timeout]: AgentExecutionErrorCodes.ToolProcessTimeout,
  [SeneraExecutionErrorCodes.StdoutLimitExceeded]: AgentExecutionErrorCodes.ToolProcessStdoutLimitExceeded,
  [SeneraExecutionErrorCodes.StderrLimitExceeded]: AgentExecutionErrorCodes.ToolProcessStderrLimitExceeded,
  [SeneraExecutionErrorCodes.SandboxUnavailable]: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
  [SeneraExecutionErrorCodes.SpawnFailed]: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
  [SeneraExecutionErrorCodes.Unknown]: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
} satisfies Record<SeneraExecutionErrorCode, typeof AgentExecutionErrorCodes[keyof typeof AgentExecutionErrorCodes]>;

function shellErrorCode(error: unknown): typeof AgentExecutionErrorCodes[keyof typeof AgentExecutionErrorCodes] {
  return error instanceof SeneraExecutionError
    ? AgentShellErrorCodeBySeneraCode[error.code]
    : AgentExecutionErrorCodes.ToolProcessSpawnFailed;
}
