import type { AgentActionCapabilityNeed } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type {
  ResolvedAgentToolLearningConfig,
  ResolvedAgentToolSearchConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentToolSearchIndex, type AgentToolSearchResult } from "./AgentToolSearchIndex.js";
import { AgentToolSearchMemory, type AgentToolUsePattern } from "./AgentToolSearchMemory.js";
import {
  AgentToolSearchCurrentSetPolicies,
  AgentToolMetaToolNames,
  isAgentToolMetaToolName,
  type AgentToolSearchCurrentSetPolicy,
  type LoadedToolsState,
} from "./AgentToolSearchRuntimeTypes.js";
import { ToolLoadingModes, type ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import {
  createAgentToolDiscoveryResult,
  createToolSearchArgumentsSchema,
  invalidToolMetaArgumentsResult,
  okToolMetaResult,
  ToolDescribeArgumentsSchema,
  ToolLoadArgumentsSchema,
  ToolUnloadArgumentsSchema,
  type ToolSearchArguments,
} from "./AgentToolMetaToolProtocol.js";
import {
  buildToolSearchResultProjection,
  readToolNamesFromSearchResult,
  withToolSearchCatalogRevision,
} from "./AgentToolSearchResultProjector.js";
import { AgentToolSearchUsageMemory } from "./AgentToolSearchUsageMemory.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentToolLearningRuntime } from "./AgentToolLearningRuntime.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentToolSearchMemoryStore } from "./AgentToolSearchMemoryTypes.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import type { AgentSkillSelectionLearningEvidence } from "../Skills/AgentSkillSelector.js";
import { AgentSkillLearningRuntime } from "./AgentSkillLearningRuntime.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { createAgentToolSearchProjectId } from "./AgentToolSearchProject.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import { AgentToolSearchResultModes, type AgentToolSearchResultMode } from "./AgentToolSearchTypes.js";
import {
  AgentCapabilitySearchIndex,
  createAgentCapabilityEmbeddingIdentity,
  type AgentCapabilityEmbeddingClient,
  type AgentCapabilityRerankClient,
  type AgentCapabilitySearchDocument,
} from "./AgentCapabilitySearchIndex.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import { AgentToolSearchDocumentBuilder } from "./AgentToolSearchDocumentBuilder.js";
import { buildSkillCapabilityDocument, buildToolCapabilityDocument } from "./AgentCapabilityDocumentBuilder.js";
import { AgentSkillSelector, type AgentSkillSelectionResult } from "../Skills/AgentSkillSelector.js";
import { AgentToolSearchContractProjector } from "./AgentToolSearchContractProjector.js";
import { AgentLruCache } from "../Core/AgentLruCache.js";
import { resolveAvailableAgentToolExecutionTargets } from "../ToolRuntime/AgentToolExecutionPlan.js";
import { projectToolDescription } from "./AgentToolMetaToolProjector.js";
import {
  AgentToolCapabilitySessionCache,
  type AgentToolCapabilityCacheEntry,
} from "./AgentToolCapabilitySessionCache.js";
import { AgentToolAssessmentStatuses } from "../ToolRuntime/AgentToolResultOutcome.js";

export type { LoadedToolsState } from "./AgentToolSearchRuntimeTypes.js";
export { AgentToolMetaToolNames } from "./AgentToolSearchRuntimeTypes.js";

export interface AgentToolSearchRuntimeOptions {
  logger?: AgentLogger;
  memoryStore?: AgentToolSearchMemoryStore;
  embedding?: {
    client: AgentCapabilityEmbeddingClient;
    model: string;
  };
  rerank?: {
    client: AgentCapabilityRerankClient;
  };
  availableExecutionTargets: () => readonly ToolExecutionTarget[];
}

