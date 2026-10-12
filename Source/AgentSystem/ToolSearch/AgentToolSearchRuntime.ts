import type { AgentActionCapabilityNeed } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { ResolvedAgentToolSearchConfig, ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import type { AgentHostToolContext, AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentToolSearchMemory } from "./AgentToolSearchMemory.js";
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
import { AgentToolSearchUsageMemory, type AgentToolSearchObservation } from "./AgentToolSearchUsageMemory.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import {
  AgentToolSearchMemOSScenarioSource,
  type AgentToolSearchScenarioSource,
} from "./AgentToolSearchScenarioSource.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import type { AgentSkillSelectionScenarioEvidence } from "../Skills/AgentSkillSelector.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { createAgentToolSearchProjectId } from "./AgentToolSearchProject.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import {
  AgentToolSearchDiscoveryStatuses,
  AgentToolSearchEmptyReasons,
  type AgentToolSearchDiscovery,
  type AgentToolSearchResult,
  type AgentToolSearchDiagnostic,
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
import type { AgentStateCardRuntime } from "../StateCard/AgentStateCardRuntime.js";
import type { AgentStateCard } from "../StateCard/AgentStateCardTypes.js";
import type { AgentContinuityMemOSRuntime } from "../Continuity/AgentContinuityMemOSRuntime.js";
import type { AgentMcpServiceDiscoveryEntry } from "../McpPackages/AgentMcpPackageTypes.js";
import { resolveAgentToolGrantNames, type AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import { isAgentToolExecutable } from "../ToolRuntime/AgentToolAvailability.js";
import { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";

export type { LoadedToolsState } from "./AgentToolSearchRuntimeTypes.js";
export { AgentToolMetaToolNames } from "./AgentToolSearchRuntimeTypes.js";

interface PreparedMcpDiscovery {
  readonly ids: readonly string[];
  readonly diagnostics: readonly AgentToolSearchDiagnostic[];
}

export interface AgentToolSearchRuntimeOptions {
  mcpServices?: () => readonly AgentMcpServiceDiscoveryEntry[];
  logger?: AgentLogger;
  scenarioSource?: AgentToolSearchScenarioSource;
  embedding?: {
    client: AgentCapabilityEmbeddingClient;
    model: string;
  };
  /** Releases an embedding client created by this runtime only. Workspace-shared clients omit it. */
  closeEmbedding?: () => void | Promise<void>;
  embeddingCacheStore?: AgentCapabilityEmbeddingCacheStore;
  resourceDiscovery?: AgentToolResourceDiscoveryReader;
  availableExecutionTargets: () => readonly ToolExecutionTarget[];
  /** Optional state-card runtime used for synchronous turn preparation. */
  stateCardRuntime?: AgentStateCardRuntime;
  /** Shared durable MemOS authority for routing episodes and skill evidence. */
  memos?: AgentContinuityMemOSRuntime;
  /** Gives host-owned deferred catalogs a chance to publish matching tools. */
  beforeSearch?: (query: string, signal?: AbortSignal, serviceIds?: readonly string[]) => void | Promise<void>;
}

export class AgentToolSearchRuntime {
  private readonly memory: AgentToolSearchMemory;
  private readonly usageMemory: AgentToolSearchUsageMemory;
  private readonly logger?: AgentLogger;
  private readonly catalog: AgentToolSearchCatalog;
  private readonly projectId: string;
  private readonly capabilitySessionCache = new AgentToolCapabilitySessionCache();
  private readonly capabilityReuse: AgentToolSearchCapabilityReuse;

  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly config: ResolvedAgentToolSearchConfig,
    workspaceRoot: string,
    private readonly model: ResolvedAgentModelProviderConfig,
    private readonly options: AgentToolSearchRuntimeOptions,
  ) {
    if (!options.memos && !options.scenarioSource) {
      throw new Error("MemOS runtime is required for durable ToolSearch scenario memory.");
    }
    this.logger = options.logger;
    this.memory = new AgentToolSearchMemory(
      config,
      options.scenarioSource ?? new AgentToolSearchMemOSScenarioSource(options.memos!),
    );
    this.catalog = new AgentToolSearchCatalog({
      registry,
      config,
      model,
      logger: options.logger,
      embedding: options.embedding,
      embeddingCacheStore: options.embeddingCacheStore,
      resourceDiscovery: options.resourceDiscovery,
      availableExecutionTargets: options.availableExecutionTargets,
      mcpServices: options.mcpServices,
    });
    this.capabilityReuse = new AgentToolSearchCapabilityReuse({
      registry,
      catalog: this.catalog,
      cache: this.capabilitySessionCache,
    });
    this.projectId = createAgentToolSearchProjectId(workspaceRoot);
    this.usageMemory = new AgentToolSearchUsageMemory(this.memory, this.projectId, options.stateCardRuntime);
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
        toolAccessGrant: context.toolAccessGrant,
        interaction: context.interaction,
        reusableCapabilities: context.reusableCapabilities,
        signal: context.signal,
      });
      return run;
    };
  }

  createToolExposure(grant: AgentToolAccessGrant): AgentToolExposureState {
    return AgentToolExposureState.forRegistry(grant, this.registry);
  }

  createDescribeHostHandler(): AgentHostToolHandler {
    return async (args, context) => {
      throwIfAborted(context.signal);
      const parsed = ToolDescribeArgumentsSchema.safeParse(args);
      if (!parsed.success) return invalidToolMetaArgumentsResult(AgentToolMetaToolNames.Describe, parsed.error.issues);

      await this.prepareRequestedTools(parsed.data.tools, context);

      const catalogRevision = this.catalog.catalogRevision();
      const requested = this.catalog.resolveAuthorizedDynamicTools(
        parsed.data.tools,
        this.authorizedNames(context.toolAccessGrant, context.authorizedToolNames),
        context.interaction,
      );
      for (const tool of requested.tools) {
        if (!isAgentToolExecutable(tool)) continue;
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
          availability: Object.fromEntries(
            requested.tools
              .filter((tool) => !isAgentToolExecutable(tool))
              .map((tool) => [tool.name, tool.availability]),
          ),
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

      await this.prepareRequestedTools(parsed.data.tools, context);

      const requested = this.catalog.resolveAuthorizedDynamicTools(
        parsed.data.tools,
        this.authorizedNames(context.toolAccessGrant, context.authorizedToolNames),
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
        ? context.toolExposure.expose(requested.tools.filter(isAgentToolExecutable).map((tool) => tool.name))
        : undefined;
      // BAML receives a loaded tool's full provider schema. Record that same
      // contract evidence so an execution bridge cannot distinguish a loaded
      // schema from a separately described one.
      for (const tool of requested.tools.filter(isAgentToolExecutable))
        context.toolExposure?.confirmContract(tool.name, tool.contract?.digest);
      return okToolMetaResult(
        createAgentToolDiscoveryResult({
          catalogStatus: AgentToolCatalogStatuses.Current,
          catalogRevision,
          generation: delta?.snapshot.generation ?? context.toolExposure?.snapshot().generation ?? 0,
          added: { item: delta?.addedToolNames ?? [] },
          availability: Object.fromEntries(
            requested.tools
              .filter((tool) => !isAgentToolExecutable(tool))
              .map((tool) => [tool.name, tool.availability]),
          ),
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
        this.authorizedNames(context.toolAccessGrant, context.authorizedToolNames),
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
    requiredToolNames?: readonly string[];
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
    const required = this.catalog.existingToolNames(options.requiredToolNames ?? [], options.interaction);
    const planned = [...current, ...required, ...preferred];
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

  /** Resolves the StateCard before prompt rendering so liveContext sees this turn's card. */
  resolveStateCard(request: {
    requestId?: string;
    currentRequest: string;
    turnIndex?: number;
    sessionId?: string;
    logicalCacheScope?: string;
    activeSkills?: readonly AgentActivatedSkill[];
    signal?: AbortSignal;
  }): Promise<AgentStateCard> {
    if (!this.options.stateCardRuntime) {
      throw new Error("StateCard runtime is required for turn preparation.");
    }
    return this.options.stateCardRuntime.resolve({
      requestId: request.requestId,
      currentRequest: request.currentRequest,
      turnIndex: request.turnIndex,
      sessionId: request.sessionId,
      logicalCacheScope: request.logicalCacheScope,
      ...(request.activeSkills ? { activeSkills: request.activeSkills.map((skill) => skill.name) } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  }

  recordCompletedTurnScenario(observation: AgentToolSearchObservation): void {
    this.usageMemory.recordCompletedTurn(observation);
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
    stateCard?: AgentStateCard;
  }): { loadedTools: LoadedToolsState; observation: AgentToolSearchObservation } {
    const loadedTools = this.catalog.mergeVisibleTools(options.loadedTools, options.interaction);
    this.capabilityReuse.rememberSuccessfulCapabilities(
      options.sessionId,
      options.userInput,
      options.execution.value,
      options.logicalCacheScope,
    );
    try {
      const observation = this.usageMemory.observeToolUsage({
        requestId: options.requestId,
        userInput: options.userInput,
        sessionId: options.sessionId,
        logicalCacheScope: options.logicalCacheScope,
        results: options.execution.value,
        activeSkills: options.activeSkills,
        stateCard: options.stateCard,
      });
      return { loadedTools, observation };
    } catch (error) {
      this.usageMemory.finishRequest(options.requestId);
      this.logger?.warn("routing.scenario.observation_failed", {
        requestId: options.requestId,
        message: errorMessage(error),
      });
      throw error;
    }
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
    toolAccessGrant?: AgentToolAccessGrant;
    signal?: AbortSignal;
  }): Promise<AgentToolSearchDiscovery> {
    return this.discoverInternal(options, true);
  }

  private async discoverInternal(
    options: {
      query: string;
      interaction?: AgentInteractionContext;
      plannerTags?: readonly string[];
      loadedToolNames?: readonly string[];
      authorizedToolNames?: readonly string[];
      toolAccessGrant?: AgentToolAccessGrant;
      signal?: AbortSignal;
    },
    prepareDeferredDiscovery: boolean,
    preparedSelection?: PreparedMcpDiscovery,
  ): Promise<AgentToolSearchDiscovery> {
    const { signal, toolAccessGrant, ...searchOptions } = options;
    const selection = prepareDeferredDiscovery
      ? await this.prepareCatalog(options.query, toolAccessGrant, signal, options.authorizedToolNames)
      : preparedSelection;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      throwIfAborted(signal);
      const snapshot = this.catalog.searchSnapshot();
      const scenarios = await this.memory.prepare(options.query, this.projectId);
      const memoryEvidence = this.memory.rank(scenarios, this.projectId);
      const discovery = await snapshot.index.discoverHybrid(
        {
          ...searchOptions,
          authorizedToolNames: this.authorizedNames(toolAccessGrant, options.authorizedToolNames),
          memoryEvidence,
        },
        signal,
      );
      if (this.catalog.isSearchSnapshotCurrent(snapshot)) {
        const services = this.unavailableServices(selection?.ids ?? []);
        const diagnostics = [...new Set([...(discovery.diagnostics ?? []), ...(selection?.diagnostics ?? [])])];
        return {
          ...discovery,
          catalogRevision: snapshot.revision,
          ...(services.length > 0 ? { services, status: undefined, reason: undefined } : {}),
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
        };
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

  async skillScenarioEvidence(options: {
    query: string;
    skills: readonly RegisteredSkill[];
  }): Promise<AgentSkillSelectionScenarioEvidence[]> {
    const matches = await this.memory.prepare(options.query, this.projectId);
    return this.memory.rankSkillScenarios({
      matches,
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
      scenarioEvidence: await this.skillScenarioEvidence(options),
    });
  }

  /** Start or join the catalog embedding preparation shared by ToolSearch. */
  prewarm(signal?: AbortSignal): Promise<void> {
    return this.catalog.prewarm(signal);
  }

  async close(): Promise<void> {
    this.capabilitySessionCache.clear();
    await this.catalog.close();
    await this.options.closeEmbedding?.();
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
      toolAccessGrant?: AgentToolAccessGrant;
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
      context.toolAccessGrant,
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
    toolAccessGrant?: AgentToolAccessGrant,
  ): Promise<{
    result: unknown;
    searchPerformed: boolean;
    reusedToolNames: readonly string[];
  }> {
    const catalogRevisionBeforePreparation = this.catalog.catalogRevision();
    // Deferred MCP discovery must run before capability reuse. Otherwise a
    // previous successful tool can short-circuit the query and hide a newly
    // relevant MCP server whose schema has not been loaded yet.
    const selection = await this.prepareCatalog(args.query, toolAccessGrant, signal, authorizedToolNames);
    authorizedToolNames = this.authorizedNames(toolAccessGrant, authorizedToolNames);
    const catalogChanged = catalogRevisionBeforePreparation !== this.catalog.catalogRevision();
    const unavailableServices = this.unavailableServices(selection.ids);
    const reusable =
      catalogChanged || unavailableServices.length > 0
        ? []
        : this.capabilityReuse.matchReusableCapabilities({
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
        : await this.discoverInternal(
            {
              query: args.query,
              loadedToolNames,
              authorizedToolNames,
              toolAccessGrant,
              interaction,
              signal,
            },
            false,
            selection,
          );

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
        toolAccessGrant,
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
      ...(discovery.services ? { services: discovery.services } : {}),
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

  private authorizedNames(grant?: AgentToolAccessGrant, names?: readonly string[]): readonly string[] | undefined {
    return grant ? resolveAgentToolGrantNames(grant, this.registry.listTools()) : names;
  }

  private unavailableServices(ids: readonly string[]): readonly AgentMcpServiceDiscoveryEntry[] {
    return (this.options.mcpServices?.() ?? []).filter(
      (service) => ids.includes(service.id) && service.availability.status !== "ready",
    );
  }

  private async prepareRequestedTools(names: readonly string[], context: AgentHostToolContext): Promise<void> {
    const authorized = this.authorizedNames(context.toolAccessGrant, context.authorizedToolNames);
    const ids = [
      ...new Set(
        names.flatMap((name) => {
          const tool = this.registry.getTool(name);
          return tool?.handler.kind === "McpTool" && (!authorized || authorized.includes(name))
            ? [tool.handler.server.id]
            : [];
        }),
      ),
    ];
    if (ids.length > 0) await this.options.beforeSearch?.("", context.signal, ids);
    throwIfAborted(context.signal);
  }

  private async prepareCatalog(
    query: string,
    grant?: AgentToolAccessGrant,
    signal?: AbortSignal,
    authorizedToolNames?: readonly string[],
  ): Promise<PreparedMcpDiscovery> {
    const selection = await this.catalog.discoverServices(query, grant, signal, authorizedToolNames);
    const ids = selection.services.map((service) => service.id);
    await this.options.beforeSearch?.(query, signal, this.options.mcpServices ? ids : undefined);
    return { ids, diagnostics: selection.diagnostics };
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
