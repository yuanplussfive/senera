import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  createReadTool as createPiReadTool,
  createFindTool,
  createLsTool,
  type ReadToolInput,
  type FindOperations,
  type FindToolInput,
  type GrepToolInput,
  type LsOperations,
  type LsToolInput,
} from "@earendil-works/pi-coding-agent";
import { fileTypeFromBuffer } from "file-type";
import { rgPath } from "@vscode/ripgrep";
import { resolveAsarUnpackedExecutablePath } from "../Core/AgentExecutablePath.js";
export { resolveAsarUnpackedExecutablePath } from "../Core/AgentExecutablePath.js";
import { minimatch } from "minimatch";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { searchWorkspaceContent } from "../WorkspaceResources/AgentWorkspaceContentSearch.js";
import { workspaceContentExclusionGlobs } from "../WorkspaceResources/AgentWorkspaceFileDiscovery.js";
import { defineSystemTool, systemToolArguments } from "./AgentSystemToolDefinition.js";

const bundledRipgrepPath = resolveAsarUnpackedExecutablePath(rgPath);

export const WorkspaceReadSystemTool = defineSystemTool({
  capability: "system.tool.workspace-tools.WorkspaceRead",
  async execute(input, context) {
    context.signal?.throwIfAborted();
    const args = systemToolArguments<ReadToolInput & Record<string, unknown>>(input);
    // Read once through the host's authorized file handle. MIME detection and
    // Pi's formatter consume the same snapshot without reopening the path.
    const result = await context.executionEnv.readBinaryFile(args.path, context.signal);
    if (!result.ok) throw result.error;
    const content = Buffer.from(result.value);
    const tool = createPiReadTool(context.workspaceRoot, {
      operations: {
        readFile: async () => content,
        async access() {
          context.signal?.throwIfAborted();
        },
        async detectImageMimeType() {
          const type = await fileTypeFromBuffer(content);
          return type?.mime.startsWith("image/") ? type.mime : undefined;
        },
      },
    });
    return projectPiWorkspaceToolResult(await tool.execute(toolCallId(context), args, context.signal));
  },
});

export const WorkspaceGrepSystemTool = defineSystemTool({
  capability: "system.tool.workspace-tools.WorkspaceGrep",
  async execute(input, context) {
    assertBundledRipgrepAvailable();
    const canonicalInput = await canonicalizeOptionalPath(
      systemToolArguments<GrepToolInput & Record<string, unknown>>(input),
      context,
    );
    return searchWorkspaceContent({
      workspaceRoot: context.workspaceRoot,
      ripgrepPath: bundledRipgrepPath,
      request: { ...canonicalInput, searchPath: canonicalInput.path, signal: context.signal },
      operations: {
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
      },
    });
  },
});

export const WorkspaceFindSystemTool = defineSystemTool({
  capability: "system.tool.workspace-tools.WorkspaceFind",
  async execute(input, context) {
    assertBundledRipgrepAvailable();
    const canonicalInput = await canonicalizeOptionalPath(
      systemToolArguments<FindToolInput & Record<string, unknown>>(input),
      context,
    );
    const tool = createFindTool(context.workspaceRoot, {
      operations: createFindOperations(context),
    });
    return projectPiWorkspaceToolResult(await tool.execute(toolCallId(context), canonicalInput, context.signal));
  },
});

export const WorkspaceListSystemTool = defineSystemTool({
  capability: "system.tool.workspace-tools.WorkspaceList",
  async execute(input, context) {
    const canonicalInput = await canonicalizeOptionalPath(
      systemToolArguments<LsToolInput & Record<string, unknown>>(input),
      context,
    );
    const tool = createLsTool(context.workspaceRoot, {
      operations: createListOperations(context),
    });
    return projectPiWorkspaceToolResult(await tool.execute(toolCallId(context), canonicalInput, context.signal));
  },
});

export const PiWorkspaceSystemTools = Object.freeze([
  WorkspaceReadSystemTool,
  WorkspaceGrepSystemTool,
  WorkspaceFindSystemTool,
  WorkspaceListSystemTool,
]);

async function canonicalizeOptionalPath<TInput extends { path?: string }>(
  input: TInput,
  context: AgentHostToolContext,
): Promise<TInput & { path: string }> {
  context.signal?.throwIfAborted();
  const resolved = await context.executionEnv.canonicalPath(input.path ?? ".");
  if (!resolved.ok) throw resolved.error;
  return { ...input, path: resolved.value };
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
        ignore: mergeWorkspaceFindIgnores(options.ignore, context.workspaceRoot, cwd),
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
      const result = await context.executionEnv.readDirectoryNames(absolutePath, context.signal);
      if (!result.ok) throw result.error;
      return result.value;
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

function mergeWorkspaceFindIgnores(ignores: readonly string[], workspaceRoot: string, searchRoot: string): string[] {
  return [...new Set([...ignores, ...workspaceContentExclusionGlobs(workspaceRoot, searchRoot)])];
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

function toolCallId(context: AgentHostToolContext): string {
  return context.toolCallId ?? context.tool.name;
}

/** Keep Senera's published workspace result contract; Pi's structuredContent duplicates content. */
function projectPiWorkspaceToolResult(
  result: AgentToolResult<unknown>,
): Pick<AgentToolResult<unknown>, "content" | "details"> {
  return { content: result.content, details: result.details };
}
