import type { ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import type { AgentToolSearchMemoryEvidence } from "./AgentToolSearchMemory.js";
import type { AgentToolResourceQueryShape } from "../ToolRuntime/AgentToolResourceDiscovery.js";
import { AgentCapabilityKinds, type AgentCapabilitySearchIndex } from "./AgentCapabilitySearchIndex.js";
import { AgentToolSearchReranker } from "./AgentToolSearchReranker.js";
import type {
  AgentToolSearchOptions,
  AgentToolSearchRankedEntry,
  AgentToolSearchRankerName,
  AgentToolSearchRankMap,
  ToolSearchDocument,
} from "./AgentToolSearchTypes.js";
import { matchToolCapabilities } from "./AgentToolSearchCapabilities.js";

/**
 * Request evidence derived by AgentToolSearchIndex from the original request.
 * It is intentionally not part of AgentToolSearchOptions: callers supply a
 * task, while the index owns normalization, resource detection, and local
 * semantic retrieval as one inseparable operation.
 */
export interface AgentToolSearchRankInput extends AgentToolSearchOptions {
  readonly retrievalQuery: string;
  readonly resourceQueryShapes: readonly AgentToolResourceQueryShape[];
  readonly semanticEvidence: readonly AgentToolSearchSemanticEvidence[];
}

export interface AgentToolSearchSemanticEvidence {
  readonly toolName: string;
  readonly score: number;
}

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

  rank(options: AgentToolSearchRankInput): AgentToolSearchRankPipelineResult {
    const stopwords = new Set(this.config.Tokenize.Stopwords);
    // Rank only on content-bearing terms. This is the same token view used by
    // lexical-completeness checks and avoids function words or segmentation
    // fragments becoming accidental cross-domain ranking evidence.
    const retrievalQuery = options.retrievalQuery;
    const queryTokens = this.tokenizer
      .tokenizeContent(retrievalQuery)
      .filter((token) => this.tokenizer.isIndependentContentToken(token) && !stopwords.has(token));
    const lexicalQuery = queryTokens.join(" ");
    const authorized = options.authorizedToolNames ? new Set(options.authorizedToolNames) : undefined;
    // Visibility is presentation state, not an authorization boundary. A
    // loaded tool must remain searchable so ToolSearch can report that its
    // contract is already available instead of making the model search in a
    // loop.
    const candidates = this.docs.filter((doc) => !authorized || authorized.has(doc.toolName));
    const initialNames = new Set(candidates.map((doc) => doc.toolName));
    const rankers = this.rankers(options, queryTokens, lexicalQuery, initialNames);
    const candidateNames = this.relevantCandidates(rankers);
    const fused = this.fuse(rankers, candidateNames, options.query, queryTokens);
    const reranked = this.reranker.rerank(fused, {
      query: options.query,
      queryTokens,
      resourceQueryShapes: options.resourceQueryShapes,
      plannerTagTokens: this.tokenizer.tokenizeContent((options.plannerTags ?? []).join(" ")),
      rankers,
      docsByTool: this.docsByTool,
      memoryByTool: toMemoryEvidenceMap(options.memoryEvidence ?? []),
      inverseDocumentFrequency: (token) => this.inverseDocumentFrequency(token),
    });
    return {
      entries: reranked,
      rankers,
      queryTokens,
    };
  }

  private rankers(
    options: AgentToolSearchRankInput,
    queryTokens: string[],
    retrievalQuery: string,
    candidateNames: Set<string>,
  ): Record<AgentToolSearchRankerName, AgentToolSearchRankMap> {
    const bm25 = this.bm25Rank(retrievalQuery, candidateNames);
    return {
      bm25,
      exact: this.exactRank(queryTokens, candidateNames),
      example: this.exampleRank(options.query, candidateNames),
      fuzzy: this.fuzzyRank(retrievalQuery, candidateNames),
      semantic: this.semanticRank(options.semanticEvidence, candidateNames),
      structural: this.structuralRank(options.resourceQueryShapes, retrievalQuery, candidateNames),
      memory: this.memoryRank(options.memoryEvidence ?? [], candidateNames),
    };
  }

  private fuzzyRank(query: string, candidateNames: Set<string>): AgentToolSearchRankMap {
    if (!this.config.Fuzzy.Enabled) return new Map();
    const matches = this.capabilityIndex.fuzzy(query, AgentCapabilityKinds.Tool, {
      allowedNames: candidateNames,
      minScore: this.config.Fuzzy.MinScore,
    });
    return toRankMap(matches.map((match) => ({ name: match.name, score: match.score })));
  }

  private bm25Rank(query: string, candidateNames: Set<string>): AgentToolSearchRankMap {
    const results = this.capabilityIndex
      .lexical(query, AgentCapabilityKinds.Tool, candidateNames)
      .sort((left, right) => right.score - left.score);
    return toRankMap(results.map((result) => ({ name: result.name, score: result.score })));
  }

  private semanticRank(
    evidence: readonly AgentToolSearchSemanticEvidence[],
    candidateNames: Set<string>,
  ): AgentToolSearchRankMap {
    return toRankMap(
      evidence
        .filter((entry) => candidateNames.has(entry.toolName))
        .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName))
        .map((entry) => ({ name: entry.toolName, score: entry.score })),
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

    return toRankMap(scored.map((entry) => ({ name: entry.toolName, score: entry.score })));
  }

  private exampleRank(query: string, candidateNames: Set<string>): AgentToolSearchRankMap {
    return toRankMap(
      this.docs
        .filter((document) => candidateNames.has(document.toolName))
        .filter((document) =>
          document.examplePhrases?.some((example) => this.tokenizer.matchesExactPhrase(example, query)),
        )
        .map((document) => ({ name: document.toolName, score: 1 }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  private structuralRank(
    queryShapes: readonly AgentToolResourceQueryShape[],
    retrievalQuery: string,
    candidateNames: Set<string>,
  ): AgentToolSearchRankMap {
    if (queryShapes.length === 0) return new Map();
    const queryTokens = this.tokenizer.tokenizeContent(retrievalQuery);
    const scored = this.docs
      .filter((document) => candidateNames.has(document.toolName))
      .filter((document) => document.resourceQueryShapes?.some((shape) => queryShapes.includes(shape)))
      .map((document) => ({
        toolName: document.toolName,
        score: Math.max(0, ...matchToolCapabilities(document, queryTokens, this.tokenizer).map((match) => match.score)),
      }))
      .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName));
    return toRankMap(scored.map((entry) => ({ name: entry.toolName, score: entry.score })));
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
        .map((entry) => ({ name: entry.toolName, score: entry.rankScore })),
    );
  }

  private fuse(
    rankers: Record<AgentToolSearchRankerName, AgentToolSearchRankMap>,
    candidateNames: Set<string>,
    query: string,
    queryTokens: readonly string[],
  ): AgentToolSearchRankedEntry[] {
    const k = this.config.Ranking.RrfK;
    const weights = this.config.Ranking.ChannelWeights;

    return [...candidateNames]
      .map((toolName) => ({
        toolName,
        score:
          (Object.keys(rankers) as AgentToolSearchRankerName[]).reduce((total, name) => {
            const rank = rankers[name].get(toolName);
            return rank === undefined ? total : total + (weights[name] ?? 1) / (k + rank);
          }, 0) + this.identityConfidenceContribution(toolName, query, queryTokens),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          (this.docsByTool.get(left.toolName)?.priority ?? Number.MAX_SAFE_INTEGER) -
            (this.docsByTool.get(right.toolName)?.priority ?? Number.MAX_SAFE_INTEGER) ||
          left.toolName.localeCompare(right.toolName),
      );
  }

  /**
   * Rank fusion normally only sees channel positions. A complete phrase from
   * an extension-declared identifier or complete natural-language identity is
   * stronger evidence than a coincidental generic word, so preserve it as a
   * bounded share of the existing exact-channel weight. A partial natural
   * alias is only recall evidence: treating it as identity would let a word
   * such as "screenshot" override a more specific "analyze screenshot"
   * request.
   */
  private identityConfidenceContribution(toolName: string, query: string, queryTokens: readonly string[]): number {
    const document = this.docsByTool.get(toolName);
    if (!document || queryTokens.length === 0) return 0;

    const formalPhrases = new Set(document.formalIdentityPhrases ?? [document.toolName]);
    const coverage = Math.max(
      0,
      ...document.identityPhrases.map((phrase) => {
        const phraseTokens = this.tokenizer.tokenizeContent(phrase);
        if (phraseTokens.length === 0 || !this.tokenizer.containsDeclaredPhrase(phrase, query)) return 0;
        if (formalPhrases.has(phrase)) return phraseTokens.length / queryTokens.length;
        const phraseTokenSet = new Set(phraseTokens);
        return queryTokens.every((token) => phraseTokenSet.has(token)) ? 1 : 0;
      }),
    );
    return (coverage * (this.config.Ranking.ChannelWeights.exact ?? 1)) / (this.config.Ranking.RrfK + 1);
  }

  private relevantCandidates(rankers: Record<AgentToolSearchRankerName, AgentToolSearchRankMap>): Set<string> {
    return new Set((Object.keys(rankers) as AgentToolSearchRankerName[]).flatMap((name) => [...rankers[name].keys()]));
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
    const tokens = new Set(this.tokenizer.tokenizeContent(doc.anchorText));
    this.documentTokensByTool.set(doc.toolName, tokens);
    return tokens;
  }
}

interface RankInput {
  readonly name: string;
  readonly score: number;
}

/**
 * RRF ranks are ordinal evidence, so equal raw scores must share an ordinal.
 * Assigning an increasing index to ties manufactures a preference that was
 * never present in the channel and can split an otherwise flat semantic
 * frontier into artificial confidence bands.
 */
function toRankMap(entries: readonly RankInput[]): AgentToolSearchRankMap {
  const unique = new Map<string, RankInput>();
  for (const entry of entries) {
    const previous = unique.get(entry.name);
    if (!previous || entry.score > previous.score) unique.set(entry.name, entry);
  }

  const ordered = [...unique.values()];
  const ranks = new Map<string, number>();
  let rank = 0;
  let previousScore: number | undefined;
  ordered.forEach((entry, index) => {
    if (index === 0 || entry.score !== previousScore) rank = index + 1;
    ranks.set(entry.name, rank);
    previousScore = entry.score;
  });
  return ranks;
}

function toMemoryEvidenceMap(
  evidence: readonly AgentToolSearchMemoryEvidence[],
): Map<string, AgentToolSearchMemoryEvidence> {
  return new Map(evidence.map((entry) => [entry.toolName, entry]));
}
