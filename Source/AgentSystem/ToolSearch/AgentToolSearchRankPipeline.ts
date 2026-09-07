import type { ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import type { AgentToolSearchMemoryEvidence } from "./AgentToolSearchMemory.js";
import { AgentCapabilityKinds, type AgentCapabilitySearchIndex } from "./AgentCapabilitySearchIndex.js";
import { AgentToolSearchReranker } from "./AgentToolSearchReranker.js";
import type {
  AgentToolSearchOptions,
  AgentToolSearchRankedEntry,
  AgentToolSearchRankerName,
  AgentToolSearchRankMap,
  ToolSearchDocument,
} from "./AgentToolSearchTypes.js";
import {
  AgentToolSearchMemoryExpansionModes,
  type AgentToolSearchMemoryExpansionMode,
} from "../Types/AgentToolAndMemoryConfigTypes.js";
import { AgentToolSearchResultModes } from "./AgentToolSearchTypes.js";

export interface AgentToolSearchRankPipelineResult {
  entries: AgentToolSearchRankedEntry[];
  rankers: Record<AgentToolSearchRankerName, AgentToolSearchRankMap>;
  queryTokens: string[];
}

export class AgentToolSearchRankPipeline {
  private readonly documentFrequency = new Map<string, number>();
  private readonly documentTokensByTool = new Map<string, ReadonlySet<string>>();
  private readonly reranker: AgentToolSearchReranker<AgentToolSearchRankerName>;

  constructor(
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly tokenizer: AgentToolSearchTokenizer,
    private readonly capabilityIndex: AgentCapabilitySearchIndex,
    private readonly docs: readonly ToolSearchDocument[],
    private readonly docsByTool: ReadonlyMap<string, ToolSearchDocument>,
  ) {
    this.buildDocumentFrequency();
    this.reranker = new AgentToolSearchReranker(config.Rerank, tokenizer);
  }

  rank(options: AgentToolSearchOptions): AgentToolSearchRankPipelineResult {
    const queryTokens = this.tokenizer.tokenize(options.query);
    const authorized = options.authorizedToolNames ? new Set(options.authorizedToolNames) : undefined;
    // Visibility is presentation state, not an authorization boundary. A
    // loaded tool must remain searchable so ToolSearch can report that its
    // contract is already available instead of making the model search in a
    // loop. `includeLoaded` is retained for protocol compatibility and is no
    // longer used to hide candidates.
    const candidates = this.docs.filter((doc) => !authorized || authorized.has(doc.toolName));
    const initialNames = new Set(candidates.map((doc) => doc.toolName));
    const rankers = this.rankers(options, queryTokens, initialNames);
    const catalogMode = options.resultMode === AgentToolSearchResultModes.Catalog;
    const candidateNames = this.relevantCandidates(rankers, options.memoryEvidence ?? [], catalogMode, initialNames);
    const fused = this.fuse(rankers, candidateNames, catalogMode);
    const reranked = this.reranker.rerank(fused, {
      queryTokens,
      plannerTagTokens: this.tokenizer.tokenize((options.plannerTags ?? []).join(" ")),
      rankers,
      docsByTool: this.docsByTool,
      memoryByTool: toMemoryEvidenceMap(options.memoryEvidence ?? []),
      inverseDocumentFrequency: (token) => this.inverseDocumentFrequency(token),
    });
    const ordered = catalogMode ? reranked : this.diversify(reranked);

    return {
      entries: ordered
        .filter((entry) => catalogMode || entry.score >= this.config.Ranking.MinScore)
        .slice(0, catalogMode ? undefined : this.config.Ranking.MaxResults),
      rankers,
      queryTokens,
    };
  }

  private rankers(
    options: AgentToolSearchOptions,
    queryTokens: string[],
    candidateNames: Set<string>,
  ): Record<AgentToolSearchRankerName, AgentToolSearchRankMap> {
    const bm25 = this.bm25Rank(options.query, candidateNames);
    return {
      bm25,
      exact: this.exactRank(queryTokens, candidateNames),
      fuzzy: this.fuzzyRank(options.query, candidateNames),
      semantic: this.semanticRank(options.semanticEvidence ?? [], candidateNames),
      memory: this.memoryRank(options.memoryEvidence ?? [], candidateNames),
      priority: this.priorityRank(candidateNames),
      source: this.sourcePreferenceRank(options.preferredSourceIds ?? [], candidateNames),
    };
  }

  private fuzzyRank(query: string, candidateNames: Set<string>): AgentToolSearchRankMap {
    if (!this.config.Fuzzy.Enabled) return new Map();
    const matches = this.capabilityIndex.fuzzy(query, AgentCapabilityKinds.Tool, {
      allowedNames: candidateNames,
      minScore: this.config.Fuzzy.MinScore,
      limit: this.config.Fuzzy.CandidateLimit,
    });
    return toRankMap(matches.map((match) => match.name));
  }

  private bm25Rank(query: string, candidateNames: Set<string>): AgentToolSearchRankMap {
    const results = this.capabilityIndex
      .lexical(query, AgentCapabilityKinds.Tool, candidateNames)
      .sort((left, right) => right.score - left.score);
    return toRankMap(results.map((result) => result.name));
  }

  private semanticRank(
    evidence: readonly NonNullable<AgentToolSearchOptions["semanticEvidence"]>[number][],
    candidateNames: Set<string>,
  ): AgentToolSearchRankMap {
    return toRankMap(
      evidence
        .filter((entry) => candidateNames.has(entry.toolName))
        .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName))
        .map((entry) => entry.toolName),
    );
  }

  private exactRank(queryTokens: string[], candidateNames: Set<string>): AgentToolSearchRankMap {
    const querySet = new Set(queryTokens);
    const scored = [...candidateNames]
      .map((toolName) => ({
        toolName,
        score: this.exactScore(querySet, this.docsByTool.get(toolName)),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName));

    return toRankMap(scored.map((entry) => entry.toolName));
  }

  private exactScore(queryTokens: Set<string>, doc: ToolSearchDocument | undefined): number {
    if (!doc || queryTokens.size === 0) {
      return 0;
    }

    const documentTokens = this.documentTokens(doc);
    return [...queryTokens].reduce((total, token) => {
      return documentTokens.has(token) ? total + this.inverseDocumentFrequency(token) : total;
    }, 0);
  }

  private memoryRank(
    evidence: readonly AgentToolSearchMemoryEvidence[],
    candidateNames: Set<string>,
  ): AgentToolSearchRankMap {
    return toRankMap(
      evidence
        .filter((entry) => candidateNames.has(entry.toolName))
        .sort((left, right) => right.rankScore - left.rankScore || left.toolName.localeCompare(right.toolName))
        .map((entry) => entry.toolName),
    );
  }

  private priorityRank(candidateNames: Set<string>): AgentToolSearchRankMap {
    const ranked = [...candidateNames]
      .map((toolName) => this.docsByTool.get(toolName))
      .filter((doc): doc is ToolSearchDocument => Boolean(doc))
      .sort((left, right) => left.priority - right.priority || left.toolName.localeCompare(right.toolName));
    return toRankMap(ranked.map((doc) => doc.toolName));
  }

  private sourcePreferenceRank(
    preferredSourceIds: readonly string[],
    candidateNames: ReadonlySet<string>,
  ): AgentToolSearchRankMap {
    if (preferredSourceIds.length === 0) return new Map();
    const preferred = new Set(preferredSourceIds);
    return new Map(
      [...candidateNames]
        .filter((toolName) => this.docsByTool.get(toolName)?.sourceIds.some((sourceId) => preferred.has(sourceId)))
        .map((toolName) => [toolName, 1]),
    );
  }

  private fuse(
    rankers: Record<AgentToolSearchRankerName, AgentToolSearchRankMap>,
    candidateNames: Set<string>,
    includeUnmatched: boolean,
  ): AgentToolSearchRankedEntry[] {
    const k = this.config.Ranking.RrfK;

    return [...candidateNames]
      .map((toolName) => ({
        toolName,
        score: (Object.keys(rankers) as AgentToolSearchRankerName[]).reduce((total, name) => {
          const rank = rankers[name].get(toolName);
          return rank === undefined ? total : total + 1 / (k + rank);
        }, 0),
      }))
      .filter((entry) => includeUnmatched || entry.score > 0)
      .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName));
  }

  private diversify(entries: AgentToolSearchRankedEntry[]): AgentToolSearchRankedEntry[] {
    const selected: AgentToolSearchRankedEntry[] = [];
    const remaining = [...entries];

    while (remaining.length > 0 && selected.length < this.config.Ranking.MaxResults) {
      const bestScore = Math.max(...remaining.map((entry) => entry.score));
      const pool = remaining.filter((entry) => entry.score >= bestScore * this.config.Ranking.MmrCandidateScoreRatio);
      const next = pool
        .map((entry) => ({
          entry,
          score: this.diversifiedScore(entry, selected),
        }))
        .sort((left, right) => right.score - left.score || left.entry.toolName.localeCompare(right.entry.toolName))[0];

      if (!next) {
        break;
      }

      selected.push(next.entry);
      remaining.splice(
        remaining.findIndex((entry) => entry.toolName === next.entry.toolName),
        1,
      );
    }

    return selected;
  }

  private diversifiedScore(entry: AgentToolSearchRankedEntry, selected: AgentToolSearchRankedEntry[]): number {
    const doc = this.docsByTool.get(entry.toolName);
    if (!doc) {
      return entry.score;
    }

    const lambda = this.config.Ranking.MmrLambda;
    const relevance = entry.score;
    const redundancy =
      selected.length === 0
        ? 0
        : Math.max(
            ...selected.map((selectedEntry) =>
              this.documentSimilarity(doc, this.docsByTool.get(selectedEntry.toolName)),
            ),
          );
    return lambda * relevance - (1 - lambda) * redundancy;
  }

  private relevantCandidates(
    rankers: Record<AgentToolSearchRankerName, AgentToolSearchRankMap>,
    memoryEvidence: readonly AgentToolSearchMemoryEvidence[],
    includeUnmatched: boolean,
    initialNames: ReadonlySet<string>,
  ): Set<string> {
    if (includeUnmatched) return new Set(initialNames);
    const lexical = new Set([...rankers.bm25.keys(), ...rankers.exact.keys(), ...rankers.fuzzy.keys()]);
    const semantic = new Set(rankers.semantic.keys());
    const memory = this.qualifiedMemoryCandidates(memoryEvidence, rankers.memory);
    const expand = MemoryExpansionPolicies[this.config.Ranking.MemoryExpansion.Mode];
    const recalled = new Set([...lexical, ...semantic]);
    return new Set([...recalled, ...expand({ lexical: recalled, memory })]);
  }

  private qualifiedMemoryCandidates(
    evidence: readonly AgentToolSearchMemoryEvidence[],
    memoryRanks: AgentToolSearchRankMap,
  ): string[] {
    const policy = this.config.Ranking.MemoryExpansion;
    return evidence
      .filter((entry) => memoryRanks.has(entry.toolName))
      .filter((entry) => entry.confidence >= policy.MinConfidence && entry.evidence >= policy.MinEvidence)
      .slice(0, policy.MaxResults)
      .map((entry) => entry.toolName);
  }

  private documentSimilarity(left: ToolSearchDocument, right: ToolSearchDocument | undefined): number {
    if (!right) {
      return 0;
    }

    const leftTokens = this.documentTokens(left);
    const rightTokens = this.documentTokens(right);
    const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    const union = new Set([...leftTokens, ...rightTokens]).size;
    return union === 0 ? 0 : intersection / union;
  }

  private inverseDocumentFrequency(token: string): number {
    const df = this.documentFrequency.get(token) ?? 0;
    return Math.log(1 + (this.docs.length + 1) / (df + 1));
  }

  private buildDocumentFrequency(): void {
    for (const doc of this.docs) {
      for (const token of this.documentTokens(doc)) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
    }
  }

  private documentTokens(doc: ToolSearchDocument): ReadonlySet<string> {
    const cached = this.documentTokensByTool.get(doc.toolName);
    if (cached) return cached;
    const tokens = new Set(this.tokenizer.tokenize(doc.coreText));
    this.documentTokensByTool.set(doc.toolName, tokens);
    return tokens;
  }
}

interface MemoryExpansionPolicyInput {
  lexical: ReadonlySet<string>;
  memory: readonly string[];
}

const MemoryExpansionPolicies = {
  [AgentToolSearchMemoryExpansionModes.Disabled]: () => [],
  [AgentToolSearchMemoryExpansionModes.Fallback]: ({ lexical, memory }) => (lexical.size === 0 ? [...memory] : []),
  [AgentToolSearchMemoryExpansionModes.Augment]: ({ memory }) => [...memory],
} satisfies Record<AgentToolSearchMemoryExpansionMode, (input: MemoryExpansionPolicyInput) => string[]>;

function toRankMap(toolNames: string[]): AgentToolSearchRankMap {
  return new Map(toolNames.map((toolName, index) => [toolName, index + 1]));
}

function toMemoryEvidenceMap(
  evidence: readonly AgentToolSearchMemoryEvidence[],
): Map<string, AgentToolSearchMemoryEvidence> {
  return new Map(evidence.map((entry) => [entry.toolName, entry]));
}
