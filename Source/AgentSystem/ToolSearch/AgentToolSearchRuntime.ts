import type { AgentActionCapabilityNeed } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type {
  ResolvedAgentToolLearningConfig,
  ResolvedAgentToolSearchConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import type { AgentHostToolContext, AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentToolSearchMemory, type AgentToolUsePattern } from "./AgentToolSearchMemory.js";
import {
  AgentToolSearchCurrentSetPolicies,
  AgentToolMetaToolNames,
  type AgentToolSearchCurrentSetPolicy,
  type LoadedToolsState,
} from "./AgentToolSearchRuntimeTypes.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import {
  createAgentToolDiscoveryResult,
  createAgentToolDescriptionResult,
  AgentToolCatalogStatuses,
  invalidToolMetaArgumentsResult,
  okToolMetaResult,
  ToolDescribeArgumentsSchema,
  ToolLoadArgumentsSchema,
  ToolSearchArgumentsSchema,
  ToolUnloadArgumentsSchema,
  type ResolvedToolSearchArguments,
} from "./AgentToolMetaToolProtocol.js";
import { buildToolSearchResultProjection, readToolNamesFromSearchResult } from "./AgentToolSearchResultProjector.js";
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
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import {
  AgentToolSearchDiscoveryStatuses,
  AgentToolSearchEmptyReasons,
  type AgentToolSearchDiscovery,
  type AgentToolSearchResult,
} from "./AgentToolSearchTypes.js";
import {
  AgentToolCapabilityReuseModes,
  resolveAgentToolCapabilityReusePolicy,
} from "./AgentToolCapabilityReusePolicy.js";
import type { AgentCapabilityEmbeddingClient } from "./AgentCapabilitySearchIndex.js";
import type { AgentCapabilityEmbeddingCacheStore } from "./AgentCapabilityEmbeddingCache.js";
import { AgentSkillSelector, type AgentSkillSelectionResult } from "../Skills/AgentSkillSelector.js";
import type { AgentToolResourceDiscoveryReader } from "../ToolRuntime/AgentToolResourceDiscovery.js";
import { projectToolDescription } from "./AgentToolMetaToolProjector.js";
import {
  AgentToolCapabilitySessionCache,
  type AgentToolCapabilityCacheEntry,
} from "./AgentToolCapabilitySessionCache.js";
import { projectCurrentLoadedTools } from "./AgentToolSearchRuntimeCatalog.js";
import { AgentToolSearchCatalog } from "./AgentToolSearchCatalog.js";
import { AgentToolSearchCapabilityReuse } from "./AgentToolSearchCapabilityReuse.js";

export type { LoadedToolsState } from "./AgentToolSearchRuntimeTypes.js";
export { AgentToolMetaToolNames } from "./AgentToolSearchRuntimeTypes.js";

export interface AgentToolSearchRuntimeOptions {
  logger?: AgentLogger;
  memoryStore?: AgentToolSearchMemoryStore;
  embedding?: {
    client: AgentCapabilityEmbeddingClient;
    model: string;
  };
  embeddingCacheStore?: AgentCapabilityEmbeddingCacheStore;
  resourceDiscovery?: AgentToolResourceDiscoveryReader;
  availableExecutionTargets: () => readonly ToolExecutionTarget[];
}

