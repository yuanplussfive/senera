import type { ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import { AgentToolSearchDocumentBuilder } from "./AgentToolSearchDocumentBuilder.js";
import { AgentToolSearchRankPipeline } from "./AgentToolSearchRankPipeline.js";
import { matchToolCapabilities } from "./AgentToolSearchCapabilities.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import type {
  AgentToolSearchOptions,
  AgentToolSearchRankedEntry,
  AgentToolSearchRankerName,
  AgentToolSearchRankMap,
  AgentToolSearchResult,
  ToolSearchDocument,
} from "./AgentToolSearchTypes.js";
import { AgentCapabilityKinds, AgentCapabilitySearchIndex } from "./AgentCapabilitySearchIndex.js";
import { buildToolCapabilityDocument } from "./AgentCapabilityDocumentBuilder.js";

export type {
  AgentToolSearchCapabilityMatch,
  AgentToolSearchOptions,
  AgentToolSearchResult,
} from "./AgentToolSearchTypes.js";

export interface AgentToolSearchRegistryReader {
  listTools(): RegisteredTool[];
}

export class AgentToolSearchIndex {
  private readonly tokenizer = new AgentToolSearchTokenizer();
  private readonly docs: ToolSearchDocument[];
  private readonly docsByTool = new Map<string, ToolSearchDocument>();
  private readonly rankPipeline: AgentToolSearchRankPipeline;
  private readonly capabilityIndex: AgentCapabilitySearchIndex;

  constructor(
    registry: AgentToolSearchRegistryReader,
    private readonly config: ResolvedAgentToolSearchConfig,
    capabilityIndex?: AgentCapabilitySearchIndex,
  ) {
    const documentBuilder = new AgentToolSearchDocumentBuilder();
    const registeredTools = registry.listTools();
    const toolsByName = new Map(registeredTools.map((tool) => [tool.name, tool]));
    this.docs = registeredTools
      .filter((tool) => resolveAgentToolOwner(tool).kind !== "system")
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

  search(options: AgentToolSearchOptions): AgentToolSearchResult[] {
    const ranked = this.rankPipeline.rank(options);
    const memoryByTool = new Map((options.memoryEvidence ?? []).map((entry) => [entry.toolName, entry]));
    return ranked.entries.map((entry) => this.toResult(entry, ranked.rankers, ranked.queryTokens, memoryByTool));
  }

  async searchHybrid(options: AgentToolSearchOptions, signal?: AbortSignal): Promise<AgentToolSearchResult[]> {
    const allowedNames = new Set(this.docs.map((document) => document.toolName));
    const semanticEvidence = await this.capabilityIndex.semantic(
      options.query,
      AgentCapabilityKinds.Tool,
      allowedNames,
      signal,
    );
    const recalled = this.search({
      ...options,
      semanticEvidence: semanticEvidence.map((entry) => ({ toolName: entry.name, score: entry.score })),
    });
    const reranked = await this.capabilityIndex.rerank(
      options.query,
      AgentCapabilityKinds.Tool,
      recalled.map((result) => result.toolName),
      signal,
    );
    if (reranked.length === 0) return recalled;

    const rerankByTool = new Map(reranked.map((entry) => [entry.name, entry]));
    return recalled
      .map((result) => {
        const rerank = rerankByTool.get(result.toolName);
        return rerank
          ? {
              ...result,
              score: Number((result.score + rerank.normalizedRankScore).toFixed(6)),
              ranks: { ...result.ranks, rerank: rerank.rank },
            }
          : result;
      })
      .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName));
  }

  getToolNames(): string[] {
    return this.docs.map((doc) => doc.toolName);
  }

  tokenize(text: string): string[] {
    return this.tokenizer.tokenize(text);
  }

  private toResult(
    entry: AgentToolSearchRankedEntry,
    rankers: Record<AgentToolSearchRankerName, AgentToolSearchRankMap>,
    queryTokens: string[],
    memoryByTool: ReadonlyMap<string, NonNullable<AgentToolSearchOptions["memoryEvidence"]>[number]>,
  ): AgentToolSearchResult {
    const doc = this.docsByTool.get(entry.toolName);
    if (!doc) {
      throw new Error(`工具搜索索引缺少文档：${entry.toolName}`);
    }

    const matchedTerms = queryTokens.filter((token) => this.tokenizer.tokenize(doc.coreText).includes(token));
    const ranks = Object.fromEntries(
      (Object.keys(rankers) as AgentToolSearchRankerName[]).flatMap((name) => {
        const rank = rankers[name].get(entry.toolName);
        return rank === undefined ? [] : [[name, rank] as const];
      }),
    );

    return {
      toolName: doc.toolName,
      title: doc.title,
      ownerName: doc.ownerName,
      sources: doc.sources.map((source) => ({ ...source })),
      summary: doc.summary,
      whenToUse: doc.whenToUse,
      parameterSummary: doc.params,
      permissions: doc.permissions.split(/\s+/).filter(Boolean),
      score: Number(entry.score.toFixed(6)),
      ranks,
      matchedTerms: [...new Set(matchedTerms)],
      matchedCapabilities: matchToolCapabilities(doc, queryTokens, this.tokenizer),
      learningSignals: (memoryByTool.get(entry.toolName)?.signals ?? []).map((signal) => ({
        term: signal.term,
        source: signal.source,
        support: Number(signal.support.toFixed(6)),
        confidence: Number(signal.confidence.toFixed(6)),
        score: Number(signal.score.toFixed(6)),
      })),
    };
  }
}
