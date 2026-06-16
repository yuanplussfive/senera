import crypto from "node:crypto";
import type { AgentActionCapabilityNeed } from "./AgentActionPlanner.js";
import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type {
  AgentLoadedToolsConfig,
  ExecutedToolCallResult,
  ResolvedAgentToolSearchConfig,
} from "./Types.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import { AgentToolSearchIndex, type AgentToolSearchResult } from "./AgentToolSearchIndex.js";
import {
  AgentToolSearchMemory,
} from "./AgentToolSearchMemory.js";
import type {
  LoadedToolsState,
} from "./AgentToolSearchRuntimeTypes.js";
import {
  ToolSearchArgumentsSchema,
  invalidToolSearchArgumentsResult,
  okToolSearchResult,
  type ToolSearchArguments,
} from "./AgentToolSearchToolProtocol.js";
import { buildToolSearchResultProjection } from "./AgentToolSearchResultProjector.js";
import { buildPlannedToolSearchQueries } from "./AgentToolSearchQueryPlanner.js";
import { AgentToolSearchUsageMemory } from "./AgentToolSearchUsageMemory.js";
import { throwIfAborted } from "./AgentCancellation.js";

export type { LoadedToolsState } from "./AgentToolSearchRuntimeTypes.js";
export { ToolSearchToolName } from "./AgentToolSearchRuntimeTypes.js";

export class AgentToolSearchRuntime {
  private readonly memory: AgentToolSearchMemory;
  private readonly usageMemory: AgentToolSearchUsageMemory;
  private index?: AgentToolSearchIndex;
  private readonly projectId: string;

  constructor(
    private readonly registry: AgentPluginRegistry,
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly workspaceRoot: string,
  ) {
    this.memory = new AgentToolSearchMemory(config, workspaceRoot);
    this.projectId = createProjectId(workspaceRoot);
    this.usageMemory = new AgentToolSearchUsageMemory(this.memory, this.projectId);
  }

  createHostHandler(): AgentHostToolHandler {
    return async (args, context) => {
      throwIfAborted(context.signal);
      return this.runToolSearch(args, {
        requestId: context.requestId,
        visibleToolNames: context.visibleToolNames,
      });
    };
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
    queries?: readonly string[];
    needs?: readonly AgentActionCapabilityNeed[];
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
    const discovered = buildPlannedToolSearchQueries(options, (text) => this.tokenize(text)).flatMap((query) =>
      this.search({
        query: query.text,
        plannerTags: query.facets,
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

    this.usageMemory.rememberSearch(requestId, {
      query,
      queryTokens: this.tokenize(query),
      plannerTags: [],
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
    this.usageMemory.recordToolUsage(options.requestId, options.execution.value);
    if (!options.dynamicTools || options.loadedTools === "all") {
      return options.loadedTools;
    }

    return this.capVisibleTools([
      ...options.loadedTools,
      ...options.execution.value.map((result) => result.name),
      ...this.usageMemory.extractSearchResultToolNames(options.execution.value),
    ]);
  }

  search(options: {
    query: string;
    plannerTags?: readonly string[];
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
      return invalidToolSearchArgumentsResult(parsed.error.issues);
    }

    const result = this.buildToolSearchResult(parsed.data, context.visibleToolNames ?? []);
    if (context.requestId) {
      this.usageMemory.rememberSearch(context.requestId, {
        query: parsed.data.query,
        queryTokens: this.tokenize(parsed.data.query),
        plannerTags: [],
        candidates: result.tools.item.map((entry) => entry.name),
        timestamp: Date.now(),
      });
    }

    return okToolSearchResult(result);
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

    return buildToolSearchResultProjection(args, results);
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

function createProjectId(workspaceRoot: string): string {
  return crypto.createHash("sha1").update(workspaceRoot.toLowerCase()).digest("hex");
}
