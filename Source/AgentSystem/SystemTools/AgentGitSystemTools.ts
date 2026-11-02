import path from "node:path";
import { isPathWithin } from "../Core/AgentPath.js";
import { resolveToolExecutionConfig } from "../Defaults/AgentRuntimeDefaults.js";
import { AgentResourceAccessIntents, type AgentResourceAccessIntent } from "../Execution/SeneraResourceAccess.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { SeneraExecutionEnv, SeneraShellExecutionResult } from "../Execution/SeneraExecutionTypes.js";
import { resolveAgentToolCallTimeoutMs } from "../ToolRuntime/AgentToolDeadline.js";
import {
  openAgentHostToolReportingScope,
  type AgentHostToolContext,
} from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentExecutionErrorCodes } from "../Xml/AgentXmlStatus.js";
import {
  defineSystemTool,
  systemToolArguments,
  systemToolExecutionResult,
  type AgentSystemToolExecutionProcess,
} from "./AgentSystemToolDefinition.js";
import type { AgentToolProcessError } from "../Types/ToolRuntimeTypes.js";

type GitInspectArguments =
  | { readonly operation: "status" | "branches"; readonly repository: string }
  | {
      readonly operation: "diff";
      readonly repository: string;
      readonly scope: "working" | "staged";
      readonly paths: readonly string[];
    }
  | { readonly operation: "log"; readonly repository: string; readonly revision: string; readonly limit: number }
  | { readonly operation: "show"; readonly repository: string; readonly revision: string; readonly path?: string };

type GitMutateArguments =
  | { readonly operation: "stage" | "unstage"; readonly repository: string; readonly paths: readonly string[] }
  | { readonly operation: "commit"; readonly repository: string; readonly message: string }
  | {
      readonly operation: "create_branch";
      readonly repository: string;
      readonly branch: string;
      readonly startPoint: string;
    }
  | { readonly operation: "switch_branch"; readonly repository: string; readonly branch: string };

interface GitCommandResult {
  readonly operation: string;
  readonly repository: string;
  readonly exitCode: number;
  readonly output: {
    readonly stdout: { readonly byteLength: number; readonly truncated?: boolean };
    readonly stderr: { readonly byteLength: number; readonly truncated?: boolean };
  };
}

export const GitInspectSystemTool = defineSystemTool({
  capability: "system.tool.git.GitInspect",
  async execute(input, context) {
    return (
      await executeGitOperation(
        systemToolArguments<GitInspectArguments & Record<string, unknown>>(input),
        context,
        inspectArguments,
      )
    ).result;
  },
  async executeWithArtifacts(input, context) {
    const execution = await executeGitOperation(
      systemToolArguments<GitInspectArguments & Record<string, unknown>>(input),
      context,
      inspectArguments,
    );
    return systemToolExecutionResult(execution.result, {
      process: execution.process,
      ...(execution.failure ? { failure: execution.failure } : {}),
    });
  },
});

export const GitMutateSystemTool = defineSystemTool({
  capability: "system.tool.git.GitMutate",
  async execute(input, context) {
    return (
      await executeGitOperation(
        systemToolArguments<GitMutateArguments & Record<string, unknown>>(input),
        context,
        mutateArguments,
      )
    ).result;
  },
  async executeWithArtifacts(input, context) {
    const execution = await executeGitOperation(
      systemToolArguments<GitMutateArguments & Record<string, unknown>>(input),
      context,
      mutateArguments,
    );
    return systemToolExecutionResult(execution.result, {
      process: execution.process,
      ...(execution.failure ? { failure: execution.failure } : {}),
    });
  },
});

export const AgentGitSystemTools = Object.freeze([GitInspectSystemTool, GitMutateSystemTool]);

async function inspectArguments(
  input: GitInspectArguments,
  repository: string,
  executionEnv: SeneraExecutionEnv,
): Promise<string[]> {
  switch (input.operation) {
    case "status":
      return ["status", "--short", "--branch", "--untracked-files=all"];
    case "diff":
      return [
        "diff",
        "--no-ext-diff",
        ...(input.scope === "staged" ? ["--cached"] : []),
        "--",
        ...(await resolveRepositoryPaths(repository, input.paths, executionEnv, AgentResourceAccessIntents.Inspect)),
      ];
    case "log":
      return [
        "log",
        `--max-count=${input.limit}`,
        "--date=iso-strict",
        "--format=%H%x09%aI%x09%an%x09%s",
        "--end-of-options",
        safeGitReference(input.revision),
      ];
    case "show":
      return [
        "show",
        "--no-ext-diff",
        "--format=fuller",
        "--stat",
        "--patch",
        "--end-of-options",
        safeGitReference(input.revision),
        ...(input.path
          ? [
              "--",
              ...(await resolveRepositoryPaths(
                repository,
                [input.path],
                executionEnv,
                AgentResourceAccessIntents.Inspect,
              )),
            ]
          : []),
      ];
    case "branches":
      return ["branch", "--all", "--format=%(refname)%09%(objectname)%09%(HEAD)%09%(upstream:short)"];
  }
}