export class AgentToolSearchRuntime {
  private readonly memory: AgentToolSearchMemory;
  private readonly usageMemory: AgentToolSearchUsageMemory;
  private readonly learningRuntime: AgentToolLearningRuntime;
  private readonly skillLearningRuntime: AgentSkillLearningRuntime;
  private readonly logger?: AgentLogger;
  private readonly catalog: AgentToolSearchCatalog;
  private readonly projectId: string;
  private readonly capabilitySessionCache = new AgentToolCapabilitySessionCache();
  private readonly capabilityReuse: AgentToolSearchCapabilityReuse;

  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly learningConfig: ResolvedAgentToolLearningConfig,
    workspaceRoot: string,
    private readonly model: ResolvedAgentModelProviderConfig,
    private readonly options: AgentToolSearchRuntimeOptions,
  ) {
    this.logger = options.logger;
    this.memory = new AgentToolSearchMemory(config, workspaceRoot, options.memoryStore);
    this.catalog = new AgentToolSearchCatalog({
      registry,
      config,
      model,
      logger: options.logger,
      embedding: options.embedding,
      embeddingCacheStore: options.embeddingCacheStore,
      resourceDiscovery: options.resourceDiscovery,
      availableExecutionTargets: options.availableExecutionTargets,
    });
    this.capabilityReuse = new AgentToolSearchCapabilityReuse({
      registry,
      catalog: this.catalog,
      cache: this.capabilitySessionCache,
    });
    this.projectId = createAgentToolSearchProjectId(workspaceRoot);
    this.learningRuntime = new AgentToolLearningRuntime(
      registry,
      this.model,
      learningConfig,
      this.memory,
      options.logger,
    );
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
        logicalCacheScope: context.logicalCacheScope,
        visibleToolNames: context.visibleToolNames,
        authorizedToolNames: context.authorizedToolNames,
        interaction: context.interaction,
        reusableCapabilities: context.reusableCapabilities,
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

      const catalogRevision = this.catalog.catalogRevision();
      const requested = this.catalog.resolveAuthorizedDynamicTools(
        parsed.data.tools,
        context.authorizedToolNames,
        context.interaction,
      );
      for (const tool of requested.tools) {
        context.toolExposure?.confirmContract(tool.name, tool.contract?.digest);
        this.capabilitySessionCache.rememberContract({
          sessionId: context.sessionId,
          logicalCacheScope: context.logicalCacheScope,
          toolName: tool.name,
          catalogRevision,
          contractDigest: tool.contract?.digest,
        });
      }
      return okToolMetaResult(
        createAgentToolDescriptionResult({
          tools: requested.tools.map((tool) => projectToolDescription(tool, this.options.availableExecutionTargets())),
          ...(requested.directToolNames.length > 0 ? { direct: requested.directToolNames } : {}),
          ...(requested.rejectedToolNames.length > 0 ? { rejected: requested.rejectedToolNames } : {}),
        }),
      );
    };
  }

  createLoadHostHandler(): AgentHostToolHandler {
    return async (args, context) => {
      throwIfAborted(context.signal);
      const parsed = ToolLoadArgumentsSchema.safeParse(args);
      if (!parsed.success) return invalidToolMetaArgumentsResult(AgentToolMetaToolNames.Load, parsed.error.issues);

      const requested = this.catalog.resolveAuthorizedDynamicTools(
        parsed.data.tools,
        context.authorizedToolNames,
        context.interaction,
      );
      // Resolve and read the revision in one synchronous mutation boundary.
      // A hot reload between an early revision check and resolution must not
      // let an old discovery card expose the replacement catalog.
      const catalogRevision = this.catalog.catalogRevision();
      if (parsed.data.catalogRevision && parsed.data.catalogRevision !== catalogRevision) {
        return this.catalogMutationStaleResult(
          parsed.data.tools,
          parsed.data.catalogRevision,
          catalogRevision,
          context,
        );
      }
      const delta = context.toolExposure
        ? context.toolExposure.expose(requested.tools.map((tool) => tool.name))
        : undefined;
      // BAML receives a loaded tool's full provider schema. Record that same
      // contract evidence so an execution bridge cannot distinguish a loaded
      // schema from a separately described one.
      for (const tool of requested.tools) context.toolExposure?.confirmContract(tool.name, tool.contract?.digest);
      return okToolMetaResult(
        createAgentToolDiscoveryResult({
          catalogStatus: AgentToolCatalogStatuses.Current,
          catalogRevision,
          generation: delta?.snapshot.generation ?? context.toolExposure?.snapshot().generation ?? 0,
          added: { item: delta?.addedToolNames ?? [] },
          loaded: { item: delta?.snapshot.exposedToolNames ?? context.visibleToolNames ?? [] },
          rejected: {
            item: uniqueToolNames([
              ...requested.rejectedToolNames,
              ...requested.directToolNames,
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

      const requested = this.catalog.resolveAuthorizedDynamicTools(
        parsed.data.tools,
        context.authorizedToolNames,
        context.interaction,
      );
      const catalogRevision = this.catalog.catalogRevision();
      if (parsed.data.catalogRevision && parsed.data.catalogRevision !== catalogRevision) {
        return this.catalogMutationStaleResult(
          parsed.data.tools,
          parsed.data.catalogRevision,
          catalogRevision,
          context,
        );
      }
      const delta = context.toolExposure?.revoke(
        requested.tools.map((tool) => tool.name),
        {
          protectedToolNames: this.catalog.directToolNames(context.interaction),
        },
      );
      return okToolMetaResult(
        createAgentToolDiscoveryResult({
          catalogStatus: AgentToolCatalogStatuses.Current,
          catalogRevision,
          generation: delta?.snapshot.generation ?? context.toolExposure?.snapshot().generation ?? 0,
          removed: { item: delta?.removedToolNames ?? [] },
          protected: { item: uniqueToolNames([...(delta?.protectedToolNames ?? []), ...requested.directToolNames]) },
          loaded: { item: delta?.snapshot.exposedToolNames ?? context.visibleToolNames ?? [] },
          rejected: {
            item: uniqueToolNames([
              ...requested.rejectedToolNames,
              ...requested.directToolNames,
              ...(delta?.rejectedToolNames ?? requested.tools.map((tool) => tool.name)),
            ]),
          },
        }),
      );
    };
  }

  private catalogMutationStaleResult(
    tools: readonly string[],
    requestedCatalogRevision: string,
    catalogRevision: string,
    context: AgentHostToolContext,
  ): AgentToolProcessRunResult {
    return okToolMetaResult(
      createAgentToolDiscoveryResult({
        catalogStatus: AgentToolCatalogStatuses.Stale,
        catalogRevision,
        reason: AgentToolSearchEmptyReasons.CatalogChanged,
        requestedCatalogRevision,
        generation: context.toolExposure?.snapshot().generation ?? 0,
        requested: { item: tools },
        loaded: { item: context.toolExposure?.snapshot().exposedToolNames ?? context.visibleToolNames ?? [] },
      }),
    );
  }

  async resolveInitialLoadedTools(
    _input: string,
    warmToolNames: LoadedToolsState = [],
    interaction?: AgentInteractionContext,
  ): Promise<LoadedToolsState> {
    return this.catalog.mergeVisibleTools(
      [...this.catalog.directToolNames(interaction), ...this.catalog.existingToolNames(warmToolNames, interaction)],
      interaction,
    );
  }

  async resolvePlannedLoadedTools(options: {
    input: string;
    currentLoadedTools?: LoadedToolsState;
    currentSetPolicy?: AgentToolSearchCurrentSetPolicy;
    preferredTools?: readonly string[];
    queries?: readonly string[];
    needs?: readonly AgentActionCapabilityNeed[];
    discover?: boolean;
    interaction?: AgentInteractionContext;
    signal?: AbortSignal;
  }): Promise<LoadedToolsState> {
    const direct = this.catalog.directToolNames(options.interaction);
    const current = this.catalog.existingToolNames(
      projectCurrentLoadedTools(
        options.currentLoadedTools,
        options.currentSetPolicy ?? AgentToolSearchCurrentSetPolicies.Retain,
      ),
      options.interaction,
    );
    const preferred = options.discover
      ? this.catalog.existingToolNames(options.preferredTools ?? [], options.interaction)
      : [];
    const planned = [...current, ...preferred];
    if (options.discover) {
      const query = buildPlannedToolSearchQuery(options);
      if (query.length > 0) {
        const results = await this.search({
          query,
          loadedToolNames: planned,
          interaction: options.interaction,
          signal: options.signal,
        });
        planned.push(...results.map((result) => result.toolName));
      }
    }
    return this.catalog.mergeVisibleTools([...direct, ...planned], options.interaction);
  }

  finishRequest(requestId: string): void {
    this.usageMemory.finishRequest(requestId);
  }

  afterToolResults(options: {
    requestId: string;
    userInput: string;
    sessionId?: string;
    logicalCacheScope?: string;
    interaction?: AgentInteractionContext;
    loadedTools: LoadedToolsState;
    execution: { value: ExecutedToolCallResult[] };
    activeSkills?: readonly AgentActivatedSkill[];
  }): LoadedToolsState {
    const loadedTools = this.catalog.mergeVisibleTools(options.loadedTools, options.interaction);
    this.capabilityReuse.rememberSuccessfulCapabilities(
      options.sessionId,
      options.userInput,
      options.execution.value,
      options.logicalCacheScope,
    );
    try {
      this.usageMemory.recordToolUsage({
        requestId: options.requestId,
        userInput: options.userInput,
        sessionId: options.sessionId,
        logicalCacheScope: options.logicalCacheScope,
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
    interaction?: AgentInteractionContext;
    plannerTags?: readonly string[];
    loadedToolNames?: readonly string[];
    authorizedToolNames?: readonly string[];
    signal?: AbortSignal;
  }): Promise<AgentToolSearchResult[]> {
    return [...(await this.discover(options)).match];
  }

  /**
   * Returns the host-side discovery tiers before session-state projection.
   * This is intentionally read-only: model-facing ToolSearch still exposes
   * only the fixed `{ query }` invocation contract.
   */
  async discover(options: {
    query: string;
    interaction?: AgentInteractionContext;
    plannerTags?: readonly string[];
    loadedToolNames?: readonly string[];
    authorizedToolNames?: readonly string[];
    signal?: AbortSignal;
  }): Promise<AgentToolSearchDiscovery> {
    const { signal, ...searchOptions } = options;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      throwIfAborted(signal);
      const snapshot = this.catalog.searchSnapshot();
      const tokens = snapshot.index.tokenize(options.query);
      const memoryEvidence = this.memory.rank(tokens, this.projectId);
      const discovery = await snapshot.index.discoverHybrid(
        {
          ...searchOptions,
          memoryEvidence,
        },
        signal,
      );
      if (this.catalog.isSearchSnapshotCurrent(snapshot)) {
        return { ...discovery, catalogRevision: snapshot.revision };
      }
    }
    return {
      match: [],
      maybe: [],
      omitted: [],
      status: AgentToolSearchDiscoveryStatuses.Stale,
      reason: AgentToolSearchEmptyReasons.CatalogChanged,
      catalogRevision: this.catalog.catalogRevision(),
    };
  }

  /** Returns the bounded capability records for diagnostics and prompt
   * compilers that want to reuse a confirmed invocation without another
   * ToolSearch round trip. */
  capabilitySnapshot(sessionId?: string): readonly AgentToolCapabilityCacheEntry[] {
    return this.capabilitySessionCache.snapshot(sessionId);
  }

  getReusableCapability(options: {
    sessionId?: string;
    logicalCacheScope?: string;
    toolName: string;
    catalogRevision?: string;
    interaction?: AgentInteractionContext;
  }): AgentToolCapabilityCacheEntry | undefined {
    return this.capabilityReuse.getReusableCapability(options);
  }

  /**
   * Cross-request evidence for the execution bridge: unlike
   * getReusableCapability, this does not require an automatic reuse policy,
   * because a confirmed contract may legitimately be reused through a
   * proposal. The contract digest is still re-validated against the current
   * catalog, so stale or changed contracts never pass.
   */
  getReusableEvidence(options: {
    sessionId?: string;
    logicalCacheScope?: string;
    toolName: string;
  }): AgentToolCapabilityCacheEntry | undefined {
    return this.capabilityReuse.getReusableEvidence(options);
  }

  /**
   * Returns recently confirmed dynamic capabilities after re-validating them
   * against the current catalog and contract digest. This is intentionally a
   * local lookup: the model can reuse known arguments without paying for a
   * duplicate ToolSearch request, while stale records disappear naturally.
   */
  reusableCapabilities(options: {
    sessionId?: string;
    logicalCacheScope?: string;
    query?: string;
    authorizedToolNames?: readonly string[];
    interaction?: AgentInteractionContext;
  }): readonly AgentToolCapabilityCacheEntry[] {
    return this.capabilityReuse.reusableCapabilities(options);
  }

  tokenize(text: string): string[] {
    return this.catalog.searchIndex().tokenize(text);
  }

  toolUsePatterns(options: { input: string; allowedTools: readonly string[] }): AgentToolUsePattern[] {
    if (!this.learningConfig.Enabled) {
      return [];
    }

    return this.memory.patterns({
      queryTokens: this.catalog.searchIndex().tokenize(options.input),
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
    return new AgentSkillSelector(this.catalog.capabilityIndex()).selectHybrid({
      ...options,
      learningEvidence: this.skillRoutingEvidence(options),
    });
  }

  /** Start or join the catalog embedding preparation shared by ToolSearch. */
  prewarm(signal?: AbortSignal): Promise<void> {
    return this.catalog.prewarm(signal);
  }

  async close(): Promise<void> {
    this.capabilitySessionCache.clear();
    this.memory.close();
    await this.catalog.close();
  }

  refresh(): void {
    this.catalog.refresh();
    // Keep session evidence across registry/index rebuilds. Lookups still
    // revalidate catalog revision and contract digest, so changed capabilities
    // become unavailable without an unrelated cache cold start.
  }

  private async runToolSearch(
    args: Record<string, unknown>,
    context: {
      requestId?: string;
      sessionId?: string;
      logicalCacheScope?: string;
      interaction?: AgentInteractionContext;
      visibleToolNames?: readonly string[];
      authorizedToolNames?: readonly string[];
      reusableCapabilities?: readonly AgentToolCapabilityCacheEntry[];
      signal?: AbortSignal;
    },
  ): Promise<AgentToolProcessRunResult> {
    const parsed = ToolSearchArgumentsSchema.safeParse(args);
    if (!parsed.success) {
      return invalidToolMetaArgumentsResult(AgentToolMetaToolNames.Search, parsed.error.issues);
    }

    const resolved = await this.buildToolSearchResult(
      parsed.data,
      context.visibleToolNames ?? [],
      context.authorizedToolNames,
      context.sessionId,
      context.logicalCacheScope,
      context.interaction,
      context.reusableCapabilities,
      context.signal,
    );
    if (!resolved.searchPerformed) {
      this.logger?.info("routing.tool_search.reused", {
        requestId: context.requestId,
        sessionId: context.sessionId,
        logicalCacheScope: context.logicalCacheScope,
        query: parsed.data.query,
        reuseHit: true,
        searchPerformed: false,
        tools: resolved.reusedToolNames,
      });
    }
    if (context.requestId && resolved.searchPerformed) {
      this.usageMemory.rememberSearch(context.requestId, {
        query: parsed.data.query,
        queryTokens: this.tokenize(parsed.data.query),
        plannerTags: [],
        candidates: readToolNamesFromSearchResult(resolved.result),
        timestamp: Date.now(),
      });
    }

    return okToolMetaResult(resolved.result);
  }

  private async buildToolSearchResult(
    args: ResolvedToolSearchArguments,
    loadedToolNames: readonly string[],
    authorizedToolNames: readonly string[] | undefined,
    sessionId?: string,
    logicalCacheScope?: string,
    interaction?: AgentInteractionContext,
    reusableCapabilities?: readonly AgentToolCapabilityCacheEntry[],
    signal?: AbortSignal,
  ): Promise<{
    result: unknown;
    searchPerformed: boolean;
    reusedToolNames: readonly string[];
  }> {
    const reusable = this.capabilityReuse.matchReusableCapabilities({
      sessionId,
      logicalCacheScope,
      query: args.query,
      authorizedToolNames,
      interaction,
      candidates: reusableCapabilities,
    });
    let discovery =
      reusable.length > 0
        ? {
            match: reusable.map((entry) => this.capabilityReuse.projectReusableSearchResult(entry, loadedToolNames)),
            maybe: [],
            omitted: [],
            catalogRevision: this.catalog.catalogRevision(),
          }
        : await this.discover({
            query: args.query,
            loadedToolNames,
            authorizedToolNames,
            interaction,
            signal,
          });

    let searchPerformed = reusable.length === 0;
    let reusedToolNames: readonly string[] = reusable.map((entry) => entry.toolName);
    if (discovery.catalogRevision && discovery.catalogRevision !== this.catalog.catalogRevision()) {
      // A refresh may complete between the discovery promise and this
      // projection continuation. Re-run against the current immutable
      // snapshot instead of attaching current exposure state to old results.
      discovery = await this.discover({
        query: args.query,
        loadedToolNames,
        authorizedToolNames,
        interaction,
        signal,
      });
      searchPerformed = true;
      reusedToolNames = [];
    }

    const catalogRevision = discovery.catalogRevision ?? this.catalog.catalogRevision();
    const visible = new Set(loadedToolNames);
    const withState = (results: readonly AgentToolSearchResult[]) =>
      results.map((result) => {
        const tool = this.registry.getTool(result.toolName);
        const state = this.capabilitySessionCache.state({
          sessionId,
          logicalCacheScope,
          toolName: result.toolName,
          catalogRevision,
          contractDigest: tool?.contract?.digest,
        });
        const reusePolicy = tool ? resolveAgentToolCapabilityReusePolicy(tool) : undefined;
        const automaticReuse = reusePolicy?.mode === AgentToolCapabilityReuseModes.Automatic;
        return {
          ...result,
          state: {
            exposure: visible.has(result.toolName) ? ("visible" as const) : ("discoverable" as const),
            contract: state.contract,
            reuse: automaticReuse ? state.reuse : ("none" as const),
            ...(automaticReuse && state.reusableArguments ? { reusableArguments: state.reusableArguments } : {}),
          },
        };
      });

    const withStateDiscovery = {
      match: withState(discovery.match),
      maybe: withState(discovery.maybe),
      omitted: withState(discovery.omitted),
      ...(discovery.status ? { status: discovery.status } : {}),
      ...(discovery.reason ? { reason: discovery.reason } : {}),
      ...(discovery.diagnostics ? { diagnostics: discovery.diagnostics } : {}),
      ...(discovery.catalogRevision ? { catalogRevision: discovery.catalogRevision } : {}),
    } satisfies AgentToolSearchDiscovery;

    return {
      result: createAgentToolDiscoveryResult(
        buildToolSearchResultProjection(withStateDiscovery, {
          model: this.model.Model,
          tokenBudget: this.config.Disclosure.TokenBudget,
        }),
      ),
      searchPerformed,
      reusedToolNames,
    };
  }
}

function uniqueToolNames(toolNames: readonly string[]): string[] {
  return [...new Set(toolNames.map((toolName) => toolName.trim()).filter(Boolean))];
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
