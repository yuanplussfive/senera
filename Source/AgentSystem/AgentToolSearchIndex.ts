import fs from "node:fs";
import crypto from "node:crypto";
import MiniSearch from "minisearch";
import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type {
  RegisteredTool,
  ResolvedAgentToolSearchConfig,
} from "./Types.js";
import { AgentPromptContractProjector } from "./AgentPromptContractProjector.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import type { AgentToolSearchMemoryEvidence } from "./AgentToolSearchMemory.js";
import { AgentToolSearchReranker } from "./AgentToolSearchReranker.js";
import type { AgentToolSearchRerankDocument } from "./AgentToolSearchReranker.js";

export interface AgentToolSearchOptions {
  query: string;
  plannerTags?: readonly string[];
  includeLoaded?: boolean;
  loadedToolNames?: readonly string[];
  memoryEvidence?: readonly AgentToolSearchMemoryEvidence[];
}

export interface AgentToolSearchResult {
  toolName: string;
  title: string;
  pluginName: string;
  summary: string;
  whenToUse: string;
  permissions: string[];
  score: number;
  ranks: Record<string, number>;
  matchedTerms: string[];
}

interface ToolSearchDocument extends AgentToolSearchRerankDocument {
  id: string;
}

type RankerName = "bm25" | "exact" | "memory" | "priority";
type RankMap = Map<string, number>;
type RankedEntry = { toolName: string; score: number };

const SearchFields = [
  "toolName",
  "title",
  "pluginName",
  "pluginTitle",
  "tags",
  "summary",
  "whenToUse",
  "examples",
  "params",
  "permissions",
] satisfies Array<keyof ToolSearchDocument>;

const StoreFields = [
  "toolName",
  "title",
  "pluginName",
  "summary",
  "whenToUse",
  "permissions",
] satisfies Array<keyof ToolSearchDocument>;

export class AgentToolSearchIndex {
  private readonly tokenizer = new AgentToolSearchTokenizer();
  private readonly contractProjector = new AgentPromptContractProjector();
  private readonly reranker: AgentToolSearchReranker<RankerName>;
  private readonly miniSearch;
  private readonly docs: ToolSearchDocument[];
  private readonly docsByTool = new Map<string, ToolSearchDocument>();
  private readonly documentFrequency = new Map<string, number>();

