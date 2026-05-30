import crypto from "node:crypto";
import { z } from "zod";
import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type {
  AgentLoadedToolsConfig,
  ExecutedToolCallResult,
  ResolvedAgentToolSearchConfig,
} from "./Types.js";
import { AgentToolProcessProtocol } from "./AgentToolProcessProtocol.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import { AgentToolSearchIndex, type AgentToolSearchResult } from "./AgentToolSearchIndex.js";
import {
  AgentToolSearchMemory,
  type AgentToolSearchEpisode,
} from "./AgentToolSearchMemory.js";

const ToolSearchArgumentsSchema = z
  .object({
    query: z.preprocess(coerceStringLike, z.string().trim().min(1)),
    includeLoaded: z.preprocess(coerceBooleanLike, z.boolean()).optional(),
  })
  .strict();

type ToolSearchArguments = z.infer<typeof ToolSearchArgumentsSchema>;
export type LoadedToolsState = "all" | string[];

interface PendingToolSearch {
  query: string;
  queryTokens: string[];
  candidates: string[];
  timestamp: number;
}

export const ToolSearchToolName = "ToolSearchTool";

export class AgentToolSearchRuntime {
  private readonly memory: AgentToolSearchMemory;
  private index?: AgentToolSearchIndex;
  private readonly pendingSearches = new Map<string, PendingToolSearch[]>();
  private readonly projectId: string;

  constructor(
    private readonly registry: AgentPluginRegistry,
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly workspaceRoot: string,
  ) {
    this.memory = new AgentToolSearchMemory(config, workspaceRoot);
    this.projectId = createProjectId(workspaceRoot);
  }

  createHostHandler(): AgentHostToolHandler {
    return async (args, context) => this.runToolSearch(args, {
      requestId: context.requestId,
      visibleToolNames: context.visibleToolNames,
    });
  }

  resolveInitialLoadedTools(input: string, loadedTools: AgentLoadedToolsConfig): LoadedToolsState {
    if (loadedTools !== "dynamic") {
      return loadedTools;
    }

    const bootstrap = this.existingToolNames(this.config.Dynamic.BootstrapTools);
    const discovered = this.search({
      query: input,
      includeLoaded: false,
      loadedToolNames: bootstrap,
    }).map((result) => result.toolName);

    return this.capVisibleTools([...bootstrap, ...discovered]);
  }

  resolvePlannedLoadedTools(options: {
    input: string;
    loadedTools: AgentLoadedToolsConfig;
    currentLoadedTools?: LoadedToolsState;
    preferredTools?: readonly string[];
    toolSearchQueries?: readonly string[];
    discover?: boolean;
  }): LoadedToolsState {
    if (options.loadedTools !== "dynamic") {
      return options.loadedTools;
    }

    const bootstrap = this.existingToolNames(this.config.Dynamic.BootstrapTools);
    const current = options.currentLoadedTools === "all"
      ? this.registry.listTools().map((tool) => tool.name)
      : options.currentLoadedTools ?? [];
    const preferred = this.existingToolNames(options.preferredTools ?? []);
    const discovered = (options.toolSearchQueries && options.toolSearchQueries.length > 0
      ? options.toolSearchQueries
      : options.discover
        ? [options.input]
        : []
    ).flatMap((query) =>
      this.search({
        query,
        includeLoaded: false,
        loadedToolNames: [...bootstrap, ...preferred],
      }).map((result) => result.toolName));

    return this.capVisibleTools([
      ...bootstrap,
      ...current,
      ...preferred,
      ...discovered,
    ]);
  }

  rememberAutoSearch(requestId: string, query: string, loadedToolNames: LoadedToolsState): void {
    if (loadedToolNames === "all") {
      return;
    }

    const candidates = loadedToolNames
      .filter((name) => !this.config.Dynamic.BootstrapTools.includes(name));
    if (candidates.length === 0) {
      return;
    }

    this.rememberSearch(requestId, {
      query,
      queryTokens: this.tokenize(query),
      candidates,
      timestamp: Date.now(),
    });
  }

  afterToolResults(options: {
    requestId: string;
    loadedTools: LoadedToolsState;
    dynamicTools: boolean;
    execution: { value: ExecutedToolCallResult[] };
  }): LoadedToolsState {
    this.recordToolUsage(options.requestId, options.execution.value);
    if (!options.dynamicTools || options.loadedTools === "all") {
      return options.loadedTools;
    }

    return this.capVisibleTools([
      ...options.loadedTools,
      ...options.execution.value.map((result) => result.name),
      ...this.extractSearchResultToolNames(options.execution.value),
    ]);
  }

  search(options: {
    query: string;
    includeLoaded?: boolean;
    loadedToolNames?: readonly string[];
  }): AgentToolSearchResult[] {
    const tokens = this.searchIndex().tokenize(options.query);
    const memoryEvidence = this.memory.rank(tokens, this.projectId);
    return this.searchIndex().search({
      ...options,
      memoryEvidence,
    });
  }

  tokenize(text: string): string[] {
    return this.searchIndex().tokenize(text);
  }

