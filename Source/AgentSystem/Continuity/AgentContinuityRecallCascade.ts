import type { AgentContinuityObservation } from "./AgentContinuityDomain.js";
import type {
  AgentContinuityNearMissRecord,
  AgentContinuityRankResult,
  AgentContinuityRankedRecord,
} from "./AgentContinuityRecordRanker.js";
import type { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import type { AgentContinuityRecallVocabulary } from "./AgentContinuityRecallVocabulary.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";

/**
 * Bounded, model-free expansion limits. The limits are derived from the
 * caller's existing recall and prompt budgets; they are not tied to a domain
 * vocabulary or a particular tool/provider.
 */
export interface AgentContinuityRecallCascadeLimits {
  readonly maxStages: number;
  readonly maxTerms: number;
  readonly maxCharacters: number;
  readonly maxSeedRecords: number;
  readonly minSeedScore: number;
}

export const AgentContinuityRecallCascadeDefaults = Object.freeze({
  maxStages: 2,
  qualityEpsilon: 1e-6,
});

export interface AgentContinuityRecallQuality {
  readonly acceptedCount: number;
  readonly candidateCount: number;
  readonly nearMissCount: number;
  readonly topScore: number;
  readonly topMargin: number;
  /** Records carrying evidence from the unexpanded request or an exact ref. */
  readonly directEvidenceCount: number;
  /** Accepted records introduced only by an adaptive lexical view. */
  readonly expansionOnlyCount: number;
}

export interface AgentContinuityRecallLexicalVariant {
  readonly query: string;
  readonly addedTerms: readonly string[];
  readonly source: "context" | "feedback";
}

export interface AgentContinuityRecallCascadeStage {
  readonly source: "baseline" | "context" | "feedback" | "semantic";
  readonly triggered: boolean;
  readonly addedTerms: number;
  readonly quality: AgentContinuityRecallQuality;
}

/**
 * Derives adaptive limits from already-resolved policy values. Keeping this
 * derivation in one place avoids hidden per-call constants and keeps prompt
 * growth bounded when a user increases the catalog size.
 */
export function deriveAgentContinuityRecallCascadeLimits(
  ranking: ResolvedAgentContinuityRecallRankingConfig,
  promptBudget: {
    readonly MaxCharacters: number;
    readonly MaxRelationEntries: number;
    readonly MaxEventEntries: number;
    readonly MaxEvidenceEntries: number;
  },
): AgentContinuityRecallCascadeLimits {
  const candidateLimit = positiveBound(ranking.Funnel.MaxLexicalCandidates);
  const termLimit = positiveBound(Math.min(candidateLimit, promptBudget.MaxRelationEntries));
  const characterLimit = positiveBound(promptBudget.MaxCharacters);
  const seedLimit = positiveBound(
    Math.min(candidateLimit, promptBudget.MaxEventEntries + promptBudget.MaxEvidenceEntries),
  );
  return {
    // Two bounded local stages are enough to recover context without turning
    // every turn into an unbounded query-expansion loop.
    maxStages: AgentContinuityRecallCascadeDefaults.maxStages,
    maxTerms: termLimit,
    maxCharacters: characterLimit,
    maxSeedRecords: seedLimit,
    minSeedScore: Math.max(ranking.CandidateScore, ranking.MinimumTextSimilarityScore),
  };
}

/** Combines learning and event ranking diagnostics without exposing records. */
export function assessAgentContinuityRecallQuality(
  results: readonly (AgentContinuityRankResult | undefined)[],
  options: { readonly minimumTextSimilarityScore?: number } = {},
): AgentContinuityRecallQuality {
  // A record can be projected by both the learning and event views.  Count it
  // once so duplicate projections cannot manufacture confidence or margin.
  const acceptedByUri = new Map<string, AgentContinuityRankedRecord>();
  const nearMissByUri = new Map<string, AgentContinuityNearMissRecord>();
  for (const result of results) {
    for (const record of result?.records ?? []) {
      const previous = acceptedByUri.get(record.observation.uri);
      acceptedByUri.set(record.observation.uri, previous ? mergeRankedRecords(previous, record) : record);
    }
    for (const record of result?.nearMisses ?? []) {
      const previous = nearMissByUri.get(record.observation.uri);
      nearMissByUri.set(record.observation.uri, previous ? mergeNearMissRecords(previous, record) : record);
    }
  }
  const accepted = [...acceptedByUri.values()];
  const nearMisses = [...nearMissByUri.entries()]
    .filter(([uri]) => !acceptedByUri.has(uri))
    .map(([, record]) => record);
  const candidates = [...accepted, ...nearMisses].sort(compareCandidateScore);
  // Near misses are useful diagnostics, but they are not accepted evidence
  // and must not manufacture a stronger lead or margin for the next stage.
  const acceptedRanking = [...accepted].sort(compareCandidateScore);
  const topScore = acceptedRanking[0]?.score ?? 0;
  const secondScore = acceptedRanking[1]?.score ?? 0;
  const similarityFloor = options.minimumTextSimilarityScore;
  const directEvidenceCount = accepted.filter((record) => isDirectEvidence(record, similarityFloor)).length;
  return {
    acceptedCount: accepted.length,
    candidateCount: candidates.length,
    nearMissCount: nearMisses.length,
    topScore,
    // A sole candidate has no ambiguity; its score is the available margin.
    topMargin: candidates.length <= 1 ? topScore : Math.max(0, topScore - secondScore),
    directEvidenceCount,
    expansionOnlyCount: Math.max(0, accepted.length - directEvidenceCount),
  };
}

/**
 * Expands only when the baseline has no accepted result or has an ambiguous
 * candidate set. Exact/direct hits and a well-separated candidate do not
 * spend another local stage.
 */
export function shouldExpandAgentContinuityRecall(
  quality: AgentContinuityRecallQuality,
  ranking: Pick<ResolvedAgentContinuityRecallRankingConfig, "MinimumTextSimilarityScore" | "CandidateScore">,
): boolean {
  if (quality.acceptedCount === 0) return true;
  // An expansion-only hit is useful, but it is not yet a grounded answer.
  // Give the next bounded stage a chance to find direct evidence.
  if (quality.directEvidenceCount === 0 && quality.expansionOnlyCount > 0) return true;
  const marginFloor = Math.max(
    ranking.MinimumTextSimilarityScore,
    ranking.CandidateScore - ranking.MinimumTextSimilarityScore,
  );
  return quality.topMargin < marginFloor;
}

/** Returns true only when a candidate stage is strictly safer or more useful. */
export function isAgentContinuityRecallQualityImproved(
  candidate: AgentContinuityRecallQuality,
  current: AgentContinuityRecallQuality,
): boolean {
  const epsilon = AgentContinuityRecallCascadeDefaults.qualityEpsilon;
  // A stage may add recall only if it does not weaken already-grounded
  // evidence or make the candidate ordering materially less decisive.
  if (candidate.directEvidenceCount < current.directEvidenceCount) return false;
  if (candidate.topScore + epsilon < current.topScore) return false;
  if (candidate.topMargin + epsilon < current.topMargin) {
    const directGain = candidate.directEvidenceCount - current.directEvidenceCount;
    const topGain = candidate.topScore - current.topScore;
    // A wider set is acceptable only when it also produces a meaningfully
    // stronger direct signal. Otherwise a weak expansion could take the lead
    // merely by changing the rank distribution.
    if (directGain <= 0 || topGain <= epsilon) return false;
  }
  // Near misses are diagnostics, never a positive quality signal.  Require a
  // real gain in grounded recall or ranking quality; otherwise a noisy probe
  // that only adds weak candidates would be accepted as an improvement.
  return (
    candidate.directEvidenceCount > current.directEvidenceCount ||
    candidate.acceptedCount > current.acceptedCount ||
    candidate.topScore > current.topScore + epsilon ||
    candidate.topMargin > current.topMargin + epsilon
  );
}

/**
 * Keeps already-selected records and their lead position stable while a new
 * lexical view is evaluated. A newly introduced expansion-only record may be
 * appended, but it cannot displace a grounded baseline record at the top.
 */
export function preservesAgentContinuityRecallBaseline(
  current: readonly (AgentContinuityRankResult | undefined)[],
  candidate: readonly (AgentContinuityRankResult | undefined)[],
  minimumTextSimilarityScore: number,
): boolean {
  const baselineRecords = current.flatMap((result) => result?.records ?? []);
  const candidateRecords = candidate.flatMap((result) => result?.records ?? []);
  const baselineByUri = mergeRankedRecordMap(baselineRecords);
  const candidateByUri = mergeRankedRecordMap(candidateRecords);
  const groundedBaselineUris = new Set(
    [...baselineByUri.values()]
      .filter((record) => isDirectEvidence(record, minimumTextSimilarityScore))
      .map((record) => record.observation.uri),
  );
  for (const [uri, baseline] of baselineByUri) {
    const replacement = candidateByUri.get(uri);
    if (!replacement) return false;
    if (replacement.score + AgentContinuityRecallCascadeDefaults.qualityEpsilon < baseline.score) return false;
    if (
      isDirectEvidence(baseline, minimumTextSimilarityScore) &&
      !isDirectEvidence(replacement, minimumTextSimilarityScore)
    ) {
      return false;
    }
  }
  const candidateRankedRecords = [...candidateByUri.values()];
  const hasGroundedBaseline = groundedBaselineUris.size > 0;
  if (!hasGroundedBaseline || candidateRecords.length === 0) return true;
  const lead = candidateRankedRecords.sort(compareRankedRecords)[0];
  if (!lead) return true;
  return isDirectEvidence(lead, minimumTextSimilarityScore) || groundedBaselineUris.has(lead.observation.uri);
}

/** Merges two projections of one observation without losing channel evidence. */
export function mergeAgentContinuityRankedRecordsByObservationUri(
  records: readonly AgentContinuityRankedRecord[],
): AgentContinuityRankedRecord[] {
  return [...mergeRankedRecordMap(records).values()].sort(compareRankedRecords);
}

/** Builds a lexical-only variant from grounded current-context text. */
export function buildAgentContinuityContextVariant(input: {
  readonly query: string;
  readonly contexts: readonly string[];
  readonly similarity: Pick<AgentContinuityTextSimilarity, "searchTerms"> &
    Partial<Pick<AgentContinuityTextSimilarity, "contentTerms">>;
  readonly vocabulary?: AgentContinuityRecallVocabulary;
  readonly maxTerms: number;
  readonly maxCharacters: number;
}): AgentContinuityRecallLexicalVariant | undefined {
  const query = input.query.trim();
  if (!query || input.maxTerms <= 0 || input.maxCharacters <= 0) return undefined;
  const queryTerms = new Set(normalizeTerms(input.similarity.searchTerms(query)));
  const seen = new Set<string>();
  const candidates: { readonly term: string; readonly order: number; readonly information: number }[] = [];
  let order = 0;
  const tokenize = (value: string): readonly string[] =>
    input.similarity.contentTerms ? input.similarity.contentTerms(value) : input.similarity.searchTerms(value);
  for (const context of input.contexts) {
    for (const term of normalizeTerms(tokenize(context))) {
      if (queryTerms.has(term) || seen.has(term) || !isExpansionTerm(term)) {
        order += 1;
        continue;
      }
      seen.add(term);
      candidates.push({
        term,
        order,
        information: input.vocabulary?.informationScore?.(term) ?? 0,
      });
      order += 1;
    }
  }
  const terms = candidates
    .filter(({ term }) => input.vocabulary?.isInformative?.(term) ?? true)
    .sort(
      (left, right) =>
        right.information - left.information ||
        codePointLength(right.term) - codePointLength(left.term) ||
        left.order - right.order,
    )
    .slice(0, input.maxTerms)
    .map(({ term }) => term);
  return createVariant(query, terms, "context", input.maxCharacters);
}

/**
 * Builds one-round pseudo-relevance feedback from accepted lexical/text
 * candidates. Semantic-only candidates and empty/low-confidence observations
 * are deliberately excluded so an unavailable vector channel cannot steer
 * local retrieval.
 */
export function buildAgentContinuityFeedbackVariant(input: {
  readonly query: string;
  readonly seeds: readonly AgentContinuityRankedRecord[];
  readonly corpus: readonly AgentContinuityObservation[];
  readonly similarity: Pick<AgentContinuityTextSimilarity, "contentTerms">;
  readonly vocabulary?: AgentContinuityRecallVocabulary;
  readonly maxSeedRecords: number;
  readonly maxTerms: number;
  readonly maxCharacters: number;
  readonly minSeedScore: number;
}): AgentContinuityRecallLexicalVariant | undefined {
  const query = input.query.trim();
  if (!query || input.maxSeedRecords <= 0 || input.maxTerms <= 0 || input.maxCharacters <= 0) return undefined;
  const queryTerms = new Set(normalizeTerms(input.similarity.contentTerms(query)));
  const seeds = input.seeds
    .filter((record) => record.score >= input.minSeedScore && record.observation.confidence > 0)
    .filter((record) => record.lexicalScore > 0)
    .filter((record) => record.matchedBy.some((method) => method !== "embedding"))
    .sort(compareRankedRecords)
    .slice(0, input.maxSeedRecords);
  if (seeds.length === 0) return undefined;

  const termScores = new Map<string, { score: number; order: number }>();
  let termOrder = 0;
  for (const seed of seeds) {
    const seedTerms = new Set(normalizeTerms(input.similarity.contentTerms(seed.observation.summary)));
    for (const term of seedTerms) {
      if (queryTerms.has(term) || !isExpansionTerm(term)) continue;
      const information =
        input.vocabulary?.informationScore?.(term) ?? corpusInformation(term, input.corpus, input.similarity);
      const contribution = Math.max(0, seed.score) * Math.max(0, seed.observation.confidence) * information;
      const previous = termScores.get(term);
      termScores.set(term, {
        score: (previous?.score ?? 0) + contribution,
        order: previous?.order ?? termOrder++,
      });
    }
  }
  const terms = [...termScores.entries()]
    .sort((left, right) => right[1].score - left[1].score || left[1].order - right[1].order)
    .slice(0, input.maxTerms)
    .map(([term]) => term);
  return createVariant(query, terms, "feedback", input.maxCharacters);
}

function createVariant(
  query: string,
  terms: readonly string[],
  source: AgentContinuityRecallLexicalVariant["source"],
  maxCharacters: number,
): AgentContinuityRecallLexicalVariant | undefined {
  const addedTerms: string[] = [];
  let expanded = query;
  for (const term of terms) {
    const candidate = `${expanded}\n${term}`;
    if ([...candidate].length > maxCharacters) break;
    expanded = candidate;
    addedTerms.push(term);
  }
  return addedTerms.length > 0 ? { query: expanded, addedTerms, source } : undefined;
}

function corpusInformation(
  term: string,
  corpus: readonly AgentContinuityObservation[],
  similarity: Pick<AgentContinuityTextSimilarity, "contentTerms">,
): number {
  const documentFrequency = corpus.reduce(
    (count, observation) =>
      new Set(normalizeTerms(similarity.contentTerms(observation.summary))).has(term) ? count + 1 : count,
    0,
  );
  return Math.log((corpus.length + 1) / (documentFrequency + 1)) + 1;
}

function normalizeTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.map((term) => term.trim().normalize("NFKC").toLocaleLowerCase()).filter(Boolean))];
}

