import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { ResolvedAgentModelProviderConfig, ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentLruCache } from "../Core/AgentLruCache.js";
import { isAgentToolAvailableForInteraction } from "../ToolRuntime/AgentToolInteractionAvailability.js";
import { resolveAvailableAgentToolExecutionTargets } from "../ToolRuntime/AgentToolExecutionPlan.js";
import {
  isAgentToolDirectlyInvocable,
  isAgentToolDynamicallyDiscoverable,
  isAgentToolSupportedByPlanningMode,
} from "../ToolRuntime/AgentToolInvocationRouting.js";
import { isAgentSkillModelInvocable } from "../Skills/AgentSkillInvocation.js";
import type { AgentToolResourceDiscoveryReader } from "../ToolRuntime/AgentToolResourceDiscovery.js";
import { AgentCapabilitySearchIndex, type AgentCapabilityEmbeddingClient } from "./AgentCapabilitySearchIndex.js";
import type { AgentCapabilityEmbeddingCacheStore } from "./AgentCapabilityEmbeddingCache.js";
import {
  buildSkillCapabilityDocument,
  buildToolCapabilityDocument,
  buildMcpServiceCapabilityDocument,
} from "./AgentCapabilityDocumentBuilder.js";
import { AgentCapabilityKinds } from "./AgentCapabilitySearchIndex.js";
import { partitionAgentToolSearchScoreCurve } from "./AgentToolSearchConfidence.js";
import { isAgentMcpServiceAuthorized, type AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentMcpServiceDiscoveryEntry } from "../McpPackages/AgentMcpPackageTypes.js";
import { agentMcpPackageToolName } from "../McpPackages/AgentMcpPackageIdentity.js";
import { AgentToolSearchDocumentBuilder } from "./AgentToolSearchDocumentBuilder.js";
import { AgentToolSearchIndex } from "./AgentToolSearchIndex.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import {
  createAgentCapabilityCatalogRevision,
  createAgentToolCatalogIdentity,
  readAgentRegistryRevision,
  refreshAgentCapabilityEmbeddingCache,
} from "./AgentToolSearchRuntimeCatalog.js";
import { AgentCapabilityEmbeddingCachePolicy } from "./AgentToolSearchRuntimePolicies.js";
import { isAgentToolMetaToolName } from "./AgentToolSearchRuntimeTypes.js";
import { isAgentToolExecutable } from "../ToolRuntime/AgentToolAvailability.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentToolSearchDiagnostics, type AgentToolSearchDiagnostic } from "./AgentToolSearchTypes.js";

export interface AgentToolSearchCatalogOptions {
  readonly mcpServices?: () => readonly AgentMcpServiceDiscoveryEntry[];
  readonly registry: AgentExtensionRegistry;
  readonly config: ResolvedAgentToolSearchConfig;
  readonly model: ResolvedAgentModelProviderConfig;
  readonly availableExecutionTargets: () => readonly ToolExecutionTarget[];
  readonly logger?: AgentLogger;
  readonly embedding?: {
    readonly client: AgentCapabilityEmbeddingClient;
    readonly model: string;
  };
  readonly embeddingCacheStore?: AgentCapabilityEmbeddingCacheStore;
  readonly resourceDiscovery?: AgentToolResourceDiscoveryReader;
}

export interface AgentAuthorizedDynamicTools {
  readonly tools: readonly RegisteredTool[];
  readonly directToolNames: readonly string[];
  readonly rejectedToolNames: readonly string[];
}

export interface AgentToolSearchSnapshot {
  readonly revision: string;
  readonly index: AgentToolSearchIndex;
}

/**
 * Owns all catalog-derived state. Request orchestration deliberately lives in
 * AgentToolSearchRuntime so catalog invalidation cannot leak into session
 * evidence or tool-result handling.
 */
export class AgentToolSearchCatalog {
  private toolCatalog?: AgentToolCatalogSnapshot;
  private index?: AgentToolSearchIndex;
  private searchIndexIdentity?: string;
  private capabilities?: AgentCapabilitySearchIndex;
  private capabilityCatalogIdentity?: string;
  private capabilityRegistryRevision?: number;
  private capabilityToolCatalogIdentity?: string;
  private capabilityServiceCatalogIdentity?: string;
  private capabilityCatalogGeneration = 0;
  private readonly capabilityEmbeddingCache = new AgentLruCache<string, readonly number[]>(
    AgentCapabilityEmbeddingCachePolicy.MinimumEntries,
  );
  private capabilityPrewarm?: AgentCapabilityPrewarmState;