  constructor(
    private readonly registry: AgentPluginRegistry,
    private readonly config: ResolvedAgentToolSearchConfig,
  ) {
    this.docs = registry.listTools().map((tool) => this.buildDocument(tool));
    this.docs.forEach((doc) => this.docsByTool.set(doc.toolName, doc));
    this.buildDocumentFrequency();
    this.reranker = new AgentToolSearchReranker(config.Rerank, this.tokenizer);
    this.miniSearch = new MiniSearch<ToolSearchDocument>({
      idField: "id",
      fields: [...SearchFields],
      storeFields: [...StoreFields],
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
          params: 2.5,
          permissions: 1.5,
        },
        prefix: (term) => term.length >= 3,
        fuzzy: (term) => term.length >= 5 ? 0.18 : false,
        maxFuzzy: 2,
      },
    });
    this.miniSearch.addAll(this.docs);
  }

  search(options: AgentToolSearchOptions): AgentToolSearchResult[] {
    const queryTokens = this.tokenizer.tokenize(options.query);
    const visible = new Set(options.loadedToolNames ?? []);
    const candidates = this.docs.filter((doc) =>
      options.includeLoaded !== false || !visible.has(doc.toolName));
    const initialNames = new Set(candidates.map((doc) => doc.toolName));
    const rankers = this.rankers(options, queryTokens, initialNames);
    const candidateNames = this.relevantCandidates(rankers, queryTokens);
    const fused = this.fuse(rankers, candidateNames);
    const reranked = this.reranker.rerank(fused, {
      queryTokens,
      plannerTagTokens: this.tokenizer.tokenize((options.plannerTags ?? []).join(" ")),
      rankers,
      docsByTool: this.docsByTool,
      memoryByTool: toMemoryEvidenceMap(options.memoryEvidence ?? []),
      inverseDocumentFrequency: (token) => this.inverseDocumentFrequency(token),
    });
    const diversified = this.diversify(reranked, queryTokens);

    return diversified
      .filter((entry) => entry.score >= this.config.Ranking.MinScore)
      .map((entry) => this.toResult(entry, rankers, queryTokens));
  }

  getToolNames(): string[] {
    return this.docs.map((doc) => doc.toolName);
  }

  tokenize(text: string): string[] {
    return this.tokenizer.tokenize(text);
  }

  private rankers(
    options: AgentToolSearchOptions,
    queryTokens: string[],
    candidateNames: Set<string>,
  ): Record<RankerName, RankMap> {
    return {
      bm25: this.bm25Rank(options.query, candidateNames),
      exact: this.exactRank(queryTokens, candidateNames),
      memory: this.memoryRank(options.memoryEvidence ?? [], candidateNames),
      priority: this.priorityRank(candidateNames),
    };
  }

  private bm25Rank(query: string, candidateNames: Set<string>): RankMap {
    const results = this.miniSearch
      .search(query, {
        filter: (result) => candidateNames.has(String(result.toolName)),
      })
      .sort((left, right) => right.score - left.score);
    return toRankMap(results.map((result) => String(result.toolName)));
  }

  private exactRank(queryTokens: string[], candidateNames: Set<string>): RankMap {
    const querySet = new Set(queryTokens);
    const scored = [...candidateNames]
      .map((toolName) => ({
        toolName,
        score: this.exactScore(querySet, this.docsByTool.get(toolName)),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        right.score - left.score || left.toolName.localeCompare(right.toolName));

    return toRankMap(scored.map((entry) => entry.toolName));
  }

  private exactScore(queryTokens: Set<string>, doc: ToolSearchDocument | undefined): number {
    if (!doc || queryTokens.size === 0) {
      return 0;
    }

    const fields = [
      { text: doc.toolName, boost: 8 },
      { text: doc.title, boost: 5 },
      { text: doc.tags, boost: 7 },
      { text: doc.summary, boost: 3 },
      { text: doc.whenToUse, boost: 3 },
      { text: doc.examples, boost: 4 },
      { text: doc.params, boost: 2 },
      { text: doc.permissions, boost: 1 },
    ];
    return [...queryTokens].reduce((total, token) => {
      const bestBoost = fields.reduce((best, field) => {
        const fieldTokens = new Set(this.tokenizer.tokenize(field.text));
        return fieldTokens.has(token) ? Math.max(best, field.boost) : best;
      }, 0);
      return total + bestBoost * this.inverseDocumentFrequency(token);
    }, 0);
  }

  private memoryRank(
    evidence: readonly AgentToolSearchMemoryEvidence[],
    candidateNames: Set<string>,
  ): RankMap {
    return toRankMap(
      evidence
        .filter((entry) => candidateNames.has(entry.toolName))
        .sort((left, right) =>
          right.rankScore - left.rankScore || left.toolName.localeCompare(right.toolName))
        .map((entry) => entry.toolName),
    );
  }

  private priorityRank(candidateNames: Set<string>): RankMap {
    const ranked = [...candidateNames]
      .map((toolName) => this.docsByTool.get(toolName))
      .filter((doc): doc is ToolSearchDocument => Boolean(doc))
      .sort((left, right) =>
        left.priority - right.priority || left.toolName.localeCompare(right.toolName));
    return toRankMap(ranked.map((doc) => doc.toolName));
  }

  private fuse(
    rankers: Record<RankerName, RankMap>,
    candidateNames: Set<string>,
  ): RankedEntry[] {
    const weights = {
      bm25: 1,
      exact: 0.9,
      memory: 0.75,
      priority: 0.25,
    } satisfies Record<RankerName, number>;
    const k = this.config.Ranking.RrfK;

    return [...candidateNames]
      .map((toolName) => ({
        toolName,
        score: (Object.keys(rankers) as RankerName[]).reduce((total, name) => {
          const rank = rankers[name].get(toolName);
          return rank === undefined ? total : total + weights[name] / (k + rank);
        }, 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        right.score - left.score || left.toolName.localeCompare(right.toolName));
  }

  private diversify(
    entries: RankedEntry[],
    queryTokens: string[],
  ): RankedEntry[] {
    const selected: RankedEntry[] = [];
    const remaining = [...entries];
    const querySet = new Set(queryTokens);

    while (remaining.length > 0) {
      const bestScore = Math.max(...remaining.map((entry) => entry.score));
      const pool = remaining.filter((entry) =>
        entry.score >= bestScore * this.config.Ranking.MmrCandidateScoreRatio);
      const next = pool
        .map((entry) => ({
          entry,
          score: this.diversifiedScore(entry, selected, querySet),
        }))
        .sort((left, right) =>
          right.score - left.score || left.entry.toolName.localeCompare(right.entry.toolName))[0];

      if (!next) {
        break;
      }

      selected.push(next.entry);
      remaining.splice(remaining.findIndex((entry) => entry.toolName === next.entry.toolName), 1);
    }

    return selected;
  }

  private diversifiedScore(
    entry: RankedEntry,
    selected: RankedEntry[],
    queryTokens: Set<string>,
  ): number {
    const doc = this.docsByTool.get(entry.toolName);
    if (!doc) {
      return entry.score;
    }

    const lambda = this.config.Ranking.MmrLambda;
    const relevance = entry.score + this.queryCoverage(doc, queryTokens) * 0.01;
    const redundancy = selected.length === 0
      ? 0
      : Math.max(...selected.map((selectedEntry) =>
          this.documentSimilarity(doc, this.docsByTool.get(selectedEntry.toolName))));
    return lambda * relevance - (1 - lambda) * redundancy;
  }

  private queryCoverage(doc: ToolSearchDocument, queryTokens: Set<string>): number {
    const tokens = new Set(this.tokenizer.tokenize(doc.coreText));
    return [...queryTokens].filter((token) => tokens.has(token)).length;
  }

  private documentSimilarity(left: ToolSearchDocument, right: ToolSearchDocument | undefined): number {
    if (!right) {
      return 0;
    }

    const leftTokens = new Set(this.tokenizer.tokenize(left.coreText));
    const rightTokens = new Set(this.tokenizer.tokenize(right.coreText));
    const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    const union = new Set([...leftTokens, ...rightTokens]).size;
    return union === 0 ? 0 : intersection / union;
  }

  private toResult(
    entry: RankedEntry,
    rankers: Record<RankerName, RankMap>,
    queryTokens: string[],
  ): AgentToolSearchResult {
    const doc = this.docsByTool.get(entry.toolName);
    if (!doc) {
      throw new Error(`工具搜索索引缺少文档：${entry.toolName}`);
    }

    const matchedTerms = queryTokens.filter((token) =>
      this.tokenizer.tokenize(doc.coreText).includes(token));
    const ranks = Object.fromEntries(
      (Object.keys(rankers) as RankerName[])
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
    };
  }

  private relevantCandidates(
    rankers: Record<RankerName, RankMap>,
    queryTokens: string[],
  ): Set<string> {
    const querySet = new Set(queryTokens);
    return new Set(
      [...rankers.bm25.keys(), ...rankers.exact.keys(), ...rankers.memory.keys()]
        .filter((toolName) => this.isRelevantCandidate(toolName, rankers, querySet)),
    );
  }

  private isRelevantCandidate(
    toolName: string,
    rankers: Record<RankerName, RankMap>,
    queryTokens: Set<string>,
  ): boolean {
    if (rankers.memory.has(toolName)) {
      return true;
    }

    const doc = this.docsByTool.get(toolName);
    if (!doc) {
      return false;
    }

    const coverage = this.queryCoverage(doc, queryTokens);
    const information = this.informationCoverage(doc, queryTokens);
    const requiredCoverage = queryTokens.size <= 2 ? 1 : 2;
    return (coverage >= requiredCoverage && information >= 1.5)
      || this.exactScore(queryTokens, doc) >= 8;
  }

  private informationCoverage(doc: ToolSearchDocument, queryTokens: Set<string>): number {
    const tokens = new Set(this.tokenizer.tokenize(doc.coreText));
    return [...queryTokens]
      .filter((token) => tokens.has(token))
      .reduce((total, token) => total + this.inverseDocumentFrequency(token), 0);
  }

  private inverseDocumentFrequency(token: string): number {
    const df = this.documentFrequency.get(token) ?? 0;
    return Math.log(1 + (this.docs.length + 1) / (df + 1));
  }

  private buildDocumentFrequency(): void {
    for (const doc of this.docs) {
      for (const token of new Set(this.tokenizer.tokenize(doc.coreText))) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
    }
  }

  private buildDocument(tool: RegisteredTool): ToolSearchDocument {
    const search = tool.search;
    const title = tool.plugin.manifest.Plugin.Title ?? tool.name;
    const summary = search?.Summary
      ?? tool.plugin.manifest.Plugin.Description
      ?? "";
    const whenToUse = (search?.UseCases ?? []).join(" ");
    const examples = (search?.Examples ?? []).join(" ");
    const avoid = (search?.Avoid ?? []).join(" ");
    const tags = [
      ...(tool.plugin.manifest.Discovery?.Tags ?? []),
      ...(search?.Keywords ?? []),
    ].join(" ");
    const params = this.readSignatureParams(tool);
    const permissions = tool.permissions.join(" ");
    const coreText = [
      tool.name,
      title,
      tool.plugin.manifest.Plugin.Name,
      tool.plugin.manifest.Plugin.Title,
      tags,
      summary,
      whenToUse,
      examples,
      params,
      permissions,
    ].filter(Boolean).join(" ");

    return {
      id: stableToolDocumentId(tool),
      toolName: tool.name,
      title,
      pluginName: tool.plugin.manifest.Plugin.Name,
      pluginTitle: tool.plugin.manifest.Plugin.Title ?? "",
      tags,
      summary,
      whenToUse,
      examples,
      avoid,
      params,
      permissions,
      priority: tool.plugin.manifest.Prompting?.Priority ?? 100,
      coreText,
    };
  }

  private readSignatureParams(tool: RegisteredTool): string {
    if (!tool.signatureFile || !fs.existsSync(tool.signatureFile)) {
      return "";
    }

    try {
      const contract = this.contractProjector.projectFromFile(tool.signatureFile, "arguments");
      const fields = contract?.properties.flatMap(readContractPropertyTokens) ?? [];
      return fields.map((field) => field.name).join(" ");
    } catch {
      return "";
    }
  }
}

function readContractPropertyTokens(
  property: import("./AgentPromptContractProjector.js").AgentPromptContractProperty,
): Array<{ name: string; typeText: string; comment: string }> {
  return [
    {
      name: property.name,
      typeText: property.typeText,
      comment: property.comment,
    },
    ...property.children.flatMap(readContractPropertyTokens),
    ...(property.element ? readContractPropertyTokens(property.element) : []),
  ];
}

function toRankMap(toolNames: string[]): RankMap {
  return new Map(toolNames.map((toolName, index) => [toolName, index + 1]));
}

function toMemoryEvidenceMap(
  evidence: readonly AgentToolSearchMemoryEvidence[],
): Map<string, AgentToolSearchMemoryEvidence> {
  return new Map(evidence.map((entry) => [entry.toolName, entry]));
}

function stableToolDocumentId(tool: RegisteredTool): string {
  return crypto
    .createHash("sha1")
    .update(`${tool.plugin.manifest.Plugin.Name}:${tool.name}`)
    .digest("hex");
}
