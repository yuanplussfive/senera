import MiniSearch from "minisearch";
import type { ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import {
  AgentToolSearchDocumentBuilder,
  ToolSearchDocumentSearchFields,
  ToolSearchDocumentStoreFields,
} from "./AgentToolSearchDocumentBuilder.js";
import { AgentToolSearchRankPipeline } from "./AgentToolSearchRankPipeline.js";
import {
  matchToolCapabilities,
} from "./AgentToolSearchCapabilities.js";
import type {
  AgentToolSearchOptions,
  AgentToolSearchRankedEntry,
  AgentToolSearchRankerName,
  AgentToolSearchRankMap,
  AgentToolSearchResult,
  ToolSearchDocument,
} from "./AgentToolSearchTypes.js";

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
  private readonly miniSearch;
  private readonly docs: ToolSearchDocument[];
  private readonly docsByTool = new Map<string, ToolSearchDocument>();
  private readonly rankPipeline: AgentToolSearchRankPipeline;

  constructor(
    registry: AgentToolSearchRegistryReader,
    private readonly config: ResolvedAgentToolSearchConfig,
  ) {
    const documentBuilder = new AgentToolSearchDocumentBuilder();
    this.docs = registry.listTools().map((tool) => documentBuilder.build(tool));
    this.docs.forEach((doc) => this.docsByTool.set(doc.toolName, doc));
    this.miniSearch = new MiniSearch<ToolSearchDocument>({
      idField: "id",
      fields: [...ToolSearchDocumentSearchFields],
      storeFields: [...ToolSearchDocumentStoreFields],
      tokenize: (text) => this.tokenizer.tokenize(text),
      processTerm: (term) => term,
    });
    this.miniSearch.addAll(this.docs);
    this.rankPipeline = new AgentToolSearchRankPipeline(
      config,
      this.tokenizer,
      this.miniSearch,
      this.docs,
      this.docsByTool,
    );
  }

  search(options: AgentToolSearchOptions): AgentToolSearchResult[] {
    const ranked = this.rankPipeline.rank(options);
    const memoryByTool = new Map(
      (options.memoryEvidence ?? []).map((entry) => [entry.toolName, entry]),
    );
    return ranked.entries.map((entry) =>
      this.toResult(entry, ranked.rankers, ranked.queryTokens, memoryByTool));
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

    const matchedTerms = queryTokens.filter((token) =>
      this.tokenizer.tokenize(doc.coreText).includes(token));
    const ranks = Object.fromEntries(
      (Object.keys(rankers) as AgentToolSearchRankerName[])
        .flatMap((name) => {
          const rank = rankers[name].get(entry.toolName);
          return rank === undefined ? [] : [[name, rank] as const];
        }),
    );

    return {
      toolName: doc.toolName,
      title: doc.title,
      pluginName: doc.pluginName,
      summary: doc.summary,
      whenToUse: doc.whenToUse,
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
