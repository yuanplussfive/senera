import crypto from "node:crypto";
import type { AgentActionCapabilityNeed } from "../ActionPlanner/AgentActionPlanner.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type {
  AgentLoadedToolsConfig,
  ResolvedAgentToolLearningConfig,
  ResolvedAgentToolSearchConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessRunner.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentToolSearchIndex, type AgentToolSearchResult } from "./AgentToolSearchIndex.js";
import {
  AgentToolSearchMemory,
  type AgentToolUsePattern,
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
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentToolLearningRuntime } from "./AgentToolLearningRuntime.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";

export type { LoadedToolsState } from "./AgentToolSearchRuntimeTypes.js";
export { ToolSearchToolName } from "./AgentToolSearchRuntimeTypes.js";

export class AgentToolSearchRuntime {
  private readonly memory: AgentToolSearchMemory;
  private readonly usageMemory: AgentToolSearchUsageMemory;
  private readonly learningRuntime: AgentToolLearningRuntime;
  private index?: AgentToolSearchIndex;
  private readonly projectId: string;

  constructor(
    private readonly registry: AgentPluginRegistry,
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly learningConfig: ResolvedAgentToolLearningConfig,
    private readonly workspaceRoot: string,
    model: ResolvedAgentModelProviderConfig,
  ) {
    this.memory = new AgentToolSearchMemory(config, workspaceRoot);
    this.projectId = createProjectId(workspaceRoot);
    this.learningRuntime = new AgentToolLearningRuntime(
      registry,
      model,
      learningConfig,
      this.memory,
    );
    this.usageMemory = new AgentToolSearchUsageMemory(
      this.memory,
      this.projectId,
      this.learningConfig,
      this.learningRuntime,
    );
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

    const bootstrap = this.bootstrapToolNames();
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

    const bootstrap = this.bootstrapToolNames();
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
      .filter((name) => !this.systemToolNames().includes(name));
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
    turnUnderstanding?: TurnUnderstanding;
  }): LoadedToolsState {
    this.usageMemory.recordToolUsage(
      options.requestId,
      options.execution.value,
      options.turnUnderstanding,
    );
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

  toolUsePatterns(options: {
    input: string;
    allowedTools: readonly string[];
  }): AgentToolUsePattern[] {
    if (!this.learningConfig.Enabled) {
      return [];
    }

    return this.memory.patterns({
      queryTokens: this.searchIndex().tokenize(options.input),
      projectId: this.projectId,
      allowedTools: options.allowedTools,
      minSupport: this.learningConfig.Patterns.MinSupport,
      limit: this.learningConfig.Patterns.MaxPromptPatterns,
    });
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
    const required = this.bootstrapToolNames();
    return [
      ...required,
      ...unique.filter((name) => !required.includes(name)),
    ];
  }

  private bootstrapToolNames(): string[] {
    return [
      ...new Set([
        ...this.systemToolNames(),
      ]),
    ];
  }

  private systemToolNames(): string[] {
    return this.registry
      .listTools()
      .filter((tool) => tool.plugin.rootKind === "System")
      .map((tool) => tool.name);
  }

  private searchIndex(): AgentToolSearchIndex {
    this.index ??= new AgentToolSearchIndex(this.registry, this.config);
    return this.index;
  }
}

function createProjectId(workspaceRoot: string): string {
  return crypto.createHash("sha1").update(workspaceRoot.toLowerCase()).digest("hex");
}
