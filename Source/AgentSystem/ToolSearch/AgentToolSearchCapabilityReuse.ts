import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import { AgentToolAssessmentStatuses } from "../ToolRuntime/AgentToolResultOutcome.js";
import { isAgentToolAvailableForInteraction } from "../ToolRuntime/AgentToolInteractionAvailability.js";
import { isAgentToolDynamicallyDiscoverable } from "../ToolRuntime/AgentToolInvocationRouting.js";
import {
  AgentToolCapabilityReuseModes,
  resolveAgentToolCapabilityReusePolicy,
} from "./AgentToolCapabilityReusePolicy.js";
import type { AgentToolCapabilityCacheEntry } from "./AgentToolCapabilitySessionCache.js";
import { AgentToolCapabilitySessionCache } from "./AgentToolCapabilitySessionCache.js";
import type { AgentToolSearchCatalog } from "./AgentToolSearchCatalog.js";
import {
  resolveAgentToolSearchDescription,
  resolveAgentToolSearchSources,
  resolveAgentToolSearchTitle,
} from "./AgentToolSearchDocumentBuilder.js";
import type { AgentToolSearchResult } from "./AgentToolSearchTypes.js";
import { ReusableCapabilityMatchPolicy } from "./AgentToolSearchRuntimePolicies.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { isAgentToolMetaToolName } from "./AgentToolSearchRuntimeTypes.js";

export interface AgentToolSearchCapabilityReuseOptions {
  readonly registry: AgentExtensionRegistry;
  readonly catalog: AgentToolSearchCatalog;
  readonly cache: AgentToolCapabilitySessionCache;
}

/**
 * Keeps confirmed Dynamic-tool evidence separate from discovery ranking.
 * Catalog and contract revisions are checked at every read, so a successful
 * invocation never becomes permission to reuse a replacement tool.
 */
export class AgentToolSearchCapabilityReuse {
  constructor(private readonly options: AgentToolSearchCapabilityReuseOptions) {}

  rememberSuccessfulCapabilities(
    sessionId: string | undefined,
    userInput: string,
    results: readonly ExecutedToolCallResult[],
    logicalCacheScope?: string,
  ): void {
    if (!sessionId) return;
    const catalogRevision = this.options.catalog.catalogRevision();
    for (const result of results) {
      if (isAgentToolMetaToolName(result.name)) continue;
      if (result.outcome.assessment.status !== AgentToolAssessmentStatuses.Success) continue;
      const tool = this.options.registry.getTool(result.name);
      if (!tool || !isAgentToolDynamicallyDiscoverable(tool)) continue;
      this.options.cache.rememberInvocation({
        sessionId,
        logicalCacheScope,
        toolName: result.name,
        catalogRevision,
        contractDigest: tool.contract?.digest,
        query: userInput,
        arguments: result.arguments,
      });
    }
  }

  getReusableCapability(options: {
    sessionId?: string;
    logicalCacheScope?: string;
    toolName: string;
    catalogRevision?: string;
    interaction?: AgentInteractionContext;
  }): AgentToolCapabilityCacheEntry | undefined {
    const tool = this.resolveAutomaticReuseTool(options.toolName, options.interaction);
    if (!tool) return undefined;
    return this.options.cache.getReusable({
      sessionId: options.sessionId,
      logicalCacheScope: options.logicalCacheScope,
      toolName: options.toolName,
      catalogRevision: options.catalogRevision ?? this.options.catalog.catalogRevision(),
      contractDigest: tool.contract?.digest,
    });
  }

  getReusableEvidence(options: {
    sessionId?: string;
    logicalCacheScope?: string;
    toolName: string;
  }): AgentToolCapabilityCacheEntry | undefined {
    if (!options.sessionId) return undefined;
    const tool = this.options.registry.getTool(options.toolName);
    if (!tool) return undefined;
    return this.options.cache.getReusable({
      sessionId: options.sessionId,
      logicalCacheScope: options.logicalCacheScope,
      toolName: options.toolName,
      catalogRevision: this.options.catalog.catalogRevision(),
      contractDigest: tool.contract?.digest,
    });
  }

  reusableCapabilities(options: {
    sessionId?: string;
    logicalCacheScope?: string;
    query?: string;
    authorizedToolNames?: readonly string[];
    interaction?: AgentInteractionContext;
  }): readonly AgentToolCapabilityCacheEntry[] {
    return this.matchReusableCapabilities({
      sessionId: options.sessionId,
      logicalCacheScope: options.logicalCacheScope,
      query: options.query ?? "",
      authorizedToolNames: options.authorizedToolNames,
      interaction: options.interaction,
    });
  }

