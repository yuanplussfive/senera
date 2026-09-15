import type { AgentContinuityObservation } from "./AgentContinuityDomain.js";
import {
  AgentContinuityRecallIndex,
  type AgentContinuityRecallIndexOptions,
  type AgentContinuityRecallIndexSession,
} from "./AgentContinuityRecallIndex.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import { AgentContinuityRecallRankingDefaults } from "./AgentContinuityRecallDefaults.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { fuseAgentContinuityScoreLists } from "./AgentContinuityScoreFusion.js";
import {
  buildAgentContinuityRecallVocabulary,
  type AgentContinuityRecallVocabulary,
} from "./AgentContinuityRecallVocabulary.js";

export type AgentContinuityMatchMethod = "text_similarity" | "lexical" | "exact_phrase" | "exact_ref" | "embedding";

export interface AgentContinuityRankedRecord {
  readonly observation: AgentContinuityObservation;
  readonly score: number;
  readonly textSimilarityScore: number;
  readonly lexicalScore: number;
  readonly semanticScore: number;
  readonly matchedBy: readonly AgentContinuityMatchMethod[];
  readonly projection: "direct" | "reference";
}

/** Passed the similarity gate but fell below the candidate threshold; surfaced for tuning only. */
export interface AgentContinuityNearMissRecord {
  readonly observation: AgentContinuityObservation;
  readonly score: number;
  readonly textSimilarityScore: number;
  readonly lexicalScore: number;
  readonly semanticScore: number;
  readonly matchedBy: readonly AgentContinuityMatchMethod[];
}

export interface AgentContinuityRankRejections {
  /** Evaluated but below the similarity/lexical floor. */
  readonly belowSimilarity: number;
  /** Evaluated but below the candidate threshold. */
  readonly belowCandidate: number;
  /** Skipped by the scale funnel before any similarity evaluation. */
  readonly funnelSkipped: number;
}

export interface AgentContinuityRankResult {
  readonly records: readonly AgentContinuityRankedRecord[];
  readonly nearMisses: readonly AgentContinuityNearMissRecord[];
  readonly rejections: AgentContinuityRankRejections;
}

export interface AgentContinuityRankInput {
  readonly query: string;
  /** Optional lexical-only variant. Similarity and direct projection always use query. */
  readonly lexicalQuery?: string;
  /** Additional lexical views; all are fused without changing text identity. */
  readonly lexicalQueries?: readonly string[];
  /** Optional unexpanded user text used for projection and exact-reference checks. */
  readonly directQuery?: string;
  readonly observations: readonly AgentContinuityObservation[];
  readonly sessionId?: string;
  readonly now?: Date;
  readonly cacheTtlMs?: number;
  readonly catalogRevision?: string;
  readonly catalogKey?: string;
  /** Optional additive semantic evidence keyed by observation uri; absent means pure lexical ranking. */
  readonly semanticScores?: ReadonlyMap<string, number>;
  /** Current fact-head lifetimes keyed by their selected observation URI. */
  readonly factValidUntilByObservationUri?: ReadonlyMap<string, string | null>;
}

export interface AgentContinuityRankSessionQuery {
  readonly query: string;
  readonly lexicalQuery?: string;
  readonly lexicalQueries?: readonly string[];
  readonly directQuery?: string;
  readonly semanticScores?: ReadonlyMap<string, number>;
}

export interface AgentContinuityRecordRankerSession {
  rank(input: AgentContinuityRankSessionQuery): AgentContinuityRankResult;
  rankEvents(input: AgentContinuityRankSessionQuery): AgentContinuityRankResult;
  /** The combined view shares corpus statistics across fact and physical-event recall. */
  lexicalVocabulary(mode?: "learning" | "event" | "combined"): AgentContinuityRecallVocabulary;
}

