import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { createReadTool as createPiReadTool, type ReadToolInput } from "@earendil-works/pi-agent-core";
import {
  createFindTool,
  createFindToolDefinition,
  createGrepTool,
  createGrepToolDefinition,
  createLsTool,
  createLsToolDefinition,
  type FindOperations,
  type FindToolInput,
  type GrepOperations,
  type GrepToolInput,
  type LsOperations,
  type LsToolInput,
} from "@earendil-works/pi-coding-agent";
import { rgPath } from "@vscode/ripgrep";
import { minimatch } from "minimatch";
import { z } from "zod";
import {
  AgentHostToolProtocolVersion,
  ToolResultAssessmentPolicies,
  ToolSchedulingModes,
  type ToolResourceArgumentManifest,
  type ToolSearchManifest,
} from "../Types/AgentToolContractTypes.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import { defineSystemTool, type AgentSystemToolMetadata } from "./AgentSystemToolDefinition.js";

const bundledRipgrepPath = resolveAsarUnpackedExecutablePath(rgPath);

const PiReadTool = createPiReadTool();
const PiGrepContract = createGrepToolDefinition(".");
const PiFindContract = createFindToolDefinition(".");
const PiListContract = createLsToolDefinition(".");

const WorkspaceReadInput = piInputSchema<ReadToolInput>(PiReadTool.parameters);
const WorkspaceGrepInput = piInputSchema<GrepToolInput>(PiGrepContract.parameters);
const WorkspaceFindInput = piInputSchema<FindToolInput>(PiFindContract.parameters);
const WorkspaceListInput = piInputSchema<LsToolInput>(PiListContract.parameters);
const WorkspaceReadResource = Object.freeze({
  Capability: "senera.workspace.path",
  Pointer: "/path",
  Parameters: { Intent: "read" },
}) satisfies ToolResourceArgumentManifest;

const PiToolContent = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string(),
      textSignature: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      data: z.string(),
      mimeType: z.string(),
    })
    .strict(),
]);

const PiToolResult = z
  .object({
    content: z.array(PiToolContent),
    details: z.unknown().optional(),
  })
  .strict();

const WorkspaceToolsExtension = {
  name: "workspace-tools",
  displayName: {
    "zh-CN": "工作区工具",
    "en-US": "Workspace Tools",
  },
  description: {
    "zh-CN": "使用 Pi 原生文件工具安全地读取、搜索和浏览当前工作区。",
    "en-US": "Safely reads, searches, and browses the current workspace with Pi's native file tools.",
  },
  priority: 95,
} as const;

const WorkspaceReadSearch = workspaceToolSearch({
  commandAlias: "read",
  summary: "读取工作区中的文本文件或受支持图像，并使用 offset/limit 继续读取大文件。",
  capabilityId: "workspace.file.read",
  title: "Workspace file read",
  description: "Read one workspace file through Senera's authorized execution environment.",
  actions: ["read", "continue"],
  targets: ["workspace-file", "text-file", "image-file"],
  inputs: ["path", "offset", "limit"],
  outputs: ["file-content", "truncation-metadata"],
  aliases: ["读取文件", "查看文件", "read file"],
});

const WorkspaceGrepSearch = workspaceToolSearch({
  commandAlias: "grep",
  summary: "使用 Pi 原生 grep 和随包 ripgrep 搜索工作区内容，遵循 .gitignore。",
  capabilityId: "workspace.content.search",
  title: "Workspace content search",
  description: "Search workspace file contents with Pi's grep result and truncation semantics.",
  actions: ["search", "grep"],
  targets: ["workspace", "file-content"],
  inputs: ["pattern", "path", "glob", "context", "limit"],
  outputs: ["matching-lines", "file-paths", "line-numbers"],
  aliases: ["搜索代码", "查找内容", "search code"],
});

const WorkspaceFindSearch = workspaceToolSearch({
  commandAlias: "find",
  summary: "按 glob 查找工作区文件，包含隐藏文件并遵循嵌套 .gitignore。",
  capabilityId: "workspace.file.find",
  title: "Workspace file find",
  description: "Find workspace files by glob with Pi's result and truncation semantics.",
  actions: ["find", "enumerate"],
  targets: ["workspace", "file-path"],
  inputs: ["pattern", "path", "limit"],
  outputs: ["relative-file-paths", "truncation-metadata"],
  aliases: ["查找文件", "文件索引", "find files"],
});

const WorkspaceListSearch = workspaceToolSearch({
  commandAlias: "ls",
  summary: "按字母顺序列出工作区目录，包含点文件并标识子目录。",
  capabilityId: "workspace.directory.list",
  title: "Workspace directory list",
  description: "List one workspace directory with Pi's sorting and truncation semantics.",
  actions: ["list", "browse"],
  targets: ["workspace-directory"],
  inputs: ["path", "limit"],
  outputs: ["directory-entry"],
  aliases: ["列出目录", "浏览目录", "list directory"],
});

