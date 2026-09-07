import fuzzysort from "fuzzysort";
import MiniSearch from "minisearch";
import type { AgentContinuityObservation } from "./AgentContinuityDomain.js";
import type { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import { projectAgentContinuityRecallDocument } from "./AgentContinuityRecallDocument.js";
import { AgentContinuityRecallRankingDefaults } from "./AgentContinuityRecallDefaults.js";
import {
  buildAgentContinuityRecallVocabulary,
  normalizeAgentContinuityRecallTerm,
  type AgentContinuityRecallVocabulary,
} from "./AgentContinuityRecallVocabulary.js";
import { uniqueStrings } from "./AgentContinuitySqliteUtils.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";

type SearchDocument = ReturnType<typeof projectAgentContinuityRecallDocument>;
type RecallIndexSnapshot = {
  readonly fingerprint: string;
  readonly catalogRevision?: string;
  readonly catalogKey?: string;
  readonly builtAtMs: number;
  readonly index: MiniSearch<SearchDocument>;
  readonly documents: ReadonlyMap<string, SearchDocument>;
  readonly documentTerms: ReadonlyMap<string, readonly string[]>;
  readonly vocabulary: AgentContinuityRecallVocabulary;
  /** Query results are immutable for a catalog revision and safe to reuse. */
  readonly queryScores: Map<string, ReadonlyMap<string, number>>;
};

export const AgentContinuityRecallIndexDefaults = Object.freeze({
  queryCacheEntries: 128,
  snapshotEntries: 64,
});

export interface AgentContinuityRecallIndexSession {
  readonly vocabulary: AgentContinuityRecallVocabulary;
  scores(query: string): ReadonlyMap<string, number>;
  scoresForQueries(queries: readonly string[]): readonly ReadonlyMap<string, number>[];
}

export interface AgentContinuityRecallIndexOptions {
  readonly nowMs?: number;
  readonly cacheTtlMs?: number;
  readonly catalogRevision?: string;
  readonly catalogKey?: string;
}

/** Caches the deterministic lexical index until its observations or TTL change. */
export class AgentContinuityRecallIndex {
  private readonly snapshots = new Map<string, RecallIndexSnapshot>();

  constructor(
    private readonly similarity: Pick<AgentContinuityTextSimilarity, "terms" | "searchTerms">,
    private readonly lexical: ResolvedAgentContinuityRecallRankingConfig["Lexical"] = AgentContinuityRecallRankingDefaults.Lexical,
  ) {}

  prepare(
    observations: readonly AgentContinuityObservation[],
    options: AgentContinuityRecallIndexOptions = {},
  ): RecallIndexSnapshot {
    const nowMs = options.nowMs ?? Date.now();
    const cacheTtlMs = options.cacheTtlMs ?? 0;
    const entries = observations
      .map(projectAgentContinuityRecallDocument)
      .sort((left, right) => left.id.localeCompare(right.id) || left.summary.localeCompare(right.summary));
    const fingerprint = entries
      .map((entry) => `${entry.id}\u0000${entry.summary}\u0000${entry.searchText}\u0000${entry.metadata}`)
      .join("\u0001");
    this.removeExpired(nowMs, cacheTtlMs);
    const catalogKey = options.catalogKey;
    const cached = catalogKey === undefined ? undefined : this.snapshots.get(catalogKey);
    if (cacheTtlMs > 0 && cached && nowMs - cached.builtAtMs <= cacheTtlMs) {
      const sameRevision =
        options.catalogRevision !== undefined &&
        cached.catalogRevision !== undefined &&
        cached.catalogRevision === options.catalogRevision;
      const sameFingerprint = options.catalogRevision === undefined && cached.fingerprint === fingerprint;
      if ((sameRevision || sameFingerprint) && cached.catalogKey === options.catalogKey) {
        if (catalogKey !== undefined) {
          this.snapshots.delete(catalogKey);
          this.snapshots.set(catalogKey, cached);
        }
        return cached;
      }
    }

    const index = new MiniSearch<SearchDocument>({
      fields: ["summary", "searchText", "metadata"],
      storeFields: ["id"],
      tokenize: (text) => this.similarity.searchTerms(text),
      processTerm: (term) => term,
      searchOptions: {
        boost: { summary: this.lexical.SummaryBoost },
        prefix: this.lexical.Prefix,
        fuzzy: this.lexical.Fuzzy,
        combineWith: this.lexical.CombineWith,
      },
    });
    index.addAll(entries);
    const documentTerms = new Map(
      entries.map(
        (entry) =>
          [
            entry.id,
            uniqueStrings(
              this.similarity
                .searchTerms(`${entry.summary}\n${entry.searchText}\n${entry.metadata}`)
                .map(normalizeAgentContinuityRecallTerm),
            ),
          ] as const,
      ),
    );
    const snapshot = {
      fingerprint,
      catalogRevision: options.catalogRevision,
      catalogKey: options.catalogKey,
      builtAtMs: nowMs,
      index,
      documents: new Map(entries.map((entry) => [entry.id, entry] as const)),
      documentTerms,
      vocabulary: buildAgentContinuityRecallVocabulary([...documentTerms.values()]),
      queryScores: new Map<string, ReadonlyMap<string, number>>(),
    } satisfies RecallIndexSnapshot;
    if (cacheTtlMs > 0) {
      if (options.catalogKey !== undefined) {
        this.snapshots.delete(options.catalogKey);
        this.snapshots.set(options.catalogKey, snapshot);
        while (this.snapshots.size > AgentContinuityRecallIndexDefaults.snapshotEntries) {
          const oldest = this.snapshots.keys().next().value;
          if (oldest === undefined) break;
          this.snapshots.delete(oldest);
        }
      }
    }
    return snapshot;
  }

  scores(
    query: string,
    observations: readonly AgentContinuityObservation[],
    options: AgentContinuityRecallIndexOptions = {},
  ): ReadonlyMap<string, number> {
    return this.openSession(observations, options).scores(query);
  }

  /**
   * Opens a request-scoped scorer.  The prepared snapshot and lazy query
   * results live only for the caller's session when cross-request caching is
   * disabled, so adaptive stages can share work without retaining stale data.
   */
  openSession(
    observations: readonly AgentContinuityObservation[],
    options: AgentContinuityRecallIndexOptions = {},
  ): AgentContinuityRecallIndexSession {
    let snapshot: RecallIndexSnapshot | undefined;
    const getSnapshot = (): RecallIndexSnapshot => (snapshot ??= this.prepare(observations, options));
    const score = (query: string): ReadonlyMap<string, number> => {
      if (!normalizeQuery(query)) return new Map();
      return this.scoreSnapshot(getSnapshot(), query);
    };
    return {
      get vocabulary() {
        return getSnapshot().vocabulary;
      },
      scores: score,
      // Keep one result per input query, including empty queries, so callers
      // can safely correlate each score map with its original position.
      scoresForQueries: (queries) => queries.map(score),
    };
  }

  /** Uses one prepared snapshot for a batch of independent lexical views. */
  scoresForQueries(
    queries: readonly string[],
    observations: readonly AgentContinuityObservation[],
    options: AgentContinuityRecallIndexOptions = {},
  ): readonly ReadonlyMap<string, number>[] {
    return this.openSession(observations, options).scoresForQueries(queries);
  }

  private scoreSnapshot(snapshot: RecallIndexSnapshot, query: string): ReadonlyMap<string, number> {
    const cacheKey = normalizeQuery(query);
    if (!cacheKey) return new Map();
    const cached = snapshot.queryScores.get(cacheKey);
    if (cached) {
      // Keep the bounded query cache true to its LRU contract.
      snapshot.queryScores.delete(cacheKey);
      snapshot.queryScores.set(cacheKey, cached);
      return cached;
    }
    const results = snapshot.index.search(cacheKey);
    const queryTerms = uniqueStrings(this.similarity.terms(query).map(normalizeAgentContinuityRecallTerm));
    const broadQueryTerms = uniqueStrings(this.similarity.searchTerms(query).map(normalizeAgentContinuityRecallTerm));
    const scores = new Map(
      results.flatMap((result) => {
        const id = String(result.id);
        const document = snapshot.documents.get(id);
        if (!document) return [];
        const score = Math.max(
          lexicalCoverage(queryTerms, document, this.similarity, snapshot.vocabulary, snapshot.documentTerms.get(id)),
          lexicalCoverage(
            broadQueryTerms,
            document,
            this.similarity,
            snapshot.vocabulary,
            snapshot.documentTerms.get(id),
          ),
        );
        return score > 0 ? ([[id, score]] as const) : [];
      }),
    );
    snapshot.queryScores.set(cacheKey, scores);
    while (snapshot.queryScores.size > AgentContinuityRecallIndexDefaults.queryCacheEntries) {
      const oldest = snapshot.queryScores.keys().next().value;
      if (oldest === undefined) break;
      snapshot.queryScores.delete(oldest);
    }
    return scores;
  }

  /** Returns the revision-bound vocabulary used by lexical scoring. */
  vocabulary(
    observations: readonly AgentContinuityObservation[],
    options: AgentContinuityRecallIndexOptions = {},
  ): AgentContinuityRecallVocabulary {
    return this.openSession(observations, options).vocabulary;
  }

  clear(catalogKey?: string): void {
    if (catalogKey === undefined) {
      this.snapshots.clear();
      return;
    }
    this.snapshots.delete(catalogKey);
  }

  private removeExpired(nowMs: number, cacheTtlMs: number): void {
    // A non-caching request must not evict a separately warmed snapshot.  Its
    // own open session remains ephemeral, while the next positive-TTL call
    // still performs the normal age check.
    if (cacheTtlMs <= 0 || cacheTtlMs === Number.POSITIVE_INFINITY) return;
    for (const [key, snapshot] of this.snapshots) {
      if (nowMs - snapshot.builtAtMs > cacheTtlMs) this.snapshots.delete(key);
    }
  }
}

function lexicalCoverage(
  queryTerms: readonly string[],
  document: SearchDocument,
  similarity: Pick<AgentContinuityTextSimilarity, "terms" | "searchTerms">,
  vocabulary: AgentContinuityRecallVocabulary,
  documentTerms?: readonly string[],
): number {
  if (queryTerms.length === 0) return 0;
  const targetTerms =
    documentTerms ??
    uniqueStrings(
      similarity
        .searchTerms(`${document.summary}\n${document.searchText}\n${document.metadata}`)
        .map(normalizeAgentContinuityRecallTerm),
    );
  const terms = queryTerms.filter((term) => vocabulary.isInformative(term));
  if (terms.length === 0) return 0;
  const totalWeight = terms.reduce((sum, term) => sum + termWeight(term, vocabulary), 0);
  const matchedWeight = terms.reduce((sum, term) => {
    const weight = termWeight(term, vocabulary);
    if (targetTerms.includes(term)) return sum + weight;
    return sum + weight * bestFuzzyTermScore(term, targetTerms);
  }, 0);
  return totalWeight > 0 ? roundScore(matchedWeight / totalWeight) : 0;
}

function bestFuzzyTermScore(queryTerm: string, targetTerms: readonly string[]): number {
  return targetTerms.reduce(
    (best, targetTerm) => Math.max(best, fuzzysort.single(queryTerm, fuzzysort.prepare(targetTerm))?.score ?? 0),
    0,
  );
}

function termWeight(term: string, vocabulary: AgentContinuityRecallVocabulary): number {
  const score = vocabulary.informationScore?.(term) ?? 1;
  return Number.isFinite(score) && score > 0 ? score : 1;
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(6));
}

function normalizeQuery(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}