/** Ranks only learned records; raw conversation history is never a parallel recall source. */
export class AgentContinuityRecordRanker {
  private readonly similarity: AgentContinuityTextSimilarity;
  private readonly learningIndex: AgentContinuityRecallIndex;
  private readonly eventIndex: AgentContinuityRecallIndex;

  constructor(
    private readonly policy: ResolvedAgentContinuityRecallRankingConfig = AgentContinuityRecallRankingDefaults,
  ) {
    this.similarity = new AgentContinuityTextSimilarity(policy.Similarity);
    this.learningIndex = new AgentContinuityRecallIndex(this.similarity, policy.Lexical);
    this.eventIndex = new AgentContinuityRecallIndex(this.similarity, policy.Lexical);
  }

  warm(input: {
    readonly observations: readonly AgentContinuityObservation[];
    readonly eventObservations: readonly AgentContinuityObservation[];
    readonly cacheTtlMs?: number;
    readonly now?: Date;
    readonly catalogRevision?: string;
    readonly catalogKey?: string;
  }): void {
    const options: AgentContinuityRecallIndexOptions = {
      cacheTtlMs: input.cacheTtlMs,
      nowMs: input.now?.getTime(),
      catalogRevision: input.catalogRevision,
      catalogKey: input.catalogKey,
    };
    this.learningIndex.prepare(input.observations, options);
    this.eventIndex.prepare(input.eventObservations, options);
  }

  rank(input: AgentContinuityRankInput): AgentContinuityRankResult {
    return this.rankRecords(input, "learning");
  }

  rankEvents(input: AgentContinuityRankInput): AgentContinuityRankResult {
    return this.rankRecords(input, "event");
  }

  /**
   * Binds the catalog and request metadata once. Adaptive recall can then run
   * several lexical views without rebuilding the same MiniSearch snapshot for
   * each stage; the returned object is intentionally request-scoped.
   */
  openSession(input: {
    readonly observations: readonly AgentContinuityObservation[];
    readonly eventObservations: readonly AgentContinuityObservation[];
    readonly sessionId?: string;
    readonly now?: Date;
    readonly cacheTtlMs?: number;
    readonly catalogRevision?: string;
    readonly catalogKey?: string;
    readonly factValidUntilByObservationUri?: ReadonlyMap<string, string | null>;
  }): AgentContinuityRecordRankerSession {
    const indexOptions: AgentContinuityRecallIndexOptions = {
      nowMs: input.now?.getTime(),
      cacheTtlMs: input.cacheTtlMs,
      catalogRevision: input.catalogRevision,
      catalogKey: input.catalogKey,
    };
    const learningSession = this.learningIndex.openSession(input.observations, indexOptions);
    const eventSession = this.eventIndex.openSession(input.eventObservations, indexOptions);
    let combinedVocabulary: AgentContinuityRecallVocabulary | undefined;
    const bound = (query: AgentContinuityRankSessionQuery, mode: "learning" | "event"): AgentContinuityRankResult =>
      this.rankRecords(
        {
          ...query,
          observations: mode === "learning" ? input.observations : input.eventObservations,
          sessionId: input.sessionId,
          now: input.now,
          cacheTtlMs: input.cacheTtlMs,
          catalogRevision: input.catalogRevision,
          catalogKey: input.catalogKey,
          factValidUntilByObservationUri: input.factValidUntilByObservationUri,
        },
        mode,
        mode === "learning" ? learningSession : eventSession,
      );
    return {
      rank: (query) => bound(query, "learning"),
      rankEvents: (query) => bound(query, "event"),
      lexicalVocabulary: (mode = "learning") => {
        if (mode === "learning") return learningSession.vocabulary;
        if (mode === "event") return eventSession.vocabulary;
        combinedVocabulary ??= buildAgentContinuityRecallVocabulary(
          uniqueObservationsByUri([...input.observations, ...input.eventObservations]).map((observation) =>
            this.similarity.searchTerms([observation.summary, observation.searchText ?? ""].filter(Boolean).join("\n")),
          ),
        );
        return combinedVocabulary;
      },
    };
  }