  matchReusableCapabilities(options: {
    sessionId?: string;
    logicalCacheScope?: string;
    query: string;
    authorizedToolNames?: readonly string[];
    interaction?: AgentInteractionContext;
    candidates?: readonly AgentToolCapabilityCacheEntry[];
  }): readonly AgentToolCapabilityCacheEntry[] {
    if (!options.sessionId) return [];
    const authorized = options.authorizedToolNames ? new Set(options.authorizedToolNames) : undefined;
    const candidates = options.candidates ?? this.options.cache.snapshot(options.sessionId, options.logicalCacheScope);
    const index = this.options.catalog.searchIndex();
    const queryTokens = options.query.trim() ? index.tokenize(options.query) : [];
    return candidates
      .filter((entry) => !authorized || authorized.has(entry.toolName))
      .filter((entry) => queryTokens.length === 0 || this.isReusableForQuery(entry, queryTokens, options.query))
      .flatMap((entry) => {
        if (!this.resolveAutomaticReuseTool(entry.toolName, options.interaction)) return [];
        const reusable = this.getReusableCapability({
          sessionId: options.sessionId,
          logicalCacheScope: options.logicalCacheScope,
          toolName: entry.toolName,
          catalogRevision: this.options.catalog.catalogRevision(),
          interaction: options.interaction,
        });
        return reusable ? [reusable] : [];
      });
  }

  projectReusableSearchResult(
    entry: AgentToolCapabilityCacheEntry,
    loadedToolNames: readonly string[],
  ): AgentToolSearchResult {
    const tool = this.options.registry.getTool(entry.toolName);
    if (!tool || !isAgentToolDynamicallyDiscoverable(tool)) {
      throw new Error(`Reusable dynamic tool is no longer registered: ${entry.toolName}.`);
    }
    const reusePolicy = resolveAgentToolCapabilityReusePolicy(tool);
    if (reusePolicy.mode !== AgentToolCapabilityReuseModes.Automatic) {
      throw new Error(`Tool ${entry.toolName} is not eligible for automatic capability reuse.`);
    }
    const summary = resolveAgentToolSearchDescription(tool);
    const whenToUse = tool.search?.UseCases?.find((useCase) => useCase.trim().length > 0) ?? summary;
    return {
      toolName: tool.name,
      title: resolveAgentToolSearchTitle(tool),
      ownerName: tool.owner.name,
      summary,
      whenToUse,
      parameterSummary: tool.contract?.arguments?.tsHintLines?.join("\n") ?? "",
      permissions: [...tool.permissions],
      score: 1,
      ranks: { memory: 1 },
      matchedTerms: [],
      matchedCapabilities: [],
      learningSignals: [],
      sources: resolveAgentToolSearchSources(tool),
      state: {
        exposure: loadedToolNames.includes(tool.name) ? "visible" : "discoverable",
        contract: "confirmed",
        reuse: "arguments",
        reusableArguments: entry.arguments,
      },
    };
  }

  private resolveAutomaticReuseTool(
    toolName: string,
    interaction?: AgentInteractionContext,
  ): RegisteredTool | undefined {
    const tool = this.options.registry.getTool(toolName);
    return tool &&
      isAgentToolDynamicallyDiscoverable(tool) &&
      isAgentToolAvailableForInteraction(tool, interaction) &&
      resolveAgentToolCapabilityReusePolicy(tool).mode === AgentToolCapabilityReuseModes.Automatic
      ? tool
      : undefined;
  }

  private isReusableForQuery(
    entry: AgentToolCapabilityCacheEntry,
    queryTokens: readonly string[],
    currentQuery: string,
  ): boolean {
    if (!entry.query) return false;
    const index = this.options.catalog.searchIndex();
    const currentQueryKey = queryTokens.join("\u001f");
    const previousQuery = index.tokenize(entry.query).join("\u001f");
    if (previousQuery.length > 0 && previousQuery === currentQueryKey) return true;
    if (index.hasDistinctLeadingSubject(entry.query, currentQuery)) return false;
    const previousTokens = index.tokenizeContent(entry.query);
    const currentTokens = index.tokenizeContent(currentQuery);
    if (previousTokens.length === 0 || currentTokens.length === 0) return false;
    const previous = new Set(previousTokens);
    const overlap = currentTokens.reduce((count, token) => count + (previous.has(token) ? 1 : 0), 0);
    const smallerQuerySize = Math.min(previous.size, currentTokens.length);
    const unionSize = new Set([...previous, ...currentTokens]).size;
    return (
      overlap >= ReusableCapabilityMatchPolicy.minimumOverlap &&
      (overlap / smallerQuerySize >= ReusableCapabilityMatchPolicy.minimumCoverage ||
        overlap / unionSize >= ReusableCapabilityMatchPolicy.minimumJaccard)
    );
  }
}
