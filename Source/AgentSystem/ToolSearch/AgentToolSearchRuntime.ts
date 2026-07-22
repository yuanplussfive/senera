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
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentHostToolContractProjection } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentToolSearchIndex, type AgentToolSearchResult } from "./AgentToolSearchIndex.js";
import { AgentToolSearchMemory, type AgentToolUsePattern } from "./AgentToolSearchMemory.js";
import {
  AgentToolSearchCurrentSetPolicies,
  type AgentToolSearchCurrentSetPolicy,
  type LoadedToolsState,
} from "./AgentToolSearchRuntimeTypes.js";
import { ToolLoadingModes } from "../Types/PluginToolManifestTypes.js";
import {
  createToolSearchArgumentsSchema,
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
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";

export type { LoadedToolsState } from "./AgentToolSearchRuntimeTypes.js";
export { ToolSearchToolName } from "./AgentToolSearchRuntimeTypes.js";

export class AgentToolSearchRuntime {
  private readonly memory: AgentToolSearchMemory;
  private readonly usageMemory: AgentToolSearchUsageMemory;
  private readonly learningRuntime: AgentToolLearningRuntime;
  private index?: AgentToolSearchIndex;
  private readonly projectId: string;
  private readonly invocationSchemaCache = new WeakMap<
    object,
    { catalogIdentity: string; schema: Record<string, unknown> }
  >();

  constructor(
    private readonly registry: AgentPluginRegistry,
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly learningConfig: ResolvedAgentToolLearningConfig,
    private readonly workspaceRoot: string,
    model: ResolvedAgentModelProviderConfig,
    logger?: AgentLogger,
  ) {
    this.memory = new AgentToolSearchMemory(config, workspaceRoot);
    this.projectId = createProjectId(workspaceRoot);
    this.learningRuntime = new AgentToolLearningRuntime(registry, model, learningConfig, this.memory, logger);
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

  createHostContractProjection(): AgentHostToolContractProjection {
    return {
      projectInvocationSchema: (_tool, schema) => this.projectInvocationSchema(schema),
      projectDescription: (_tool, description) => this.projectDescription(description),
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

    return this.mergeVisibleTools([...bootstrap, ...discovered]);
  }

  resolvePlannedLoadedTools(options: {
    input: string;
    loadedTools: AgentLoadedToolsConfig;
    currentLoadedTools?: LoadedToolsState;
    currentSetPolicy?: AgentToolSearchCurrentSetPolicy;
    preferredTools?: readonly string[];
    queries?: readonly string[];
    needs?: readonly AgentActionCapabilityNeed[];
    discover?: boolean;
  }): LoadedToolsState {
    if (options.loadedTools !== "dynamic") {
      return options.loadedTools;
    }

    const bootstrap = this.bootstrapToolNames();
    const current = this.projectCurrentLoadedTools(
      options.currentLoadedTools,
      options.currentSetPolicy ?? AgentToolSearchCurrentSetPolicies.Retain,
    );
    const preferred = this.existingToolNames(options.preferredTools ?? []);
    const discovered = buildPlannedToolSearchQueries(options, (text) => this.tokenize(text)).flatMap((query) =>
      this.search({
        query: query.text,
        plannerTags: query.facets,
        includeLoaded: false,
        loadedToolNames: [...bootstrap, ...preferred],
      }).map((result) => result.toolName),
    );

    return this.mergeVisibleTools([...bootstrap, ...current, ...preferred, ...discovered]);
  }

  rememberAutoSearch(requestId: string, query: string, loadedToolNames: LoadedToolsState): void {
    if (loadedToolNames === "all") {
      return;
    }

    const candidates = loadedToolNames.filter((name) => !this.bootstrapToolNames().includes(name));
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

  finishRequest(requestId: string): void {
    this.usageMemory.finishRequest(requestId);
  }

  afterToolResults(options: {
    requestId: string;
    loadedTools: LoadedToolsState;
    dynamicTools: boolean;
    execution: { value: ExecutedToolCallResult[] };
    turnUnderstanding?: TurnUnderstanding;
  }): LoadedToolsState {
    this.usageMemory.recordToolUsage(options.requestId, options.execution.value, options.turnUnderstanding);
    if (!options.dynamicTools || options.loadedTools === "all") {
      return options.loadedTools;
    }

    return this.mergeVisibleTools([
      ...options.loadedTools,
      ...options.execution.value.map((result) => result.name),
      ...this.usageMemory.extractSearchResultToolNames(options.execution.value),
    ]);
  }

  search(options: {
    query: string;
    preferredSourceIds?: readonly string[];
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

  toolUsePatterns(options: { input: string; allowedTools: readonly string[] }): AgentToolUsePattern[] {
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
    const parsed = createToolSearchArgumentsSchema(this.discoverySourceIds()).safeParse(args);
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

  private buildToolSearchResult(args: ToolSearchArguments, loadedToolNames: readonly string[]) {
    const results = this.search({
      query: args.query,
      preferredSourceIds: args.preferredSources,
      includeLoaded: args.includeLoaded ?? false,
      loadedToolNames,
    });

    return buildToolSearchResultProjection(args, results);
  }

  private existingToolNames(toolNames: readonly string[]): string[] {
    return toolNames.filter((name) => Boolean(this.registry.getTool(name)));
  }

  private projectCurrentLoadedTools(
    current: LoadedToolsState | undefined,
    policy: AgentToolSearchCurrentSetPolicy,
  ): string[] {
    return CurrentSetProjectors[policy](
      current,
      this.registry.listTools().map((tool) => tool.name),
    );
  }

  private mergeVisibleTools(toolNames: readonly string[]): string[] {
    const unique = [...new Set(toolNames)].filter((name) => Boolean(this.registry.getTool(name)));
    const required = this.bootstrapToolNames();
    return [...required, ...unique.filter((name) => !required.includes(name))];
  }

  private bootstrapToolNames(): string[] {
    return this.registry
      .listTools()
      .filter((tool) => tool.loading === ToolLoadingModes.Bootstrap)
      .map((tool) => tool.name);
  }

  private searchIndex(): AgentToolSearchIndex {
    this.index ??= new AgentToolSearchIndex(this.registry, this.config);
    return this.index;
  }

  private discoverySourceIds(): string[] {
    return this.registry.listDiscoverySources().map((source) => source.id);
  }

  private projectInvocationSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const catalog = this.registry.listDiscoverySources();
    const catalogIdentity = JSON.stringify(catalog);
    const cached = this.invocationSchemaCache.get(schema);
    if (cached?.catalogIdentity === catalogIdentity) return cached.schema;

    const properties = readSchemaRecord(schema.properties, "ToolSearchTool input schema properties");
    const preferredSources = readSchemaRecord(
      properties.preferredSources,
      "ToolSearchTool preferredSources property schema",
    );
    const items = readSchemaRecord(preferredSources.items, "ToolSearchTool preferredSources item schema");
    const projected = deepFreeze({
      ...schema,
      properties: {
        ...properties,
        preferredSources: {
          ...preferredSources,
          description: "优先检索的能力来源；这是排序偏好，不会排除其他来源。省略时在全部来源中搜索。",
          uniqueItems: true,
          items: {
            ...items,
            enum: catalog.map((source) => source.id),
          },
        },
      },
    });
    this.invocationSchemaCache.set(schema, { catalogIdentity, schema: projected });
    return projected;
  }

  private projectDescription(description: string): string {
    const sources = this.registry.listDiscoverySources();
    if (sources.length === 0) return description;
    const sourceCatalog = sources.map((source) => `- ${source.id}: ${source.title} — ${source.description}`).join("\n");
    return `${description}\n\n可选能力来源（preferredSources 仅影响排序）：\n${sourceCatalog}`;
  }
}

const CurrentSetProjectors = {
  [AgentToolSearchCurrentSetPolicies.Retain]: (current: LoadedToolsState | undefined, allTools: readonly string[]) =>
    current === "all" ? [...allTools] : [...(current ?? [])],
  [AgentToolSearchCurrentSetPolicies.Replace]: () => [],
} satisfies Record<
  AgentToolSearchCurrentSetPolicy,
  (current: LoadedToolsState | undefined, allTools: readonly string[]) => string[]
>;

function createProjectId(workspaceRoot: string): string {
  return crypto.createHash("sha1").update(workspaceRoot.toLowerCase()).digest("hex");
}

function readSchemaRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
