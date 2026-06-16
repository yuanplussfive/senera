import MiniSearch from "minisearch";
import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type { ResolvedAgentToolSearchConfig } from "./Types.js";
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

export class AgentToolSearchIndex {
  private readonly tokenizer = new AgentToolSearchTokenizer();
  private readonly miniSearch;
  private readonly docs: ToolSearchDocument[];
  private readonly docsByTool = new Map<string, ToolSearchDocument>();
  private readonly rankPipeline: AgentToolSearchRankPipeline;

  constructor(
    registry: AgentPluginRegistry,
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
      searchOptions: {
        boost: {
          toolName: 7,
          title: 5,
          tags: 7,
          summary: 3,
          whenToUse: 3,
          examples: 4,
          capabilityText: 5,
          capabilityFacets: 6,
          capabilityAvoid: 0.2,
          capabilityRiskText: 0.3,
          params: 2.5,
          permissions: 1.5,
        },
        prefix: (term) => term.length >= 3,
        fuzzy: (term) => term.length >= 5 ? 0.18 : false,
        maxFuzzy: 2,
      },
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
    return ranked.entries.map((entry) =>
      this.toResult(entry, ranked.rankers, ranked.queryTokens));
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
    };
  }
}