async function mutateArguments(
  input: GitMutateArguments,
  repository: string,
  executionEnv: SeneraExecutionEnv,
): Promise<string[]> {
  switch (input.operation) {
    case "stage":
      return [
        "add",
        "--all",
        "--",
        ...(await resolveRepositoryPaths(repository, input.paths, executionEnv, AgentResourceAccessIntents.Replace)),
      ];
    case "unstage":
      return [
        "restore",
        "--staged",
        "--",
        ...(await resolveRepositoryPaths(repository, input.paths, executionEnv, AgentResourceAccessIntents.Replace)),
      ];
    case "commit":
      return ["commit", "--message", input.message];
    case "create_branch":
      return ["branch", "--", safeGitReference(input.branch), safeGitReference(input.startPoint)];
    case "switch_branch":
      return ["switch", "--", safeGitReference(input.branch)];
  }
}

async function resolveRepositoryPaths(
  repository: string,
  values: readonly string[],
  executionEnv: SeneraExecutionEnv,
  intent: AgentResourceAccessIntent,
): Promise<string[]> {
  return Promise.all(
    values.map(async (value) => {
      const candidate = path.resolve(repository, value);
      const resolved = await executionEnv.resolveResourcePath(candidate, intent);
      if (!resolved.ok) throw resolved.error;
      if (!isPathWithin(repository, resolved.value)) {
        throw new Error(`Git path is outside the selected repository: ${value}`);
      }
      return path.relative(repository, resolved.value) || ".";
    }),
  );
}

function safeGitReference(value: string): string {
  if (value.startsWith("-") || value.includes("\0"))
    throw new Error(`Invalid Git reference: ${JSON.stringify(value)}.`);
  return value;
}

async function executeGitOperation<TInput extends GitInspectArguments | GitMutateArguments>(
  input: TInput,
  context: AgentHostToolContext,
  resolveArguments: (input: TInput, repository: string, executionEnv: SeneraExecutionEnv) => Promise<string[]>,
): Promise<GitOperationExecution> {
  const repository = path.resolve(input.repository);
  const args = await resolveArguments(input, repository, context.executionEnv);
  return executeGit(input.operation, repository, args, context);
}

interface GitOperationExecution {
  readonly result: GitCommandResult;
  readonly process: AgentSystemToolExecutionProcess;
  readonly failure?: AgentToolProcessError;
}

async function executeGit(
  operation: string,
  repository: string,
  args: readonly string[],
  context: AgentHostToolContext,
): Promise<GitOperationExecution> {
  const toolExecution = resolveToolExecutionConfig(context.config);
  const timeoutMs = resolveAgentToolCallTimeoutMs(context.config);
  const reporting = openAgentHostToolReportingScope(context);
  let result: SeneraShellExecutionResult;
  try {
    result = await context.executionEnv.executeProcess({
      command: "git",
      args,
      cwd: repository,
      timeoutMs,
      limits: {
        timeoutMs,
        maxStdoutBytes: toolExecution.MaxStdoutBytes,
        maxStderrBytes: toolExecution.MaxStderrBytes,
      },
      signal: context.signal,
      onOutput: (chunk) => reporting.reporter.output(chunk),
      outputOverflow: "truncate",
      profile: GitExecutionProfile,
    });
  } finally {
    await reporting.close();
  }
  const output = {
    stdout: projectGitOutputStream(result.stdout, result.stdoutBytes, result.stdoutTruncated),
    stderr: projectGitOutputStream(result.stderr, result.stderrBytes, result.stderrTruncated),
  };
  const process = {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    signal: result.signal,
  } satisfies AgentSystemToolExecutionProcess;
  return {
    result: {
      operation,
      repository,
      exitCode: result.exitCode ?? -1,
      output,
    },
    process,
    ...(gitProcessFailure(operation, repository, result)
      ? { failure: gitProcessFailure(operation, repository, result) }
      : {}),
  };
}

function projectGitOutputStream(text: string, reportedBytes: number | undefined, truncated: boolean | undefined) {
  const byteLength = reportedBytes ?? Buffer.byteLength(text, "utf8");
  return {
    byteLength,
    ...(truncated ? { truncated: true } : {}),
  };
}

function gitProcessFailure(
  operation: string,
  repository: string,
  result: SeneraShellExecutionResult,
): AgentToolProcessError | undefined {
  if (result.exitCode === 0 && !result.signal) return undefined;
  const signalled = result.signal !== null;
  return {
    code: signalled ? AgentExecutionErrorCodes.ToolProcessSignalled : AgentExecutionErrorCodes.ToolProcessExited,
    message: signalled
      ? `Git ${operation} was interrupted by ${result.signal}.`
      : `Git ${operation} failed with exit code ${String(result.exitCode ?? "unknown")}.`,
    details: {
      operation,
      repository,
      exitCode: result.exitCode,
      signal: result.signal,
    },
  };
}

const GitExecutionProfile: SeneraProcessExecutionProfile = Object.freeze({
  name: "git-local",
  kind: "process",
  backend: "local",
});