  close(): void {
    this.memory.close();
  }

  private async runToolSearch(
    args: Record<string, unknown>,
    context: {
      requestId?: string;
      visibleToolNames?: readonly string[];
    },
  ): Promise<AgentToolProcessRunResult> {
    const parsed = ToolSearchArgumentsSchema.safeParse(args);
    if (!parsed.success) {
      return failure({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: "ToolSearchTool 参数无效。",
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          issues: parsed.error.issues,
          toolName: ToolSearchToolName,
        },
        diagnostics: parsed.error.issues.map((issue) => ({
          message: issue.message,
          pointer: `/${issue.path.join("/")}`,
          path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
        })),
      });
    }

    const result = this.buildToolSearchResult(parsed.data, context.visibleToolNames ?? []);
    if (context.requestId) {
      this.rememberSearch(context.requestId, {
        query: parsed.data.query,
        queryTokens: this.tokenize(parsed.data.query),
        candidates: result.tools.item.map((entry) => entry.name),
        timestamp: Date.now(),
      });
    }

    return {
      response: {
        protocol: AgentToolProcessProtocol,
        ok: true,
        result,
      },
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
    };
  }

  private buildToolSearchResult(
    args: ToolSearchArguments,
    loadedToolNames: readonly string[],
  ) {
    const results = this.search({
      query: args.query,
      includeLoaded: args.includeLoaded ?? false,
      loadedToolNames,
    });

    return {
      query: args.query,
      tools: {
        item: results.map((result) => ({
          name: result.toolName,
          title: result.title,
          summary: result.summary,
          whenToUse: result.whenToUse,
          score: result.score,
          matchedTerms: {
            item: result.matchedTerms,
          },
          permissions: {
            item: result.permissions,
          },
        })),
      },
      guidance: results.length > 0
        ? "这些工具会在下一轮提示词中展开完整能力卡片；下一步需要工具时只调用其中最匹配的工具。"
        : "没有找到匹配工具；换更具体的任务、对象、路径、错误文本或能力关键词重新搜索。",
    };
  }

  private rememberSearch(requestId: string, search: PendingToolSearch): void {
    const entries = this.pendingSearches.get(requestId) ?? [];
    this.pendingSearches.set(requestId, [...entries.slice(-4), search]);
  }

  private recordToolUsage(
    requestId: string,
    results: ExecutedToolCallResult[],
  ): void {
    const chosenTools = results
      .map((result) => result.name)
      .filter((name) => name !== ToolSearchToolName);
    if (chosenTools.length === 0) {
      return;
    }

    const pending = this.pendingSearches.get(requestId);
    if (!pending || pending.length === 0) {
      return;
    }

    const relevant = [...pending]
      .reverse()
      .find((entry) => chosenTools.some((name) => entry.candidates.includes(name)));
    if (!relevant) {
      return;
    }

    this.memory.record({
      query: relevant.query,
      queryTokens: relevant.queryTokens,
      candidates: relevant.candidates,
      chosenTools,
      outcome: results.some((result) => hasToolError(result.result)) ? "failure" : "success",
      projectId: this.projectId,
      timestamp: Date.now(),
    } satisfies AgentToolSearchEpisode);
    this.pendingSearches.delete(requestId);
  }

  private extractSearchResultToolNames(results: ExecutedToolCallResult[]): string[] {
    return results
      .filter((result) => result.name === ToolSearchToolName)
      .flatMap((result) => readToolNamesFromSearchResult(result.result));
  }

  private existingToolNames(toolNames: readonly string[]): string[] {
    return toolNames.filter((name) => Boolean(this.registry.getTool(name)));
  }

  private capVisibleTools(toolNames: readonly string[]): string[] {
    const unique = [...new Set(toolNames)].filter((name) => Boolean(this.registry.getTool(name)));
    const required = this.existingToolNames(this.config.Dynamic.BootstrapTools);
    return [
      ...required,
      ...unique.filter((name) => !required.includes(name)),
    ];
  }

  private searchIndex(): AgentToolSearchIndex {
    this.index ??= new AgentToolSearchIndex(this.registry, this.config);
    return this.index;
  }
}

function readToolNamesFromSearchResult(result: unknown): string[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return [];
  }

  const tools = (result as Record<string, unknown>).tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    return [];
  }

  const item = (tools as Record<string, unknown>).item;
  if (!Array.isArray(item)) {
    return [];
  }

  return item.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const name = (entry as Record<string, unknown>).name;
    return typeof name === "string" && name.trim().length > 0 ? [name.trim()] : [];
  });
}

function hasToolError(result: unknown): boolean {
  return Boolean(
    result
      && typeof result === "object"
      && !Array.isArray(result)
      && "error" in result,
  );
}

function failure(error: NonNullable<AgentToolProcessRunResult["response"]["error"]>): AgentToolProcessRunResult {
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

function coerceStringLike(value: unknown): unknown {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
}

function coerceBooleanLike(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}

function createProjectId(workspaceRoot: string): string {
  return crypto.createHash("sha1").update(workspaceRoot.toLowerCase()).digest("hex");
}