  constructor(private readonly options: AgentToolSearchCatalogOptions) {}

  catalogRevision(): string {
    return this.toolCatalogSnapshot().identity;
  }

  existingToolNames(toolNames: readonly string[], interaction?: AgentInteractionContext): string[] {
    const available = this.availableToolNames(interaction);
    return toolNames.filter((name) => available.has(name));
  }

  mergeVisibleTools(toolNames: readonly string[], interaction?: AgentInteractionContext): string[] {
    const available = this.availableToolNames(interaction);
    const unique = [...new Set(toolNames)].filter((name) => available.has(name));
    const required = this.directToolNames(interaction);
    return [...required, ...unique.filter((name) => !required.includes(name))];
  }

  directToolNames(interaction?: AgentInteractionContext): string[] {
    return this.availableTools()
      .filter(
        (tool) =>
          isAgentToolExecutable(tool) &&
          isAgentToolDirectlyInvocable(tool) &&
          isAgentToolAvailableForInteraction(tool, interaction),
      )
      .map((tool) => tool.name);
  }

  searchIndex(): AgentToolSearchIndex {
    const catalog = this.toolCatalogSnapshot();
    if (this.index && this.searchIndexIdentity === catalog.identity) return this.index;
    const capabilities = this.capabilitySearchIndex(catalog);
    this.index = new AgentToolSearchIndex(
      { listTools: () => [...catalog.tools] },
      this.options.config,
      capabilities,
      this.options.resourceDiscovery,
    );
    this.searchIndexIdentity = catalog.identity;
    return this.index;
  }

  /** Captures the immutable index and the revision that produced it. */
  searchSnapshot(): AgentToolSearchSnapshot {
    const catalog = this.toolCatalogSnapshot();
    return { revision: catalog.identity, index: this.searchIndex() };
  }

  isSearchSnapshotCurrent(snapshot: AgentToolSearchSnapshot): boolean {
    const catalog = this.toolCatalogSnapshot();
    return catalog.identity === snapshot.revision && this.searchIndexIdentity === snapshot.revision;
  }

  capabilityIndex(): AgentCapabilitySearchIndex {
    return this.capabilitySearchIndex();
  }

  async discoverServices(
    query: string,
    grant?: AgentToolAccessGrant,
    signal?: AbortSignal,
    authorizedToolNames?: readonly string[],
  ): Promise<{
    services: readonly AgentMcpServiceDiscoveryEntry[];
    diagnostics: readonly AgentToolSearchDiagnostic[];
  }> {
    throwIfAborted(signal);
    const namesCeiling = grant?.authorizedToolNames ?? authorizedToolNames;
    const services = (this.options.mcpServices?.() ?? []).filter(
      (service) =>
        (grant && isAgentMcpServiceAuthorized(grant, service)) ||
        (!grant && !namesCeiling) ||
        service.toolNames.some((name) => namesCeiling?.includes(agentMcpPackageToolName(service.id, name))),
    );
    if (services.length === 0) return { services: [], diagnostics: [] };
    const allowed = new Set(services.map((service) => service.id));
    const index = this.capabilityIndex();
    const tokenizer = new AgentToolSearchTokenizer();
    const lexicalQuery = tokenizer
      .tokenizeContent(query)
      .filter(
        (token) =>
          tokenizer.isIndependentContentToken(token) && !this.options.config.Tokenize.Stopwords.includes(token),
      )
      .join(" ");
    const names = new Set(
      index.lexical(lexicalQuery, AgentCapabilityKinds.Service, allowed).map((match) => match.name),
    );
    const diagnostics: AgentToolSearchDiagnostic[] = [];
    if (this.options.config.Embedding.Enabled && this.options.embedding) {
      try {
        const matches = await index.semantic(query, AgentCapabilityKinds.Service, allowed, signal);
        const curve = partitionAgentToolSearchScoreCurve(matches);
        if (curve.bands.length > 1 && curve.bands[0]?.length === 1) names.add(curve.bands[0][0]!.name);
      } catch {
        throwIfAborted(signal);
        diagnostics.push(AgentToolSearchDiagnostics.SemanticUnavailable);
      }
    }
    return { services: services.filter((service) => names.has(service.id)), diagnostics };
  }

