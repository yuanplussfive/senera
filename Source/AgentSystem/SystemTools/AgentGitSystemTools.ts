import path from "node:path";
import { z } from "zod";
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
import { AgentToolResourceCapabilityIds } from "../ToolRuntime/AgentToolResourceCapabilityIds.js";
import {
  AgentHostToolProtocolVersion,
  ToolResultAssessmentPolicies,
  ToolSchedulingModes,
  type ToolSearchManifest,
} from "../Types/AgentToolContractTypes.js";
import { AgentExecutionErrorCodes } from "../Xml/AgentXmlStatus.js";
import { AgentToolSemanticProjectionKinds } from "../ToolRuntime/AgentToolSemanticProjection.js";
import {
  defineSystemTool,
  systemToolExecutionResult,
  type AgentSystemToolExecutionProcess,
  type AgentSystemToolMetadata,
} from "./AgentSystemToolDefinition.js";
import type { AgentToolProcessError } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolObservationProjectionManifest } from "../Types/AgentToolObservationProjectionTypes.js";

const RepositoryPath = z.string().trim().min(1);
const GitPath = z.string().trim().min(1);
const GitReference = z.string().trim().min(1);

const GitInspectInput = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("status"), repository: RepositoryPath }).strict(),
  z
    .object({
      operation: z.literal("diff"),
      repository: RepositoryPath,
      scope: z.enum(["working", "staged"]).default("working"),
      paths: z.array(GitPath).max(256).default([]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("log"),
      repository: RepositoryPath,
      revision: GitReference.default("HEAD"),
      limit: z.number().int().min(1).max(200).default(20),
    })
    .strict(),
  z
    .object({
      operation: z.literal("show"),
      repository: RepositoryPath,
      revision: GitReference.default("HEAD"),
      path: GitPath.optional(),
    })
    .strict(),
  z.object({ operation: z.literal("branches"), repository: RepositoryPath }).strict(),
]);

const GitMutateInput = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("stage"),
      repository: RepositoryPath,
      paths: z.array(GitPath).min(1).max(256),
    })
    .strict(),
  z
    .object({
      operation: z.literal("unstage"),
      repository: RepositoryPath,
      paths: z.array(GitPath).min(1).max(256),
    })
    .strict(),
  z
    .object({
      operation: z.literal("commit"),
      repository: RepositoryPath,
      message: z.string().trim().min(1).max(8_192),
    })
    .strict(),
  z
    .object({
      operation: z.literal("create_branch"),
      repository: RepositoryPath,
      branch: GitReference,
      startPoint: GitReference.default("HEAD"),
    })
    .strict(),
  z
    .object({
      operation: z.literal("switch_branch"),
      repository: RepositoryPath,
      branch: GitReference,
    })
    .strict(),
]);

const GitOutputStream = z
  .object({
    byteLength: z.number().int().nonnegative(),
    truncated: z.boolean().optional(),
  })
  .strict();

const GitCommandOutput = z
  .object({
    operation: z.string(),
    repository: z.string(),
    exitCode: z.number().int(),
    output: z
      .object({
        stdout: GitOutputStream,
        stderr: GitOutputStream,
      })
      .strict(),
  })
  .strict();

const CompactTextLimits = {
  maxDepth: 1,
  maxArrayItems: 4,
  maxObjectProperties: 8,
  maxNodes: 16,
} as const;

const CompactStructuredLimits = {
  maxDepth: 4,
  maxArrayItems: 16,
  maxObjectProperties: 16,
  maxNodes: 96,
} as const;