export class AgentToolSearchRuntime {
  private readonly memory: AgentToolSearchMemory;
  private readonly usageMemory: AgentToolSearchUsageMemory;
  private readonly learningRuntime: AgentToolLearningRuntime;
  private readonly skillLearningRuntime: AgentSkillLearningRuntime;
  private readonly logger?: AgentLogger;
  private toolCatalog?: AgentToolCatalogSnapshot;
  private index?: AgentToolSearchIndex;
  private searchIndexIdentity?: string;
  private capabilities?: AgentCapabilitySearchIndex;
  private capabilityCatalogIdentity?: string;
  private capabilityRegistryRevision?: number;
  private capabilityToolCatalogIdentity?: string;
  private readonly capabilityEmbeddingCache = new AgentLruCache<string, readonly number[]>(
    AgentCapabilityEmbeddingCachePolicy.MinimumEntries,
  );
  private readonly projectId: string;
  private readonly contractProjector: AgentToolSearchContractProjector;
  private readonly capabilitySessionCache = new AgentToolCapabilitySessionCache();

  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly learningConfig: ResolvedAgentToolLearningConfig,
    workspaceRoot: string,
    model: ResolvedAgentModelProviderConfig,
    private readonly options: AgentToolSearchRuntimeOptions,
  ) {
    this.logger = options.logger;
    this.contractProjector = new AgentToolSearchContractProjector(registry);
    this.memory = new AgentToolSearchMemory(config, workspaceRoot, options.memoryStore);
    this.projectId = createAgentToolSearchProjectId(workspaceRoot);
    this.learningRuntime = new AgentToolLearningRuntime(registry, model, learningConfig, this.memory, options.logger);
    this.skillLearningRuntime = new AgentSkillLearningRuntime(this.memory, options.logger);
    this.usageMemory = new AgentToolSearchUsageMemory(
      this.memory,
      this.projectId,
      this.learningConfig,
      this.learningRuntime,
      this.skillLearningRuntime,
    );
  }

  createSearchHostHandler(): AgentHostToolHandler {
    return async (args, context) => {
      throwIfAborted(context.signal);
      const run = await this.runToolSearch(args, {
        requestId: context.requestId,
        sessionId: context.sessionId,
        visibleToolNames: context.visibleToolNames,
        authorizedToolNames: context.authorizedToolNames,
        signal: context.signal,
      });
      return run;
    };
  }

  createDescribeHostHandler(): AgentHostToolHandler {
    return async (args, context) => {
      throwIfAborted(context.signal);
      const parsed = ToolDescribeArgumentsSchema.safeParse(args);
      if (!parsed.success) return invalidToolMetaArgumentsResult(AgentToolMetaToolNames.Describe, parsed.error.issues);

      const catalogRevision = this.catalogRevision();
      const requested = this.resolveAuthorizedTools(parsed.data.tools, context.authorizedToolNames);
      for (const tool of requested.tools) {
        this.capabilitySessionCache.rememberContract({
          sessionId: context.sessionId,
          toolName: tool.name,
          catalogRevision,
          contractDigest: tool.contract?.digest,
        });
      }
      return okToolMetaResult(
        createAgentToolDiscoveryResult({
          catalogRevision,
          catalogStatus: readCatalogStatus(parsed.data.catalogRevision, catalogRevision),
          tools: {
            item: requested.tools.map((tool) => projectToolDescription(tool, this.options.availableExecutionTargets())),
          },
          rejected: { item: requested.rejectedToolNames },
        }),
      );
    };
  }

  createLoadHostHandler(): AgentHostToolHandler {
    return async (args, context) => {
      throwIfAborted(context.signal);
      const parsed = ToolLoadArgumentsSchema.safeParse(args);
      if (!parsed.success) return invalidToolMetaArgumentsResult(AgentToolMetaToolNames.Load, parsed.error.issues);

      const catalogRevision = this.catalogRevision();
      const catalogStatus = readCatalogStatus(parsed.data.catalogRevision, catalogRevision);
      const requested = this.resolveAuthorizedTools(parsed.data.tools, context.authorizedToolNames);
      const delta =
        catalogStatus === "current" && context.toolExposure
          ? context.toolExposure.expose(requested.tools.map((tool) => tool.name))
          : undefined;
      return okToolMetaResult(
        createAgentToolDiscoveryResult({
          catalogRevision,
          catalogStatus,
          generation: delta?.snapshot.generation ?? context.toolExposure?.snapshot().generation ?? 0,
          added: { item: delta?.addedToolNames ?? [] },
          loaded: { item: delta?.snapshot.exposedToolNames ?? context.visibleToolNames ?? [] },
          rejected: {
            item: uniqueToolNames([
              ...requested.rejectedToolNames,
              ...(delta?.rejectedToolNames ?? requested.tools.map((tool) => tool.name)),
            ]),
          },
        }),
      );
    };
  }

  createUnloadHostHandler(): AgentHostToolHandler {
    return async (args, context) => {
      throwIfAborted(context.signal);
      const parsed = ToolUnloadArgumentsSchema.safeParse(args);
      if (!parsed.success) return invalidToolMetaArgumentsResult(AgentToolMetaToolNames.Unload, parsed.error.issues);

      const requested = this.resolveAuthorizedTools(parsed.data.tools, context.authorizedToolNames);
      const delta = context.toolExposure?.revoke(
        requested.tools.map((tool) => tool.name),
        {
          protectedToolNames: this.bootstrapToolNames(),
        },
      );
      return okToolMetaResult(
        createAgentToolDiscoveryResult({
          catalogRevision: this.catalogRevision(),
          generation: delta?.snapshot.generation ?? context.toolExposure?.snapshot().generation ?? 0,
          removed: { item: delta?.removedToolNames ?? [] },
          protected: { item: delta?.protectedToolNames ?? [] },
          loaded: { item: delta?.snapshot.exposedToolNames ?? context.visibleToolNames ?? [] },
          rejected: {
            item: uniqueToolNames([
              ...requested.rejectedToolNames,
              ...(delta?.rejectedToolNames ?? requested.tools.map((tool) => tool.name)),
            ]),
          },
        }),
      );
    };
  }

  createHostContractProjection() {
    return this.contractProjector.createProjection();
  }

  async resolveInitialLoadedTools(_input: string, warmToolNames: LoadedToolsState = []): Promise<LoadedToolsState> {
    return this.mergeVisibleTools([...this.bootstrapToolNames(), ...this.existingToolNames(warmToolNames)]);
  }

  async resolvePlannedLoadedTools(options: {
    input: string;
    currentLoadedTools?: LoadedToolsState;
    currentSetPolicy?: AgentToolSearchCurrentSetPolicy;
    preferredTools?: readonly string[];
    queries?: readonly string[];
    needs?: readonly AgentActionCapabilityNeed[];
    discover?: boolean;
    signal?: AbortSignal;
  }): Promise<LoadedToolsState> {
    const bootstrap = this.bootstrapToolNames();
    const current = this.projectCurrentLoadedTools(
      options.currentLoadedTools,
      options.currentSetPolicy ?? AgentToolSearchCurrentSetPolicies.Retain,
    );
    const preferred = options.discover ? this.existingToolNames(options.preferredTools ?? []) : [];
    const planned = [...current, ...preferred];
    if (options.discover) {
      const query = buildPlannedToolSearchQuery(options);
      if (query.length > 0) {
        const results = await this.search({
          query,
          includeLoaded: false,
          loadedToolNames: planned,
          signal: options.signal,
        });
        planned.push(...results.map((result) => result.toolName));
      }
    }
    return this.mergeVisibleTools([...bootstrap, ...planned]);
  }

  rememberAutoSearch(_requestId: string, _query: string, _loadedToolNames: LoadedToolsState): void {
    // Search history is only created by an explicit ToolSearch call.
  }

  finishRequest(requestId: string): void {
    this.usageMemory.finishRequest(requestId);
  }

  afterToolResults(options: {
    requestId: string;
    userInput: string;
    sessionId?: string;
    loadedTools: LoadedToolsState;
    execution: { value: ExecutedToolCallResult[] };
    activeSkills?: readonly AgentActivatedSkill[];
  }): LoadedToolsState {
    const loadedTools = this.mergeVisibleTools(options.loadedTools);
    this.rememberSuccessfulCapabilities(options.sessionId, options.execution.value);
    try {
      this.usageMemory.recordToolUsage({
        requestId: options.requestId,
        userInput: options.userInput,
        sessionId: options.sessionId,
        results: options.execution.value,
        activeSkills: options.activeSkills,
      });
    } catch (error) {
      this.usageMemory.finishRequest(options.requestId);
      this.logger?.warn("routing.learning.observation_failed", {
        requestId: options.requestId,
        message: errorMessage(error),
      });
    }
    return loadedTools;
  }

  async search(options: {
    query: string;
    preferredSourceIds?: readonly string[];
    plannerTags?: readonly string[];
    includeLoaded?: boolean;
    loadedToolNames?: readonly string[];
    authorizedToolNames?: readonly string[];
    signal?: AbortSignal;
    resultMode?: AgentToolSearchResultMode;
  }): Promise<AgentToolSearchResult[]> {
    const tokens = this.searchIndex().tokenize(options.query);
    const memoryEvidence = this.memory.rank(tokens, this.projectId);
    return this.searchIndex().searchHybrid(
      {
        ...options,
        memoryEvidence,
      },
      options.signal,
    );
  }

  /** Returns the bounded capability records for diagnostics and prompt
   * compilers that want to reuse a confirmed invocation without another
   * ToolSearch round trip. */
  capabilitySnapshot(sessionId?: string): readonly AgentToolCapabilityCacheEntry[] {
    return this.capabilitySessionCache.snapshot(sessionId);
  }

  getReusableCapability(options: {
    sessionId?: string;
    toolName: string;
    catalogRevision?: string;
  }): AgentToolCapabilityCacheEntry | undefined {
    const tool = this.registry.getTool(options.toolName);
    return this.capabilitySessionCache.getReusable({
      sessionId: options.sessionId,
      toolName: options.toolName,
      catalogRevision: options.catalogRevision ?? this.catalogRevision(),
      contractDigest: tool?.contract?.digest,
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

  skillRoutingEvidence(options: {
    query: string;
    skills: readonly RegisteredSkill[];
  }): AgentSkillSelectionLearningEvidence[] {
    return this.memory.rankSkills({
      queryTokens: this.tokenize(options.query),
      projectId: this.projectId,
      revisions: new Map(options.skills.map((skill) => [skill.name, skill.revision ?? skill.source.id])),
    });
  }

  async selectSkills(options: {
    query: string;
    skills: readonly RegisteredSkill[];
    signal?: AbortSignal;
  }): Promise<AgentSkillSelectionResult[]> {
    return new AgentSkillSelector(this.capabilitySearchIndex()).selectHybrid({
      ...options,
      learningEvidence: this.skillRoutingEvidence(options),
    });
  }

  close(): void {
    this.capabilitySessionCache.clear();
    this.memory.close();
  }

  refresh(): void {
    this.toolCatalog = undefined;
    this.index = undefined;
    this.searchIndexIdentity = undefined;
    this.capabilities = undefined;
    this.capabilityCatalogIdentity = undefined;
    this.capabilityRegistryRevision = undefined;
    this.capabilityToolCatalogIdentity = undefined;
    this.contractProjector.refresh();
    this.capabilitySessionCache.clear();
  }

  private async runToolSearch(
    args: Record<string, unknown>,
    context: {
      requestId?: string;
      sessionId?: string;
      visibleToolNames?: readonly string[];
      authorizedToolNames?: readonly string[];
      signal?: AbortSignal;
    },
  ): Promise<AgentToolProcessRunResult> {
    const parsed = createToolSearchArgumentsSchema(this.discoverySourceIds()).safeParse(args);
    if (!parsed.success) {
      return invalidToolMetaArgumentsResult(AgentToolMetaToolNames.Search, parsed.error.issues);
    }

    const result = await this.buildToolSearchResult(
      parsed.data,
      context.visibleToolNames ?? [],
      context.authorizedToolNames,
      context.sessionId,
      context.signal,
    );
    if (context.requestId) {
      this.usageMemory.rememberSearch(context.requestId, {
        query: parsed.data.query,
        queryTokens: this.tokenize(parsed.data.query),
        plannerTags: [],
        candidates: readToolNamesFromSearchResult(result),
        timestamp: Date.now(),
      });
    }

    return okToolMetaResult(result);
  }

  private async buildToolSearchResult(
    args: ToolSearchArguments,
    loadedToolNames: readonly string[],
    authorizedToolNames: readonly string[] | undefined,
    sessionId?: string,
    signal?: AbortSignal,
  ) {
    const results = await this.search({
      query: args.query,
      preferredSourceIds: args.preferredSources,
      includeLoaded: args.includeLoaded ?? false,
      loadedToolNames,
      authorizedToolNames,
      resultMode: AgentToolSearchResultModes.Catalog,
      signal,
    });

    const catalogRevision = this.catalogRevision();
    const visible = new Set(loadedToolNames);
    const withState = results.map((result) => {
      const tool = this.registry.getTool(result.toolName);
      const state = this.capabilitySessionCache.state({
        sessionId,
        toolName: result.toolName,
        catalogRevision,
        contractDigest: tool?.contract?.digest,
      });
      return {
        ...result,
        state: {
          exposure: visible.has(result.toolName) ? ("visible" as const) : ("discoverable" as const),
          ...state,
        },
      };
    });

    return createAgentToolDiscoveryResult(
      withToolSearchCatalogRevision(buildToolSearchResultProjection(args, withState), catalogRevision),
    );
  }

  private rememberSuccessfulCapabilities(
    sessionId: string | undefined,
    results: readonly ExecutedToolCallResult[],
  ): void {
    if (!sessionId) return;
    const catalogRevision = this.catalogRevision();
    for (const result of results) {
      if (isAgentToolMetaToolName(result.name)) continue;
      if (result.outcome.assessment.status !== AgentToolAssessmentStatuses.Success) continue;
      const tool = this.registry.getTool(result.name);
      if (!tool || tool.loading !== ToolLoadingModes.Dynamic) continue;
      this.capabilitySessionCache.rememberInvocation({
        sessionId,
        toolName: result.name,
        catalogRevision,
        contractDigest: tool.contract?.digest,
        arguments: result.arguments,
      });
    }
  }

  private catalogRevision(): string {
    return this.toolCatalogSnapshot().identity;
  }

  private availableToolCatalogIdentity(
    tools: readonly ReturnType<AgentExtensionRegistry["listTools"]>[number][],
  ): string {
    const runtimeTargets = this.options.availableExecutionTargets();
    return sha256HexOfCanonicalJson(
      tools
        .map((tool) => {
          const owner = resolveAgentToolOwner(tool);
          return {
            name: tool.name,
            owner: {
              name: owner.name,
              title: owner.title,
              description: owner.description,
              revision: owner.revision,
            },
            loading: tool.loading,
            sources: tool.sources,
            search: tool.search,
            contractDigest: tool.contract?.digest,
            executionTargets: resolveAvailableAgentToolExecutionTargets(tool, runtimeTargets),
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  private existingToolNames(toolNames: readonly string[]): string[] {
    const available = new Set(this.availableTools().map((tool) => tool.name));
    return toolNames.filter((name) => available.has(name));
  }

  private projectCurrentLoadedTools(
    current: LoadedToolsState | undefined,
    policy: AgentToolSearchCurrentSetPolicy,
  ): string[] {
    return CurrentSetProjectors[policy](current);
  }

  private mergeVisibleTools(toolNames: readonly string[]): string[] {
    const available = new Set(this.availableTools().map((tool) => tool.name));
    const unique = [...new Set(toolNames)].filter((name) => available.has(name));
    const required = this.bootstrapToolNames();
    return [...required, ...unique.filter((name) => !required.includes(name))];
  }

  private bootstrapToolNames(): string[] {
    return this.availableTools()
      .filter((tool) => tool.loading === ToolLoadingModes.Bootstrap)
      .map((tool) => tool.name);
  }

  private searchIndex(): AgentToolSearchIndex {
    const catalog = this.toolCatalogSnapshot();
    if (this.index && this.searchIndexIdentity === catalog.identity) return this.index;
    const capabilities = this.capabilitySearchIndex(catalog);
    this.index = new AgentToolSearchIndex({ listTools: () => [...catalog.tools] }, this.config, capabilities);
    this.searchIndexIdentity = catalog.identity;
    return this.index;
  }

  private capabilitySearchIndex(catalog = this.toolCatalogSnapshot()): AgentCapabilitySearchIndex {
    if (
      this.capabilities &&
      catalog.registryRevision !== undefined &&
      this.capabilityRegistryRevision === catalog.registryRevision &&
      this.capabilityToolCatalogIdentity === catalog.identity
    ) {
      return this.capabilities;
    }
    const documentBuilder = new AgentToolSearchDocumentBuilder();
    const toolDocuments = catalog.tools
      .filter((tool) => tool.loading === ToolLoadingModes.Dynamic && !isAgentToolMetaToolName(tool.name))
      .map((tool) => buildToolCapabilityDocument(tool, documentBuilder.build(tool)));
    const skillDocuments = this.registry.listSkills().map(buildSkillCapabilityDocument);
    const capabilityDocuments = [...toolDocuments, ...skillDocuments];
    const identity = this.capabilityCatalogRevision(capabilityDocuments);
    if (this.capabilities && this.capabilityCatalogIdentity === identity) return this.capabilities;
    const embedding =
      this.config.Embedding.Enabled && this.options.embedding
        ? {
            client: this.options.embedding.client,
            model: this.options.embedding.model,
            scoreThreshold: this.config.Embedding.ScoreThreshold,
          }
        : undefined;
    const rerank =
      this.config.Rerank.Enabled && this.options.rerank ? { client: this.options.rerank.client } : undefined;
    this.refreshEmbeddingCache(capabilityDocuments, embedding?.model);
    this.capabilities = new AgentCapabilitySearchIndex(capabilityDocuments, {
      tokenizer: new AgentToolSearchTokenizer(),
      embeddingCache: this.capabilityEmbeddingCache,
      embedding,
      rerank,
      onEmbeddingError: (error) =>
        this.logger?.warn("routing.embedding.failed", {
          message: errorMessage(error),
          catalogRevision: identity,
        }),
      onRerankError: (error) =>
        this.logger?.warn("routing.rerank.failed", {
          message: errorMessage(error),
          catalogRevision: identity,
        }),
    });
    this.capabilityCatalogIdentity = identity;
    this.capabilityRegistryRevision = catalog.registryRevision;
    this.capabilityToolCatalogIdentity = catalog.identity;
    this.index = undefined;
    return this.capabilities;
  }

  private availableTools(): ReturnType<AgentExtensionRegistry["listTools"]> {
    return [...this.toolCatalogSnapshot().tools];
  }

  private toolCatalogSnapshot(): AgentToolCatalogSnapshot {
    const registryRevision = readRegistryRevision(this.registry.revision);
    const runtimeTargets = this.options.availableExecutionTargets();
    const runtimeTargetsKey = [...new Set(runtimeTargets)].sort().join("\u0000");
    const cached = this.toolCatalog;
    if (
      registryRevision !== undefined &&
      cached?.registryRevision === registryRevision &&
      cached.runtimeTargetsKey === runtimeTargetsKey
    ) {
      return cached;
    }
    const tools = this.registry
      .listTools()
      .filter((tool) => resolveAvailableAgentToolExecutionTargets(tool, runtimeTargets).length > 0);
    const snapshot = {
      registryRevision,
      runtimeTargetsKey,
      tools,
      identity: this.availableToolCatalogIdentity(tools),
    } satisfies AgentToolCatalogSnapshot;
    if (registryRevision !== undefined) this.toolCatalog = snapshot;
    return snapshot;
  }

  private refreshEmbeddingCache(documents: readonly AgentCapabilitySearchDocument[], model: string | undefined): void {
    const capacity = Math.max(
      AgentCapabilityEmbeddingCachePolicy.MinimumEntries,
      documents.length * AgentCapabilityEmbeddingCachePolicy.CatalogGenerations,
    );
    this.capabilityEmbeddingCache.resize(capacity);
    const activeIdentities = new Set(
      model ? documents.map((document) => createAgentCapabilityEmbeddingIdentity(model, document)) : [],
    );
    this.capabilityEmbeddingCache.retain(activeIdentities);
  }

  private capabilityCatalogRevision(documents: readonly AgentCapabilitySearchDocument[]): string {
    return sha256HexOfCanonicalJson(
      documents
        .map((document) => ({
          id: document.id,
          kind: document.kind,
          revision: document.revision,
          semanticText: document.semanticText,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  private discoverySourceIds(): string[] {
    return this.registry.listDiscoverySources().map((source) => source.id);
  }

  private resolveAuthorizedTools(
    toolNames: readonly string[],
    authorizedToolNames: readonly string[] | undefined,
  ): { tools: ReturnType<AgentExtensionRegistry["listTools"]>; rejectedToolNames: string[] } {
    const authorized = authorizedToolNames ? new Set(authorizedToolNames) : undefined;
    const tools: ReturnType<AgentExtensionRegistry["listTools"]> = [];
    const rejectedToolNames: string[] = [];
    for (const toolName of uniqueToolNames(toolNames)) {
      const tool = this.registry.getTool(toolName);
      if (!tool || (authorized && !authorized.has(toolName))) {
        rejectedToolNames.push(toolName);
      } else {
        tools.push(tool);
      }
    }
    return { tools, rejectedToolNames };
  }
}

const AgentCapabilityEmbeddingCachePolicy = {
  MinimumEntries: 32,
  CatalogGenerations: 2,
} as const;

interface AgentToolCatalogSnapshot {
  readonly registryRevision: number | undefined;
  readonly runtimeTargetsKey: string;
  readonly tools: ReturnType<AgentExtensionRegistry["listTools"]>;
  readonly identity: string;
}

const CurrentSetProjectors = {
  [AgentToolSearchCurrentSetPolicies.Retain]: (current: LoadedToolsState | undefined) => [...(current ?? [])],
  [AgentToolSearchCurrentSetPolicies.Replace]: () => [],
} satisfies Record<AgentToolSearchCurrentSetPolicy, (current: LoadedToolsState | undefined) => string[]>;

function uniqueToolNames(toolNames: readonly string[]): string[] {
  return [...new Set(toolNames.map((toolName) => toolName.trim()).filter(Boolean))];
}

function readCatalogStatus(requestedRevision: string | undefined, catalogRevision: string): "current" | "stale" {
  return requestedRevision === undefined || requestedRevision === catalogRevision ? "current" : "stale";
}

function readRegistryRevision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function buildPlannedToolSearchQuery(options: {
  input: string;
  queries?: readonly string[];
  needs?: readonly AgentActionCapabilityNeed[];
}): string {
  const needTerms = (options.needs ?? []).flatMap((need) =>
    Object.values(need).flatMap((values) => (Array.isArray(values) ? values : [])),
  );
  return [...new Set([options.input, ...(options.queries ?? []), ...needTerms.map(String)])]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
}