  clear(catalogKey?: string): void {
    this.learningIndex.clear(catalogKey);
    this.eventIndex.clear(catalogKey);
  }

  /** Exposes the revision-bound lexical statistics to adaptive query stages. */
  lexicalVocabulary(input: {
    readonly observations: readonly AgentContinuityObservation[];
    readonly now?: Date;
    readonly cacheTtlMs?: number;
    readonly catalogRevision?: string;
    readonly catalogKey?: string;
    readonly mode?: "learning" | "event";
  }): AgentContinuityRecallVocabulary {
    const options = {
      nowMs: input.now?.getTime(),
      cacheTtlMs: input.cacheTtlMs,
      catalogRevision: input.catalogRevision,
      catalogKey: input.catalogKey,
    };
    return (input.mode === "event" ? this.eventIndex : this.learningIndex).vocabulary(input.observations, options);
  }

  private rankRecords(
    input: AgentContinuityRankInput,
    mode: "learning" | "event",
    lexicalSession?: AgentContinuityRecallIndexSession,
  ): AgentContinuityRankResult {
    const query = input.query.trim();
    if (!query) return emptyRankResult();
    const lexicalQueries = uniqueQueries([input.lexicalQuery?.trim() || query, ...(input.lexicalQueries ?? [])]);
    const directQuery = input.directQuery?.trim() || query;
    const now = input.now ?? new Date();
    const eligible = input.observations.filter((observation) =>
      isRecallEligible(observation, now, mode, input.factValidUntilByObservationUri),
    );
    // Keep the index catalog independent from the temporal eligibility view.
    // Expiring a fact must not rebuild the whole lexical index on every turn.
    const lexicalScores = this.lexicalScores(
      lexicalQueries,
      input.observations,
      input.now,
      input.cacheTtlMs,
      input.catalogRevision,
      input.catalogKey,
      mode,
      lexicalSession,
    );
    const evaluated = this.funnelEligible(directQuery, eligible, lexicalScores, input.semanticScores);
    const directScore = this.policy.DirectScore;

    const records: AgentContinuityRankedRecord[] = [];
    const nearMisses: AgentContinuityNearMissRecord[] = [];
    const rejections = { belowSimilarity: 0, belowCandidate: 0, funnelSkipped: eligible.length - evaluated.length };

    for (const observation of evaluated) {
      const similarity = this.similarity.compare(query, observation.summary);
      const directSimilarity =
        directQuery === query ? similarity : this.similarity.compare(directQuery, observation.summary);
      const lexicalScore = lexicalScores.get(observation.uri) ?? 0;
      const semanticScore = roundScore(input.semanticScores?.get(observation.uri) ?? 0);
      const exactReference = matchesExactReference(directQuery, observation);
      if (
        !exactReference &&
        Math.max(similarity.score, lexicalScore, semanticScore) < this.policy.MinimumTextSimilarityScore
      ) {
        rejections.belowSimilarity += 1;
        continue;
      }
      const score = weightedScore(
        {
          textSimilarity: similarity.score,
          lexical: lexicalScore,
          semantic: semanticScore,
          confidence: observation.confidence,
          authority: authorityScore(observation.authority, this.policy),
          scope:
            observation.scope.kind === "session" && observation.scope.id === input.sessionId
              ? this.policy.ScopeScores.sessionMatch
              : this.policy.ScopeScores.other,
          recency: recencyScore(observation.createdAtMs, now.getTime(), this.policy.RecencyHalfLifeDays),
        },
        this.policy,
      );
      const matchedBy: AgentContinuityMatchMethod[] = [
        ...(similarity.score > 0 ? (["text_similarity"] as const) : []),
        ...(lexicalScore > 0 ? (["lexical"] as const) : []),
        ...(similarity.exact > 0 ? (["exact_phrase"] as const) : []),
        ...(exactReference ? (["exact_ref"] as const) : []),
        ...(semanticScore > 0 ? (["embedding"] as const) : []),
      ];
      if (!exactReference && score < this.policy.CandidateScore) {
        rejections.belowCandidate += 1;
        if (score >= this.policy.NearMiss.MinimumScore) {
          nearMisses.push({
            observation,
            score: roundScore(score),
            textSimilarityScore: roundScore(similarity.score),
            lexicalScore: roundScore(lexicalScore),
            semanticScore,
            matchedBy,
          });
        }
        continue;
      }
      records.push({
        observation,
        score: roundScore(score),
        textSimilarityScore: roundScore(similarity.score),
        lexicalScore: roundScore(lexicalScore),
        semanticScore,
        matchedBy,
        projection:
          mode === "learning" &&
          (exactReference ||
            (score >= directScore &&
              directSimilarity.score >= this.policy.DirectTextSimilarityScore &&
              (directSimilarity.structuralMismatch ?? 0) === 0))
            ? "direct"
            : "reference",
      });
    }

    return {
      records: sortRanked(records),
      nearMisses: nearMisses.sort((left, right) => right.score - left.score).slice(0, this.policy.NearMiss.MaxEntries),
      rejections,
    };
  }