export const WorkspaceReadSystemTool = defineSystemTool({
  extension: WorkspaceToolsExtension,
  metadata: workspaceToolMetadata(PiReadTool.description, WorkspaceReadSearch),
  name: "WorkspaceRead",
  input: WorkspaceReadInput,
  output: PiToolResult,
  execute(input, context) {
    return PiReadTool.execute(toolCallId(context), input, context.signal, undefined, {
      env: context.executionEnv,
    });
  },
});

export const WorkspaceGrepSystemTool = defineSystemTool({
  extension: WorkspaceToolsExtension,
  metadata: workspaceToolMetadata(PiGrepContract.description, WorkspaceGrepSearch),
  name: "WorkspaceGrep",
  input: WorkspaceGrepInput,
  output: PiToolResult,
  async execute(input, context) {
    exposeBundledRipgrepToPi();
    const canonicalInput = await canonicalizeOptionalPath(input, context);
    const tool = createGrepTool(context.workspaceRoot, {
      operations: createGrepOperations(context),
    });
    return tool.execute(toolCallId(context), canonicalInput, context.signal);
  },
});

export const WorkspaceFindSystemTool = defineSystemTool({
  extension: WorkspaceToolsExtension,
  metadata: workspaceToolMetadata(PiFindContract.description, WorkspaceFindSearch),
  name: "WorkspaceFind",
  input: WorkspaceFindInput,
  output: PiToolResult,
  async execute(input, context) {
    assertBundledRipgrepAvailable();
    const canonicalInput = await canonicalizeOptionalPath(input, context);
    const tool = createFindTool(context.workspaceRoot, {
      operations: createFindOperations(context),
    });
    return tool.execute(toolCallId(context), canonicalInput, context.signal);
  },
});

export const WorkspaceListSystemTool = defineSystemTool({
  extension: WorkspaceToolsExtension,
  metadata: workspaceToolMetadata(PiListContract.description, WorkspaceListSearch),
  name: "WorkspaceList",
  input: WorkspaceListInput,
  output: PiToolResult,
  async execute(input, context) {
    const canonicalInput = await canonicalizeOptionalPath(input, context);
    const tool = createLsTool(context.workspaceRoot, {
      operations: createListOperations(context),
    });
    return tool.execute(toolCallId(context), canonicalInput, context.signal);
  },
});

export const PiWorkspaceSystemTools = Object.freeze([
  WorkspaceReadSystemTool,
  WorkspaceGrepSystemTool,
  WorkspaceFindSystemTool,
  WorkspaceListSystemTool,
]);

function workspaceToolMetadata(description: string, search: ToolSearchManifest): AgentSystemToolMetadata {
  return {
    observation: StandardAgentToolObservationProjection,
    description,
    permissions: ["filesystem:workspace:read"],
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: AgentHostToolProtocolVersion,
      ResultAssessment: ToolResultAssessmentPolicies.ProcessExit,
      Scheduling: ToolSchedulingModes.Parallel,
      Capabilities: { Cancellation: true },
    },
    resources: [WorkspaceReadResource],
    search,
  };
}

function workspaceToolSearch(input: {
  commandAlias: string;
  summary: string;
  capabilityId: string;
  title: string;
  description: string;
  actions: string[];
  targets: string[];
  inputs: string[];
  outputs: string[];
  aliases: string[];
}): ToolSearchManifest {
  return {
    Summary: input.summary,
    Tags: ["工作区", "文件读取", "代码搜索", input.commandAlias],
    Capabilities: [
      {
        Id: input.capabilityId,
        Title: input.title,
        Description: input.description,
        Facets: {
          Actions: input.actions,
          Targets: input.targets,
          Inputs: input.inputs,
          Outputs: input.outputs,
          Effects: ["none"],
        },
        Aliases: [input.commandAlias, ...input.aliases],
        Risk: { SideEffect: "none", Permission: "workspace-read" },
      },
    ],
    UseCases: [input.summary],
    Avoid: ["不要用于修改文件、执行构建或运行任意命令。"],
  };
}

function piInputSchema<TInput extends Record<string, unknown>>(schema: unknown): z.ZodType<TInput> {
  return z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodType<TInput>;
}

async function canonicalizeOptionalPath<TInput extends { path?: string }>(
  input: TInput,
  context: AgentHostToolContext,
): Promise<TInput & { path: string }> {
  context.signal?.throwIfAborted();
  const resolved = await context.executionEnv.canonicalPath(input.path ?? ".");
  if (!resolved.ok) throw resolved.error;
  return { ...input, path: resolved.value };
}

function createGrepOperations(context: AgentHostToolContext): GrepOperations {
  return {
    async isDirectory(absolutePath) {
      const result = await context.executionEnv.fileInfo(absolutePath);
      if (!result.ok) throw result.error;
      return result.value.kind === "directory";
    },
    async readFile(absolutePath) {
      const result = await context.executionEnv.readTextFile(absolutePath, context.signal);
      if (!result.ok) throw result.error;
      return result.value;
    },
  };
}