  resolveAuthorizedDynamicTools(
    toolNames: readonly string[],
    authorizedToolNames: readonly string[] | undefined,
    interaction?: AgentInteractionContext,
  ): AgentAuthorizedDynamicTools {
    const authorized = authorizedToolNames ? new Set(authorizedToolNames) : undefined;
    const availableTools = new Map(
      this.availableTools()
        .filter((tool) => isAgentToolAvailableForInteraction(tool, interaction))
        .map((tool) => [tool.name, tool]),
    );
    const tools: RegisteredTool[] = [];
    const directToolNames: string[] = [];
    const rejectedToolNames: string[] = [];
    for (const toolName of uniqueToolNames(toolNames)) {
      const tool = availableTools.get(toolName);
      if (!tool || (authorized && !authorized.has(toolName))) {
        rejectedToolNames.push(toolName);
      } else if (isAgentToolDirectlyInvocable(tool)) {
        directToolNames.push(tool.name);
      } else {
        tools.push(tool);
      }
    }
    return { tools, directToolNames, rejectedToolNames };
  }

  /** Start or join catalog vector preparation without mutating session state. */
  async prewarm(signal?: AbortSignal): Promise<void> {
    if (!this.options.config.Embedding.Enabled || !this.options.embedding) return;
    while (true) {
      const snapshot = this.captureCapabilityPrewarmSnapshot();
      const current = this.capabilityPrewarm;
      const preparation =
        current?.key === snapshot.key ? current.promise : this.startCapabilityPrewarm(snapshot, signal);
      await preparation;
      // A refresh may occur after the worker completes. Re-read the complete
      // snapshot before reporting success so the next foreground query never
      // joins a promise that only prepared an obsolete catalog.
      if (this.isCapabilityPrewarmSnapshotCurrent(snapshot)) return;
    }
  }

  async close(): Promise<void> {
    await this.capabilities?.close();
  }

  refresh(): void {
    const previousCapabilities = this.capabilities;
    this.toolCatalog = undefined;
    this.index = undefined;
    this.searchIndexIdentity = undefined;
    this.capabilities = undefined;
    this.capabilityCatalogIdentity = undefined;
    this.capabilityRegistryRevision = undefined;
    this.capabilityToolCatalogIdentity = undefined;
    this.capabilityServiceCatalogIdentity = undefined;
    this.capabilityCatalogGeneration += 1;
    if (previousCapabilities) void previousCapabilities.close();
  }

  private availableTools(): readonly RegisteredTool[] {
    return this.toolCatalogSnapshot().tools;
  }

  private availableToolNames(interaction?: AgentInteractionContext): Set<string> {
    return new Set(
      this.availableTools()
        .filter(isAgentToolExecutable)
        .filter((tool) => isAgentToolAvailableForInteraction(tool, interaction))
        .map((tool) => tool.name),
    );
  }

  private capabilitySearchIndex(catalog = this.toolCatalogSnapshot()): AgentCapabilitySearchIndex {
    const serviceDocuments = (this.options.mcpServices?.() ?? []).map(buildMcpServiceCapabilityDocument);
    const serviceIdentity = createAgentCapabilityCatalogRevision(serviceDocuments);
    if (
      this.capabilities &&
      catalog.registryRevision !== undefined &&
      this.capabilityRegistryRevision === catalog.registryRevision &&
      this.capabilityToolCatalogIdentity === catalog.identity &&
      this.capabilityServiceCatalogIdentity === serviceIdentity
    ) {
      return this.capabilities;
    }
    const documentBuilder = new AgentToolSearchDocumentBuilder(this.options.resourceDiscovery);
    const toolDocuments = catalog.tools
      .filter((tool) => isAgentToolDynamicallyDiscoverable(tool) && !isAgentToolMetaToolName(tool.name))
      .map((tool) => buildToolCapabilityDocument(tool, documentBuilder.build(tool)));
    const skillDocuments = this.options.registry
      .listSkills()
      .filter(isAgentSkillModelInvocable)
      .map(buildSkillCapabilityDocument);
    const capabilityDocuments = [...toolDocuments, ...skillDocuments, ...serviceDocuments];
    const identity = createAgentCapabilityCatalogRevision(capabilityDocuments);
    if (this.capabilities && this.capabilityCatalogIdentity === identity) return this.capabilities;
    const embedding =
      this.options.config.Embedding.Enabled && this.options.embedding
        ? {
            client: this.options.embedding.client,
            model: this.options.embedding.model,
          }
        : undefined;
    refreshAgentCapabilityEmbeddingCache(this.capabilityEmbeddingCache, capabilityDocuments, embedding?.model);
    this.capabilities = new AgentCapabilitySearchIndex(capabilityDocuments, {
      tokenizer: new AgentToolSearchTokenizer(),
      embeddingCache: this.capabilityEmbeddingCache,
      embeddingCacheStore: this.options.embeddingCacheStore,
      embedding,
      onEmbeddingError: (error) =>
        this.options.logger?.warn("routing.embedding.failed", {
          message: errorMessage(error),
          catalogRevision: identity,
        }),
      onEmbeddingCacheError: (error) =>
        this.options.logger?.warn("routing.embedding.cache_write_failed", {
          message: errorMessage(error),
          catalogRevision: identity,
        }),
    });
    this.capabilityCatalogIdentity = identity;
    this.capabilityRegistryRevision = catalog.registryRevision;
    this.capabilityToolCatalogIdentity = catalog.identity;
    this.capabilityServiceCatalogIdentity = serviceIdentity;
    this.index = undefined;
    return this.capabilities;
  }

