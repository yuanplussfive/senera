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
  type AgentToolSearchCurrentSetPolicy,
  type LoadedToolsState,
} from "./AgentToolSearchRuntimeTypes.js";
import { ToolLoadingModes } from "../Types/AgentToolContractTypes.js";
import {
  createAgentToolDiscoveryResult,
  createToolSearchArgumentsSchema,
  invalidToolSearchArgumentsResult,
  okToolSearchResult,
  type ToolSearchArguments,
} from "./AgentToolSearchToolProtocol.js";
import { buildToolSearchResultProjection, readToolNamesFromSearchResult } from "./AgentToolSearchResultProjector.js";
import { buildPlannedToolSearchQueries } from "./AgentToolSearchQueryPlanner.js";
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
import { AgentToolDisclosurePlanner } from "./AgentToolDisclosurePlanner.js";
import type { AgentToolTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import { AgentToolSearchContractProjector } from "./AgentToolSearchContractProjector.js";
import { AgentLruCache } from "../Core/AgentLruCache.js";

export type { LoadedToolsState } from "./AgentToolSearchRuntimeTypes.js";
export { ToolSearchToolName } from "./AgentToolSearchRuntimeTypes.js";

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
}

export class AgentToolSearchRuntime {
  private readonly memory: AgentToolSearchMemory;
  private readonly usageMemory: AgentToolSearchUsageMemory;
  private readonly learningRuntime: AgentToolLearningRuntime;
  private readonly skillLearningRuntime: AgentSkillLearningRuntime;
  private readonly disclosure: AgentToolDisclosurePlanner;
  private readonly logger?: AgentLogger;
  private index?: AgentToolSearchIndex;
  private capabilities?: AgentCapabilitySearchIndex;
  private capabilityCatalogIdentity?: string;
  private readonly capabilityEmbeddingCache = new AgentLruCache<string, readonly number[]>(
    AgentCapabilityEmbeddingCachePolicy.MinimumEntries,
  );
  private readonly projectId: string;
  private readonly contractProjector: AgentToolSearchContractProjector;

  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly learningConfig: ResolvedAgentToolLearningConfig,
    private readonly workspaceRoot: string,
    model: ResolvedAgentModelProviderConfig,
    private readonly options: AgentToolSearchRuntimeOptions = {},
  ) {
    this.logger = options.logger;
    this.contractProjector = new AgentToolSearchContractProjector(registry);
    this.disclosure = new AgentToolDisclosurePlanner(registry, config, model);
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

  createHostHandler(): AgentHostToolHandler {
    return async (args, context) => {
      throwIfAborted(context.signal);
      const run = await this.runToolSearch(args, {
        requestId: context.requestId,
        visibleToolNames: context.visibleToolNames,
        signal: context.signal,
        tokenBudget: context.tokenBudget,
      });
      if (run.response.ok) {
        context.toolExposure?.expose(readToolNamesFromSearchResult(run.response.result));
      }
      return run;
    };
  }

  createHostContractProjection() {
    return this.contractProjector.createProjection();
  }

  async resolveInitialLoadedTools(input: string, warmToolNames: LoadedToolsState = []): Promise<LoadedToolsState> {
    const bootstrap = this.bootstrapToolNames();
    const results = await this.search({
      query: input,
      includeLoaded: false,
      loadedToolNames: bootstrap,
    });
    const discovered = this.disclosure.callableToolNames(this.disclosure.plan(input, results));
    const contextual = discovered.length > 0 ? discovered : this.existingToolNames(warmToolNames);

    return this.mergeVisibleTools([...bootstrap, ...contextual]);
  }

  async resolvePlannedLoadedTools(options: {
    input: string;
    currentLoadedTools?: LoadedToolsState;
    currentSetPolicy?: AgentToolSearchCurrentSetPolicy;
    preferredTools?: readonly string[];
    queries?: readonly string[];
    needs?: readonly AgentActionCapabilityNeed[];
    discover?: boolean;
  }): Promise<LoadedToolsState> {
    const bootstrap = this.bootstrapToolNames();
    const current = this.projectCurrentLoadedTools(
      options.currentLoadedTools,
      options.currentSetPolicy ?? AgentToolSearchCurrentSetPolicies.Retain,
    );
    const preferred = this.existingToolNames(options.preferredTools ?? []);
    const plannedQueries = buildPlannedToolSearchQueries(options, (text) => this.tokenize(text));
    const searches = await Promise.all(
      plannedQueries.map(async (query) => {
        const results = await this.search({
          query: query.text,
          plannerTags: query.facets,
          includeLoaded: false,
          loadedToolNames: [...bootstrap, ...preferred],
        });
        return this.disclosure.callableToolNames(this.disclosure.plan(query.text, results));
      }),
    );
    const discovered = searches.flat();

    return this.mergeVisibleTools([...bootstrap, ...current, ...preferred, ...discovered]);
  }

  rememberAutoSearch(requestId: string, query: string, loadedToolNames: LoadedToolsState): void {
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
    userInput: string;
    sessionId?: string;
    loadedTools: LoadedToolsState;
    execution: { value: ExecutedToolCallResult[] };
    activeSkills?: readonly AgentActivatedSkill[];
  }): LoadedToolsState {
    const loadedTools = this.mergeVisibleTools([
      ...options.loadedTools,
      ...options.execution.value.map((result) => result.name),
      ...this.usageMemory.extractSearchResultToolNames(options.execution.value),
    ]);
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
    signal?: AbortSignal;
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
    this.memory.close();
  }

  refresh(): void {
    this.index = undefined;
    this.capabilities = undefined;
    this.capabilityCatalogIdentity = undefined;
    this.contractProjector.refresh();
  }

  private async runToolSearch(
    args: Record<string, unknown>,
    context: {
      requestId?: string;
      visibleToolNames?: readonly string[];
      signal?: AbortSignal;
      tokenBudget?: AgentToolTokenBudget;
    },
  ): Promise<AgentToolProcessRunResult> {
    const parsed = createToolSearchArgumentsSchema(this.discoverySourceIds()).safeParse(args);
    if (!parsed.success) {
      return invalidToolSearchArgumentsResult(parsed.error.issues);
    }

    const result = await this.buildToolSearchResult(
      parsed.data,
      context.visibleToolNames ?? [],
      context.signal,
      context.tokenBudget,
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

    return okToolSearchResult(result);
  }

  private async buildToolSearchResult(
    args: ToolSearchArguments,
    loadedToolNames: readonly string[],
    signal?: AbortSignal,
    tokenBudget?: AgentToolTokenBudget,
  ) {
    const results = await this.search({
      query: args.query,
      preferredSourceIds: args.preferredSources,
      includeLoaded: args.includeLoaded ?? false,
      loadedToolNames,
      signal,
    });

    return createAgentToolDiscoveryResult({
      catalogRevision: this.catalogRevision(),
      ...buildToolSearchResultProjection(args, this.disclosure.plan(args.query, results, tokenBudget)),
    });
  }

  private catalogRevision(): string {
    return sha256HexOfCanonicalJson(
      this.registry
        .listTools()
        .map((tool) => {
          const owner = resolveAgentToolOwner(tool);
          return {
            name: tool.name,
            owner: owner.name,
            ownerRevision: owner.revision,
            contractDigest: tool.contract?.digest,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  private existingToolNames(toolNames: readonly string[]): string[] {
    return toolNames.filter((name) => Boolean(this.registry.getTool(name)));
  }

  private projectCurrentLoadedTools(
    current: LoadedToolsState | undefined,
    policy: AgentToolSearchCurrentSetPolicy,
  ): string[] {
    return CurrentSetProjectors[policy](current);
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
    const capabilities = this.capabilitySearchIndex();
    this.index ??= new AgentToolSearchIndex(this.registry, this.config, capabilities);
    return this.index;
  }

  private capabilitySearchIndex(): AgentCapabilitySearchIndex {
    const documentBuilder = new AgentToolSearchDocumentBuilder();
    const toolDocuments = this.registry
      .listTools()
      .filter((tool) => resolveAgentToolOwner(tool).kind !== "system")
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
    this.index = undefined;
    return this.capabilities;
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
}

const AgentCapabilityEmbeddingCachePolicy = {
  MinimumEntries: 32,
  CatalogGenerations: 2,
} as const;

const CurrentSetProjectors = {
  [AgentToolSearchCurrentSetPolicies.Retain]: (current: LoadedToolsState | undefined) => [...(current ?? [])],
  [AgentToolSearchCurrentSetPolicies.Replace]: () => [],
} satisfies Record<AgentToolSearchCurrentSetPolicy, (current: LoadedToolsState | undefined) => string[]>;