function isExpansionTerm(term: string): boolean {
  return [...term].length > 1 || /[\p{L}\p{N}]/u.test(term);
}

function codePointLength(value: string): number {
  return [...value].length;
}

function positiveBound(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function compareCandidateScore(
  left: AgentContinuityRankedRecord | AgentContinuityNearMissRecord,
  right: AgentContinuityRankedRecord | AgentContinuityNearMissRecord,
): number {
  return right.score - left.score;
}

function compareRankedRecords(left: AgentContinuityRankedRecord, right: AgentContinuityRankedRecord): number {
  return right.score - left.score || right.observation.createdAtMs - left.observation.createdAtMs;
}

function mergeRankedRecordMap(
  records: readonly AgentContinuityRankedRecord[],
): Map<string, AgentContinuityRankedRecord> {
  const merged = new Map<string, AgentContinuityRankedRecord>();
  for (const record of records) {
    const previous = merged.get(record.observation.uri);
    merged.set(record.observation.uri, previous ? mergeRankedRecords(previous, record) : record);
  }
  return merged;
}

function mergeRankedRecords(
  left: AgentContinuityRankedRecord,
  right: AgentContinuityRankedRecord,
): AgentContinuityRankedRecord {
  const preferred = compareRankedRecords(left, right) <= 0 ? left : right;
  return {
    ...preferred,
    score: Math.max(left.score, right.score),
    textSimilarityScore: Math.max(left.textSimilarityScore, right.textSimilarityScore),
    lexicalScore: Math.max(left.lexicalScore, right.lexicalScore),
    semanticScore: Math.max(left.semanticScore, right.semanticScore),
    matchedBy: [...new Set([...left.matchedBy, ...right.matchedBy])],
    projection: left.projection === "direct" || right.projection === "direct" ? "direct" : "reference",
  };
}

function mergeNearMissRecords(
  left: AgentContinuityNearMissRecord,
  right: AgentContinuityNearMissRecord,
): AgentContinuityNearMissRecord {
  const preferred = left.score >= right.score ? left : right;
  return {
    ...preferred,
    score: Math.max(left.score, right.score),
    textSimilarityScore: Math.max(left.textSimilarityScore, right.textSimilarityScore),
    lexicalScore: Math.max(left.lexicalScore, right.lexicalScore),
    semanticScore: Math.max(left.semanticScore, right.semanticScore),
    matchedBy: [...new Set([...left.matchedBy, ...right.matchedBy])],
  };
}

function isDirectEvidence(record: AgentContinuityRankedRecord, minimumTextSimilarityScore?: number): boolean {
  if (record.matchedBy.includes("exact_ref") || record.matchedBy.includes("exact_phrase")) return true;
  if (!record.matchedBy.includes("text_similarity")) return false;
  return minimumTextSimilarityScore === undefined || record.textSimilarityScore >= minimumTextSimilarityScore;
}