  /**
   * Below the funnel threshold every record is evaluated exactly as before.
   * Above it, lexical and available semantic candidates (each capped by the
   * configured broad-phase limit) plus exact references keep the expensive
   * character-similarity pass; the rest are counted as funnel skips.
   */
  private funnelEligible(
    query: string,
    eligible: readonly AgentContinuityObservation[],
    lexicalScores: ReadonlyMap<string, number>,
    semanticScores: ReadonlyMap<string, number> | undefined,
  ): readonly AgentContinuityObservation[] {
    const funnel = this.policy.Funnel;
    if (funnel.MinimumObservations <= 0 || eligible.length < funnel.MinimumObservations) return eligible;

    // Temporal validity is part of the candidate set.  Ranking the complete
    // catalog first lets expired or otherwise ineligible records consume the
    // lexical quota and hide a valid match.
    const eligibleUris = new Set(eligible.map((observation) => observation.uri));
    const candidateUris = new Set([
      ...topScoreUris(lexicalScores, funnel.MaxLexicalCandidates, eligibleUris),
      ...topScoreUris(semanticScores ?? new Map(), funnel.MaxLexicalCandidates, eligibleUris),
    ]);
    return eligible.filter(
      (observation) => candidateUris.has(observation.uri) || matchesExactReference(query, observation),
    );
  }

  private lexicalScores(
    queries: readonly string[],
    observations: readonly AgentContinuityObservation[],
    now: Date | undefined,
    cacheTtlMs: number | undefined,
    catalogRevision: string | undefined,
    catalogKey: string | undefined,
    mode: "learning" | "event",
    lexicalSession?: AgentContinuityRecallIndexSession,
  ): ReadonlyMap<string, number> {
    if (observations.length === 0) return new Map();
    if (lexicalSession) {
      return fuseAgentContinuityScoreLists(queries.map((query) => ({ scores: lexicalSession.scores(query) })));
    }
    const options = { nowMs: now?.getTime(), cacheTtlMs, catalogRevision, catalogKey };
    const index = mode === "learning" ? this.learningIndex : this.eventIndex;
    return fuseAgentContinuityScoreLists(
      queries.map((query) => ({ scores: index.scores(query, observations, options) })),
    );
  }
}

function uniqueQueries(queries: readonly string[]): string[] {
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
}

function uniqueObservationsByUri(
  observations: readonly AgentContinuityObservation[],
): readonly AgentContinuityObservation[] {
  const records = new Map<string, AgentContinuityObservation>();
  for (const observation of observations) {
    const existing = records.get(observation.uri);
    if (!existing || observationTextLength(observation) > observationTextLength(existing)) {
      records.set(observation.uri, observation);
    }
  }
  return [...records.values()];
}