const GitObservationProjection = {
  schemaVersion: 2,
  maxTokens: 8_192,
  maxOmissions: 32,
  artifactFallback: { strategy: "reference", requiredWhenTruncated: true },
  sources: [
    gitObservationSource("headline", "text", "essential", true, 128, CompactTextLimits),
    gitObservationSource("summary", "text", "high", true, 256, CompactTextLimits),
    gitObservationSource("semanticDigest", "text", "high", false, 2_048, CompactTextLimits),
    gitObservationSource("retrieval", "json", "high", true, 128, CompactStructuredLimits),
    gitObservationSource("result", "json", "normal", true, 1_024, CompactStructuredLimits),
    gitObservationSource("limitations", "orderedArray", "low", false, 128, CompactStructuredLimits),
  ],
} as const satisfies AgentToolObservationProjectionManifest;

const GitExtension = {
  name: "git",
  displayName: { "zh-CN": "Git 版本控制", "en-US": "Git Version Control" },
  description: {
    "zh-CN": "通过无 Shell 的受控本地命令检查和修改工作区 Git 仓库。",
    "en-US": "Inspects and changes workspace Git repositories through controlled shell-free local commands.",
  },
  priority: 94,
} as const;

const GitInspectSearch = gitSearch({
  aliases: [
    "git",
    "git status",
    "git diff",
    "git log",
    "版本控制",
    "查看 git 状态",
    "检查 git 状态",
    "查看 git 差异",
    "查看 git 日志",
    "查看 git 分支",
    "检查提交",
  ],
  id: "repository.git.inspect",
  title: "Git repository inspection",
  description: "Inspect status, diffs, history, revisions, and branches without network access.",
  actions: ["status", "diff", "log", "show", "list-branches"],
  effects: ["none"],
});

const GitMutateSearch = gitSearch({
  aliases: ["git stage", "git commit", "git branch", "暂存", "提交代码", "切换分支"],
  id: "repository.git.mutate",
  title: "Git repository mutation",
  description: "Stage, unstage, commit, create, or switch local branches without remote operations.",
  actions: ["stage", "unstage", "commit", "create-branch", "switch-branch"],
  effects: ["repository-write", "workspace-possible"],
});

export const GitInspectSystemTool = defineSystemTool({
  extension: GitExtension,
  metadata: gitMetadata("只读检查 Git 状态、差异、历史、提交和分支；不访问远端。", "inspect", GitInspectSearch),
  name: "GitInspect",
  input: GitInspectInput,
  output: GitCommandOutput,
  async execute(input, context) {
    return (await executeGitOperation(input, context, inspectArguments)).result;
  },
  async executeWithArtifacts(input, context) {
    const execution = await executeGitOperation(input, context, inspectArguments);
    return systemToolExecutionResult(execution.result, {
      process: execution.process,
      ...(execution.failure ? { failure: execution.failure } : {}),
    });
  },
});

export const GitMutateSystemTool = defineSystemTool({
  extension: GitExtension,
  metadata: {
    ...gitMetadata("执行明确列举的本地 Git 变更；不提供 fetch、push 或 remote 操作。", "replace", GitMutateSearch),
    approval: { Mode: "ask", Reason: "Git mutation changes the repository index, refs, or working tree." },
  },
  name: "GitMutate",
  input: GitMutateInput,
  output: GitCommandOutput,
  async execute(input, context) {
    return (await executeGitOperation(input, context, mutateArguments)).result;
  },
  async executeWithArtifacts(input, context) {
    const execution = await executeGitOperation(input, context, mutateArguments);
    return systemToolExecutionResult(execution.result, {
      process: execution.process,
      ...(execution.failure ? { failure: execution.failure } : {}),
    });
  },
});

export const AgentGitSystemTools = Object.freeze([GitInspectSystemTool, GitMutateSystemTool]);