  private captureCapabilityPrewarmSnapshot(): AgentCapabilityPrewarmSnapshot {
    const catalog = this.toolCatalogSnapshot();
    const capabilities = this.capabilitySearchIndex(catalog);
    const capabilityRevision = this.capabilityCatalogIdentity ?? "";
    return {
      key: sha256HexOfCanonicalJson({
        generation: this.capabilityCatalogGeneration,
        catalogRevision: catalog.identity,
        capabilityRevision,
      }),
      generation: this.capabilityCatalogGeneration,
      catalogRevision: catalog.identity,
      capabilityRevision,
      capabilities,
    };
  }

  private startCapabilityPrewarm(snapshot: AgentCapabilityPrewarmSnapshot, signal?: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    const preparation = Promise.resolve()
      .then(async () => {
        await snapshot.capabilities.prewarm(signal);
        // Keep the lexical derivative warm alongside embeddings; the first
        // explicit search should not rebuild either catalog representation.
        this.searchIndex();
        if (this.isCapabilityPrewarmSnapshotCurrent(snapshot)) {
          this.options.logger?.info("routing.embedding.prewarmed", {
            catalogRevision: snapshot.catalogRevision,
            durationMs: Date.now() - startedAt,
          });
        }
      })
      .finally(() => {
        if (this.capabilityPrewarm?.promise === preparation) this.capabilityPrewarm = undefined;
      });
    this.capabilityPrewarm = { key: snapshot.key, promise: preparation };
    return preparation;
  }

  private isCapabilityPrewarmSnapshotCurrent(snapshot: AgentCapabilityPrewarmSnapshot): boolean {
    if (this.capabilityCatalogGeneration !== snapshot.generation) return false;
    const catalog = this.toolCatalogSnapshot();
    if (catalog.identity !== snapshot.catalogRevision) return false;
    const capabilities = this.capabilitySearchIndex(catalog);
    return capabilities === snapshot.capabilities && this.capabilityCatalogIdentity === snapshot.capabilityRevision;
  }

  private toolCatalogSnapshot(): AgentToolCatalogSnapshot {
    const registryRevision = readAgentRegistryRevision(this.options.registry.revision);
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
    const tools = this.options.registry
      .listTools()
      .filter((tool) => isAgentToolSupportedByPlanningMode(tool, this.options.model.ToolPlanningMode))
      .filter((tool) => resolveAvailableAgentToolExecutionTargets(tool, runtimeTargets).length > 0);
    const snapshot = {
      registryRevision,
      runtimeTargetsKey,
      tools,
      identity: createAgentToolCatalogIdentity(tools, runtimeTargets),
    } satisfies AgentToolCatalogSnapshot;
    if (registryRevision !== undefined) this.toolCatalog = snapshot;
    return snapshot;
  }
}

interface AgentToolCatalogSnapshot {
  readonly registryRevision: number | undefined;
  readonly runtimeTargetsKey: string;
  readonly tools: readonly RegisteredTool[];
  readonly identity: string;
}

interface AgentCapabilityPrewarmSnapshot {
  readonly key: string;
  readonly generation: number;
  readonly catalogRevision: string;
  readonly capabilityRevision: string;
  readonly capabilities: AgentCapabilitySearchIndex;
}

interface AgentCapabilityPrewarmState {
  readonly key: string;
  readonly promise: Promise<void>;
}

function uniqueToolNames(toolNames: readonly string[]): string[] {
  return [...new Set(toolNames.map((toolName) => toolName.trim()).filter(Boolean))];
}