function observationTextLength(observation: AgentContinuityObservation): number {
  return observation.summary.length + (observation.searchText?.length ?? 0);
}

function topScoreUris(
  scores: ReadonlyMap<string, number>,
  limit: number,
  allowedUris?: ReadonlySet<string>,
): readonly string[] {
  return [...scores.entries()]
    .filter(([uri]) => allowedUris === undefined || allowedUris.has(uri))
    .filter(([, score]) => Number.isFinite(score) && score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([uri]) => uri);
}

function emptyRankResult(): AgentContinuityRankResult {
  return {
    records: [],
    nearMisses: [],
    rejections: { belowSimilarity: 0, belowCandidate: 0, funnelSkipped: 0 },
  };
}

function sortRanked(records: readonly AgentContinuityRankedRecord[]): AgentContinuityRankedRecord[] {
  return [...records].sort(
    (left, right) =>
      right.score - left.score ||
      right.observation.createdAtMs - left.observation.createdAtMs ||
      left.observation.uri.localeCompare(right.observation.uri),
  );
}

function isRecallEligible(
  observation: AgentContinuityObservation,
  now: Date,
  mode: "learning" | "event",
  factValidUntilByObservationUri?: ReadonlyMap<string, string | null>,
): boolean {
  if (mode === "event") return true;
  const payload = observation.payload;
  if (payload.kind !== "fact") return false;
  if (factValidUntilByObservationUri) {
    if (!factValidUntilByObservationUri.has(observation.uri)) return false;
    const validUntil = factValidUntilByObservationUri.get(observation.uri);
    return (
      validUntil === null ||
      (validUntil !== undefined && Number.isFinite(Date.parse(validUntil)) && Date.parse(validUntil) >= now.getTime())
    );
  }
  const until = payload.until;
  return (
    typeof until !== "string" ||
    until === "session" ||
    until === "permanent" ||
    (Number.isFinite(Date.parse(until)) && Date.parse(until) >= now.getTime())
  );
}

function weightedScore(
  input: {
    textSimilarity: number;
    lexical: number;
    semantic: number;
    confidence: number;
    authority: number;
    scope: number;
    recency: number;
  },
  policy: ResolvedAgentContinuityRecallRankingConfig,
): number {
  const weights = policy.Weights;
  const weightedValues = [
    [input.textSimilarity, weights.TextSimilarity],
    [input.lexical, weights.Lexical],
    [input.semantic, weights.Semantic],
    [input.confidence, weights.Confidence],
    [input.authority, weights.Authority],
    [input.scope, weights.Scope],
    [input.recency, weights.Recency],
  ] as const;
  const totalWeight = weightedValues.reduce((sum, [, weight]) => sum + weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return 0;
  return weightedValues.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;
}

function authorityScore(
  authority: AgentContinuityObservation["authority"],
  policy: ResolvedAgentContinuityRecallRankingConfig,
): number {
  return policy.AuthorityScores[authority];
}

function recencyScore(createdAtMs: number, nowMs: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, nowMs - createdAtMs) / 86_400_000;
  return 2 ** (-ageDays / halfLifeDays);
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(6));
}

function matchesExactReference(query: string, observation: AgentContinuityObservation): boolean {
  const normalizedQuery = query.trim().normalize("NFKC").toLocaleLowerCase();
  if (!normalizedQuery) return false;
  return [
    observation.id,
    observation.uri,
    observation.watermark,
    ...observation.sourceRefs,
    readPayloadReference(observation.payload, "factKey"),
    readPayloadReference(observation.payload, "target"),
  ].some((reference) => reference?.trim().normalize("NFKC").toLocaleLowerCase() === normalizedQuery);
}

function readPayloadReference(payload: Record<string, unknown>, key: string): string | undefined {
  return typeof payload[key] === "string" ? payload[key] : undefined;
}