function gitMetadata(
  description: string,
  intent: "inspect" | "replace",
  search: ToolSearchManifest,
): AgentSystemToolMetadata {
  return {
    observation: GitObservationProjection,
    description,
    permissions:
      intent === "inspect"
        ? ["process:git", "filesystem:workspace:read"]
        : ["process:git", "filesystem:workspace:write"],
    execution: { Targets: ["Local"], Network: "Deny", Workspace: intent === "inspect" ? "ReadOnly" : "ReadWrite" },
    runtime: {
      Lifecycle: "OneShot",
      ProtocolVersion: AgentHostToolProtocolVersion,
      ResultAssessment: ToolResultAssessmentPolicies.ProcessExit,
      Scheduling: ToolSchedulingModes.ResourceClaims,
      Capabilities: { OutputStreaming: true, Cancellation: true },
    },
    resources: [
      {
        Capability: AgentToolResourceCapabilityIds.WorkspacePath,
        Pointer: "/repository",
        Parameters: { Intent: intent },
      },
      {
        Capability: AgentToolResourceCapabilityIds.WorkspacePath,
        Pointer: "/repository",
        Parameters: { Intent: "execute" },
      },
    ],
    search,
    artifacts: {
      Summary: {
        Template:
          "{{ toolName }} {{ result.operation }}: exit {{ result.exitCode }}, stdout {{ result.output.stdout.byteLength }} bytes, stderr {{ result.output.stderr.byteLength }} bytes.",
        ArtifactTemplate:
          "- operation: {{ result.operation }}\n  repository: {{ result.repository }}\n  exitCode: {{ result.exitCode }}\n  stdoutBytes: {{ result.output.stdout.byteLength }}\n  stderrBytes: {{ result.output.stderr.byteLength }}",
      },
    },
  };
}

function gitSearch(input: {
  aliases: string[];
  id: string;
  title: string;
  description: string;
  actions: string[];
  effects: string[];
}): ToolSearchManifest {
  return {
    Summary: input.description,
    Tags: ["git", "repository", "version-control"],
    Capabilities: [
      {
        Id: input.id,
        Title: input.title,
        Description: input.description,
        Facets: {
          Actions: input.actions,
          Targets: ["git-repository", "working-tree", "index", "refs"],
          Inputs: ["operation", "repository"],
          Outputs: ["git-output", "exit-code"],
          Effects: input.effects,
        },
        Aliases: input.aliases,
        Risk: {
          SideEffect: input.effects.includes("none") ? "none" : "repository-write",
          Permission: input.effects.includes("none") ? "workspace-read" : "workspace-write",
        },
      },
    ],
    UseCases: [input.description],
    Avoid: ["不支持 fetch、pull、push、remote 或任意 Git flags。"],
  };
}

async function inspectArguments(
  input: z.output<typeof GitInspectInput>,
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
  input: z.output<typeof GitMutateInput>,
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

async function executeGitOperation<TInput extends z.output<typeof GitInspectInput> | z.output<typeof GitMutateInput>>(
  input: TInput,
  context: AgentHostToolContext,
  resolveArguments: (input: TInput, repository: string, executionEnv: SeneraExecutionEnv) => Promise<string[]>,
): Promise<GitOperationExecution> {
  const repository = path.resolve(input.repository);
  const args = await resolveArguments(input, repository, context.executionEnv);
  return executeGit(input.operation, repository, args, context);
}

interface GitOperationExecution {
  readonly result: z.output<typeof GitCommandOutput>;
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
    semanticProjectionRequest: {
      kind: AgentToolSemanticProjectionKinds.Execution,
      command: `git ${operation}`,
      cwd: repository,
    },
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

function gitObservationSource(
  source: AgentToolObservationProjectionManifest["sources"][number]["source"],
  mode: AgentToolObservationProjectionManifest["sources"][number]["mode"],
  priority: AgentToolObservationProjectionManifest["sources"][number]["priority"],
  requiredForCompletion: boolean,
  maxTokens: number,
  limits: AgentToolObservationProjectionManifest["sources"][number]["limits"],
) {
  return { source, mode, priority, requiredForCompletion, maxTokens, limits };
}

const GitExecutionProfile: SeneraProcessExecutionProfile = Object.freeze({
  name: "git-local",
  kind: "process",
  backend: "local",
});