function createFindOperations(context: AgentHostToolContext): FindOperations {
  return {
    async exists(absolutePath) {
      const result = await context.executionEnv.exists(absolutePath);
      if (!result.ok) throw result.error;
      return result.value;
    },
    glob(pattern, cwd, options) {
      return enumerateWorkspaceFiles({
        pattern,
        cwd,
        ignore: options.ignore,
        limit: options.limit,
        signal: context.signal,
      });
    },
  };
}

function createListOperations(context: AgentHostToolContext): LsOperations {
  return {
    async exists(absolutePath) {
      const result = await context.executionEnv.exists(absolutePath);
      if (!result.ok) throw result.error;
      return result.value;
    },
    async stat(absolutePath) {
      const result = await context.executionEnv.fileInfo(absolutePath);
      if (!result.ok) throw result.error;
      return { isDirectory: () => result.value.kind === "directory" };
    },
    async readdir(absolutePath) {
      const result = await context.executionEnv.listDir(absolutePath, context.signal);
      if (!result.ok) throw result.error;
      return result.value.map((entry) => entry.name);
    },
  };
}

interface WorkspaceFileEnumerationRequest {
  readonly pattern: string;
  readonly cwd: string;
  readonly ignore: readonly string[];
  readonly limit: number;
  readonly signal?: AbortSignal;
}

function enumerateWorkspaceFiles(request: WorkspaceFileEnumerationRequest): Promise<string[]> {
  assertBundledRipgrepAvailable();
  return new Promise((resolve, reject) => {
    if (request.signal?.aborted) {
      reject(request.signal.reason ?? new Error("Operation aborted"));
      return;
    }

    const args = ["--files", "--hidden", "--no-require-git", "--color=never"];
    for (const ignored of request.ignore) args.push("--glob", `!${ignored}`);

    const child = spawn(bundledRipgrepPath, args, {
      cwd: request.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const reader = createInterface({ input: child.stdout });
    const results: string[] = [];
    let stderr = "";
    let limitReached = false;
    let settled = false;

    const cleanup = () => {
      reader.close();
      request.signal?.removeEventListener("abort", onAbort);
    };
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = () => {
      child.kill();
      settle(() => reject(request.signal?.reason ?? new Error("Operation aborted")));
    };

    request.signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    reader.on("line", (line) => {
      if (!line || results.length >= request.limit || !matchesPiFindPattern(line, request.pattern)) return;
      results.push(path.resolve(request.cwd, line));
      if (results.length >= request.limit) {
        limitReached = true;
        child.kill();
      }
    });
    child.on("error", (error) => settle(() => reject(error)));
    child.on("close", (code) => {
      if (request.signal?.aborted) {
        settle(() => reject(request.signal?.reason ?? new Error("Operation aborted")));
        return;
      }
      if (!limitReached && code !== 0 && code !== 1) {
        settle(() => reject(new Error(stderr.trim() || `ripgrep exited with code ${String(code)}`)));
        return;
      }
      settle(() => resolve(results));
    });
  });
}

function matchesPiFindPattern(candidate: string, pattern: string): boolean {
  const normalized = candidate.replaceAll("\\", "/");
  return minimatch(normalized, pattern, {
    dot: true,
    matchBase: !pattern.includes("/"),
  });
}

let bundledRipgrepVerified = false;
let bundledRipgrepExposed = false;

function assertBundledRipgrepAvailable(): void {
  if (bundledRipgrepVerified) return;
  if (!fs.existsSync(bundledRipgrepPath)) {
    throw new Error(`Bundled ripgrep is unavailable: ${bundledRipgrepPath}`);
  }
  const probe = spawnSync(bundledRipgrepPath, ["--version"], { stdio: "ignore", windowsHide: true });
  if (probe.error || probe.status !== 0) {
    throw new Error(`Bundled ripgrep cannot start: ${probe.error?.message ?? `exit ${String(probe.status)}`}`);
  }
  bundledRipgrepVerified = true;
}

function exposeBundledRipgrepToPi(): void {
  if (bundledRipgrepExposed) return;
  assertBundledRipgrepAvailable();
  const executableDirectory = path.dirname(bundledRipgrepPath);
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = process.env[pathKey] ?? "";
  const normalizedDirectory = normalizePathEntry(executableDirectory);
  const alreadyExposed = currentPath
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => normalizePathEntry(entry) === normalizedDirectory);
  if (!alreadyExposed) process.env[pathKey] = `${executableDirectory}${path.delimiter}${currentPath}`;
  bundledRipgrepExposed = true;
}

function normalizePathEntry(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function resolveAsarUnpackedExecutablePath(
  candidate: string,
  fileExists: (file: string) => boolean = fs.existsSync,
): string {
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  const segmentIndex = candidate.indexOf(asarSegment);
  if (segmentIndex < 0) return candidate;

  const unpackedCandidate = `${candidate.slice(0, segmentIndex)}${path.sep}app.asar.unpacked${path.sep}${candidate.slice(
    segmentIndex + asarSegment.length,
  )}`;
  return fileExists(unpackedCandidate) ? unpackedCandidate : candidate;
}

function toolCallId(context: AgentHostToolContext): string {
  return context.toolCallId ?? context.tool.name;
}
