import type { ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import { AgentToolSearchDocumentBuilder } from "./AgentToolSearchDocumentBuilder.js";
import {
  AgentToolSearchRankPipeline,
  type AgentToolSearchRankInput,
  type AgentToolSearchSemanticEvidence,
} from "./AgentToolSearchRankPipeline.js";
import { matchToolCapabilities } from "./AgentToolSearchCapabilities.js";
import {
  type AgentToolSearchOptions,
  type AgentToolSearchDiscovery,
  AgentToolSearchDiagnostics,
  AgentToolSearchEmptyReasons,
  AgentToolSearchDiscoveryStatuses,
  type AgentToolSearchRankedEntry,
  type AgentToolSearchRankerName,
  type AgentToolSearchRankMap,
  type AgentToolSearchResult,
  type ToolSearchDocument,
} from "./AgentToolSearchTypes.js";
import { AgentCapabilityKinds, AgentCapabilitySearchIndex } from "./AgentCapabilitySearchIndex.js";
import { buildToolCapabilityDocument } from "./AgentCapabilityDocumentBuilder.js";
import { isAgentToolMetaToolName } from "./AgentToolSearchRuntimeTypes.js";
import { isAgentToolAvailableForInteraction } from "../ToolRuntime/AgentToolInteractionAvailability.js";
import type { AgentToolResourceDiscoveryReader } from "../ToolRuntime/AgentToolResourceDiscovery.js";
import { projectToolSearchRetrievalQuery, queryShapes } from "./AgentToolSearchQueryShape.js";
import { planAgentToolSearchDiscovery } from "./AgentToolSearchConfidence.js";
import { deriveAgentToolSearchDirectMatchNames } from "./AgentToolSearchDirectEvidence.js";
import { isAgentToolDynamicallyDiscoverable } from "../ToolRuntime/AgentToolInvocationRouting.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentToolSearchDiagnostic } from "./AgentToolSearchTypes.js";

export type {
  AgentToolSearchCapabilityMatch,
  AgentToolSearchDiscovery,
  AgentToolSearchOptions,
  AgentToolSearchResult,
} from "./AgentToolSearchTypes.js";

export interface AgentToolSearchRegistryReader {
  listTools(): RegisteredTool[];
}

/**
 * Request-local result fields derived from one immutable catalog and one query
 * token list. They are shared by rank projection and confidence planning, so
 * a later request cannot inherit stale capability metadata.
 */
interface AgentToolSearchResultProjectionCache {
  readonly matchedTermsByTool: Map<string, string[]>;
  readonly matchedCapabilitiesByTool: Map<string, ReturnType<typeof matchToolCapabilities>>;
}

export class AgentToolSearchIndex {
  private readonly tokenizer = new AgentToolSearchTokenizer();
  private readonly docs: ToolSearchDocument[];
  private readonly docsByTool = new Map<string, ToolSearchDocument>();
  private readonly anchorTokensByTool = new Map<string, ReadonlySet<string>>();
  private readonly toolsByName: ReadonlyMap<string, RegisteredTool>;
  private readonly rankPipeline: AgentToolSearchRankPipeline;
  private readonly capabilityIndex: AgentCapabilitySearchIndex;

  constructor(
    registry: AgentToolSearchRegistryReader,
    private readonly config: ResolvedAgentToolSearchConfig,
    capabilityIndex?: AgentCapabilitySearchIndex,
    resourceDiscovery?: AgentToolResourceDiscoveryReader,
  ) {
    const documentBuilder = new AgentToolSearchDocumentBuilder(resourceDiscovery);
    const registeredTools = registry.listTools();
    const toolsByName = new Map(registeredTools.map((tool) => [tool.name, tool]));
    this.toolsByName = toolsByName;
    // ToolSearch is the deferred-capability protocol. Bootstrap tools are
    // already present in the provider schema and must be called directly;
    // indexing them here would invite the model to route resident tools
    // through ToolDescribe/ToolCall and duplicate their token cost.
    this.docs = registeredTools
      .filter((tool) => isAgentToolDynamicallyDiscoverable(tool) && !isAgentToolMetaToolName(tool.name))
      .map((tool) => documentBuilder.build(tool));
    this.docs.forEach((doc) => this.docsByTool.set(doc.toolName, doc));
    this.capabilityIndex =
      capabilityIndex ??
      new AgentCapabilitySearchIndex(
        this.docs.map((document) => {
          const tool = toolsByName.get(document.toolName);
          if (!tool) throw new Error(`工具搜索索引缺少注册工具：${document.toolName}`);
          return buildToolCapabilityDocument(tool, document);
        }),
        { tokenizer: this.tokenizer },
      );
    this.rankPipeline = new AgentToolSearchRankPipeline(
      config,
      this.tokenizer,
      this.capabilityIndex,
      this.docs,
      this.docsByTool,
    );
  }

  private rankSearch(
    options: AgentToolSearchRankInput,
    projectionCache: AgentToolSearchResultProjectionCache = this.createResultProjectionCache(),
  ): { results: AgentToolSearchResult[]; queryTokens: readonly string[] } {
    const eligibleToolNames = this.searchableToolNames(options);
    const authorized = options.authorizedToolNames
      ? options.authorizedToolNames.filter((toolName) => eligibleToolNames.has(toolName))
      : [...eligibleToolNames];
    const ranked = this.rankPipeline.rank({
      ...options,
      authorizedToolNames: authorized,
    });
    const memoryByTool = new Map((options.memoryEvidence ?? []).map((entry) => [entry.toolName, entry]));
    const semanticScoresByTool = new Map(options.semanticEvidence.map((entry) => [entry.toolName, entry.score]));
    return {
      results: ranked.entries.map((entry) =>
        this.toResult(entry, ranked.rankers, ranked.queryTokens, memoryByTool, semanticScoresByTool, projectionCache),
      ),
      queryTokens: ranked.queryTokens,
    };
  }

  async discoverHybrid(options: AgentToolSearchOptions, signal?: AbortSignal): Promise<AgentToolSearchDiscovery> {
    const projectionCache = this.createResultProjectionCache();
    const authorized = options.authorizedToolNames ? new Set(options.authorizedToolNames) : undefined;
    const searchableToolNames = this.searchableToolNames(options);
    const allowedNames = new Set(
      [...searchableToolNames].filter((toolName) => !authorized || authorized.has(toolName)),
    );
    const retrievalQuery = projectToolSearchRetrievalQuery(options.query);
    const resourceQueryShapes = queryShapes(options.query, this.tokenizer);
    // Semantic retrieval starts before deterministic projection and is always
    // part of a non-empty discovery query. It has no language or lexical
    // short-circuit: BM25, fuzzy, resource shape, memory, and mini-cn are
    // fused together below.
    const diagnostics: AgentToolSearchDiagnostic[] = [];
    let semanticEvidence: AgentToolSearchSemanticEvidence[] = [];
    if (this.config.Embedding.Enabled) {
      try {
        semanticEvidence = await this.semanticEvidence(retrievalQuery, allowedNames, signal);
      } catch {
        // Cancellation is control flow and must remain visible to the caller.
        // A failed optional semantic channel is different: deterministic
        // lexical/structural channels still provide a valid discovery result.
        throwIfAborted(signal);
        diagnostics.push(AgentToolSearchDiagnostics.SemanticUnavailable);
      }
    }
    const rankInput: AgentToolSearchRankInput = {
      ...options,
      retrievalQuery,
      resourceQueryShapes,
      semanticEvidence,
    };
    const ranked = this.rankSearch(rankInput, projectionCache);
    const planned = planAgentToolSearchDiscovery(ranked.results, {
      directMatchNames: deriveAgentToolSearchDirectMatchNames({
        query: options.query,
        queryTokens: ranked.queryTokens,
        results: ranked.results,
        documentsByTool: this.docsByTool,
        tokenizer: this.tokenizer,
      }),
    });
    const reason = resolveEmptyReason({
      resultCount: planned.match.length + planned.maybe.length + planned.omitted.length,
      searchableCount: searchableToolNames.size,
      allowedCount: allowedNames.size,
      hasAuthorizationFilter: authorized !== undefined,
    });
    return {
      ...planned,
      ...(reason ? { status: AgentToolSearchDiscoveryStatuses.Empty } : {}),
      ...(reason ? { reason } : {}),
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
  }

  private async semanticEvidence(
    query: string,
    allowedNames: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<AgentToolSearchSemanticEvidence[]> {
    return (await this.capabilityIndex.semantic(query, AgentCapabilityKinds.Tool, allowedNames, signal)).map(
      (entry) => ({
        toolName: entry.name,
        score: entry.score,
      }),
    );
  }

  getToolNames(): string[] {
    return this.docs.map((doc) => doc.toolName);
  }

  tokenize(text: string): string[] {
    return this.tokenizer.tokenize(text);
  }

  tokenizeContent(text: string): string[] {
    return this.tokenizer.tokenizeContent(text);
  }

  hasDistinctLeadingSubject(left: string, right: string): boolean {
    return this.tokenizer.hasDistinctLeadingSubject(left, right);
  }

  private toResult(
    entry: AgentToolSearchRankedEntry,
    rankers: Record<AgentToolSearchRankerName, AgentToolSearchRankMap>,
    queryTokens: string[],
    memoryByTool: ReadonlyMap<string, NonNullable<AgentToolSearchOptions["memoryEvidence"]>[number]>,
    semanticScoresByTool: ReadonlyMap<string, number>,
    projectionCache: AgentToolSearchResultProjectionCache,
  ): AgentToolSearchResult {
    const doc = this.docsByTool.get(entry.toolName);
    if (!doc) {
      throw new Error(`工具搜索索引缺少文档：${entry.toolName}`);
    }

    const matchedTerms = this.matchedTerms(doc, queryTokens, projectionCache);
    const matchedCapabilities = this.matchedCapabilities(doc, queryTokens, projectionCache);
    const ranks = Object.fromEntries(
      (Object.keys(rankers) as AgentToolSearchRankerName[]).flatMap((name) => {
        const rank = rankers[name].get(entry.toolName);
        return rank === undefined ? [] : [[name, rank] as const];
      }),
    );

    return {
      ...(this.toolsByName.get(entry.toolName)?.availability
        ? { availability: this.toolsByName.get(entry.toolName)!.availability }
        : {}),
      toolName: doc.toolName,
      title: doc.title,
      ownerName: doc.ownerName,
      sources: doc.sources.map((source) => ({ ...source })),
      summary: doc.summary,
      whenToUse: doc.whenToUse,
      parameterSummary: doc.params,
      permissions: doc.permissions.split(/\s+/).filter(Boolean),
      score: Number(entry.score.toFixed(6)),
      ...(semanticScoresByTool.has(entry.toolName)
        ? { semanticScore: Number((semanticScoresByTool.get(entry.toolName) ?? 0).toFixed(6)) }
        : {}),
      ranks,
      matchedTerms,
      matchedCapabilities,
      scenarioSignals: (memoryByTool.get(entry.toolName)?.signals ?? []).map((signal) => ({
        term: signal.term,
        source: signal.source,
        support: Number(signal.support.toFixed(6)),
        confidence: Number(signal.confidence.toFixed(6)),
        score: Number(signal.score.toFixed(6)),
      })),
    };
  }

  private searchableToolNames(options: AgentToolSearchOptions): Set<string> {
    return new Set(
      this.docs
        .map((document) => document.toolName)
        .filter((toolName) => {
          const tool = this.toolsByName.get(toolName);
          if (!tool || !isAgentToolAvailableForInteraction(tool, options.interaction)) return false;
          return isAgentToolDynamicallyDiscoverable(tool);
        }),
    );
  }

  private createResultProjectionCache(): AgentToolSearchResultProjectionCache {
    return {
      matchedTermsByTool: new Map(),
      matchedCapabilitiesByTool: new Map(),
    };
  }

  private matchedTerms(
    document: ToolSearchDocument,
    queryTokens: readonly string[],
    cache: AgentToolSearchResultProjectionCache,
  ): string[] {
    const cached = cache.matchedTermsByTool.get(document.toolName);
    if (cached) return cached;
    const terms = queryTokens.filter((token) => this.anchorTokens(document).has(token));
    const unique = [...new Set(terms)];
    cache.matchedTermsByTool.set(document.toolName, unique);
    return unique;
  }

  private matchedCapabilities(
    document: ToolSearchDocument,
    queryTokens: readonly string[],
    cache: AgentToolSearchResultProjectionCache,
  ): ReturnType<typeof matchToolCapabilities> {
    const cached = cache.matchedCapabilitiesByTool.get(document.toolName);
    if (cached) return cached;
    const matched = matchToolCapabilities(document, queryTokens, this.tokenizer);
    cache.matchedCapabilitiesByTool.set(document.toolName, matched);
    return matched;
  }

  private anchorTokens(document: ToolSearchDocument): ReadonlySet<string> {
    const cached = this.anchorTokensByTool.get(document.toolName);
    if (cached) return cached;
    const tokens = new Set(this.tokenizer.tokenizeContent(document.anchorText));
    this.anchorTokensByTool.set(document.toolName, tokens);
    return tokens;
  }
}

function resolveEmptyReason(options: {
  resultCount: number;
  searchableCount: number;
  allowedCount: number;
  hasAuthorizationFilter: boolean;
}): (typeof AgentToolSearchEmptyReasons)[keyof typeof AgentToolSearchEmptyReasons] | undefined {
  if (options.resultCount > 0) return undefined;
  if (options.searchableCount === 0) return AgentToolSearchEmptyReasons.NoAvailableTools;
  if (options.hasAuthorizationFilter && options.allowedCount === 0) return AgentToolSearchEmptyReasons.NotAuthorized;
  return AgentToolSearchEmptyReasons.NoMatch;
}
