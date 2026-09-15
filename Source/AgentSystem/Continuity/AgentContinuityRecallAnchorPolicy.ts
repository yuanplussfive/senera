import type { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import type { AgentContinuityRecallVocabulary } from "./AgentContinuityRecallVocabulary.js";
import { normalizeAgentContinuityRecallTerm } from "./AgentContinuityRecallVocabulary.js";
import { uniqueStrings } from "./AgentContinuitySqliteUtils.js";

export interface AgentContinuityRecallAnchorPolicy {
  /** Minimum number of code points for a phrase to count as an exact anchor. */
  readonly MinimumPhraseCharacters: number;
  /** Minimum number of code points for a token to carry lexical anchor evidence. */
  readonly MinimumTokenLength: number;
  /** Required weighted coverage of query terms for token evidence. */
  readonly MinimumQueryCoverage: number;
  /** Required weighted coverage of label terms for token evidence. */
  readonly MinimumLabelCoverage: number;
  /** Minimum number of informative shared terms for token evidence. */
  readonly MinimumInformativeTerms: number;
}

export const AgentContinuityRecallAnchorDefaults: AgentContinuityRecallAnchorPolicy = Object.freeze({
  MinimumPhraseCharacters: 2,
  MinimumTokenLength: 2,
  MinimumQueryCoverage: 0.25,
  MinimumLabelCoverage: 0.5,
  MinimumInformativeTerms: 1,
});

export type AgentContinuityRecallQueryMatchMethod = "phrase" | "token" | "fuzzy";

export interface AgentContinuityRecallLabelEvidence {
  readonly score: number;
  readonly direct: boolean;
  readonly matchedBy: readonly AgentContinuityRecallQueryMatchMethod[];
  readonly matchedTerms: readonly string[];
  readonly matchedLabel: string | undefined;
  readonly anchorEvidence: boolean;
}

export interface AgentContinuityRecallLabelEvidenceInput {
  readonly query: string;
  readonly queryTerms: readonly string[];
  readonly labels: readonly string[];
  readonly similarity: Pick<AgentContinuityTextSimilarity, "compare" | "contentTerms">;
  readonly vocabulary: AgentContinuityRecallVocabulary;
  readonly policy: AgentContinuityRecallAnchorPolicy;
}

/**
 * Scores a canonical label and its aliases without allowing one accidental
 * character or one fuzzy pair to become a direct graph anchor.
 */
export function scoreAgentContinuityRecallLabels(
  input: AgentContinuityRecallLabelEvidenceInput,
): AgentContinuityRecallLabelEvidence {
  const normalizedQuery = normalizeAgentContinuityRecallTerm(input.query);
  let best = emptyEvidence();
  for (const label of input.labels) {
    const normalizedLabel = normalizeAgentContinuityRecallTerm(label);
    if (!normalizedLabel) continue;

    const labelTerms = uniqueStrings(input.similarity.contentTerms(label).map(normalizeAgentContinuityRecallTerm));
    const queryTerms = uniqueStrings(input.queryTerms.map(normalizeAgentContinuityRecallTerm));
    const queryAnchorTerms = queryTerms.filter((term) => isAnchorTerm(term, input.policy, input.vocabulary));
    const labelAnchorTerms = labelTerms.filter((term) => isAnchorTerm(term, input.policy, input.vocabulary));
    const matchedTerms = queryAnchorTerms.filter((term) => labelAnchorTerms.includes(term));
    const queryCoverage = weightedCoverage(queryAnchorTerms, matchedTerms, input.vocabulary);
    const labelCoverage = weightedCoverage(labelAnchorTerms, matchedTerms, input.vocabulary);
    const tokenScore = f1Score(queryCoverage, labelCoverage);
    const phrase = phraseEvidence(normalizedQuery, normalizedLabel, input);
    const fuzzyScore = input.similarity.compare(input.query, label).score;
    const termFuzzyScore = aggregateTermFuzzy(queryAnchorTerms, labelAnchorTerms, input);
    const score = roundScore(Math.max(phrase.score, tokenScore, fuzzyScore, termFuzzyScore));
    const tokenEvidence =
      matchedTerms.length >= input.policy.MinimumInformativeTerms &&
      queryCoverage >= input.policy.MinimumQueryCoverage &&
      labelCoverage >= input.policy.MinimumLabelCoverage;
    const direct = phrase.direct || tokenEvidence;
    const matchedBy = [
      ...(phrase.direct ? (["phrase"] as const) : []),
      ...(matchedTerms.length > 0 ? (["token"] as const) : []),
      ...(score > 0 && !phrase.direct && matchedTerms.length === 0 ? (["fuzzy"] as const) : []),
    ];
    const evidence: AgentContinuityRecallLabelEvidence = {
      score,
      direct,
      matchedBy,
      matchedTerms,
      matchedLabel: displayLabel({
        query: input.query,
        label,
        phrase: phrase.label,
        matchedTerms,
      }),
      anchorEvidence: direct,
    };
    if (isBetterEvidence(evidence, best)) best = evidence;
  }
  return best;
}

export function isAnchorTerm(
  term: string,
  policy: AgentContinuityRecallAnchorPolicy,
  vocabulary: AgentContinuityRecallVocabulary,
): boolean {
  const normalized = normalizeAgentContinuityRecallTerm(term);
  return codePointLength(normalized) >= policy.MinimumTokenLength && vocabulary.isInformative(normalized);
}

function phraseEvidence(
  query: string,
  label: string,
  input: AgentContinuityRecallLabelEvidenceInput,
): { readonly score: number; readonly direct: boolean; readonly label: string | undefined } {
  if (!query || !label) return { score: 0, direct: false, label: undefined };
  const shorter = query.length <= label.length ? query : label;
  const longer = query.length <= label.length ? label : query;
  if (!longer.includes(shorter) || codePointLength(shorter) < input.policy.MinimumPhraseCharacters) {
    return { score: 0, direct: false, label: undefined };
  }
  const phraseTerms = input.similarity.contentTerms(shorter).map(normalizeAgentContinuityRecallTerm);
  const hasAnchorTerm = phraseTerms.some((term) => isAnchorTerm(term, input.policy, input.vocabulary));
  if (!hasAnchorTerm) return { score: 0, direct: false, label: undefined };
  return {
    score: query === label ? 1 : 1,
    direct: true,
    label: shorter,
  };
}

function aggregateTermFuzzy(
  queryTerms: readonly string[],
  labelTerms: readonly string[],
  input: AgentContinuityRecallLabelEvidenceInput,
): number {
  if (queryTerms.length === 0 || labelTerms.length === 0) return 0;
  const scores = queryTerms.map((queryTerm) =>
    Math.max(0, ...labelTerms.map((labelTerm) => input.similarity.compare(queryTerm, labelTerm).score)),
  );
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function weightedCoverage(
  terms: readonly string[],
  matchedTerms: readonly string[],
  vocabulary: AgentContinuityRecallVocabulary,
): number {
  if (terms.length === 0) return 0;
  const total = terms.reduce((sum, term) => sum + termWeight(term, vocabulary), 0);
  const matched = matchedTerms.reduce((sum, term) => sum + termWeight(term, vocabulary), 0);
  return total > 0 ? matched / total : 0;
}

function termWeight(term: string, vocabulary: AgentContinuityRecallVocabulary): number {
  const score = vocabulary.informationScore?.(term) ?? 1;
  return Number.isFinite(score) && score > 0 ? score : 1;
}

function f1Score(left: number, right: number): number {
  return left + right === 0 ? 0 : (2 * left * right) / (left + right);
}

function displayLabel(input: {
  readonly query: string;
  readonly label: string;
  readonly phrase: string | undefined;
  readonly matchedTerms: readonly string[];
}): string | undefined {
  if (input.phrase) return input.phrase;
  if (input.matchedTerms.length > 0) return input.matchedTerms.join(" ");
  return undefined;
}

function isBetterEvidence(
  candidate: AgentContinuityRecallLabelEvidence,
  current: AgentContinuityRecallLabelEvidence,
): boolean {
  return (
    candidate.score > current.score ||
    (candidate.score === current.score && Number(candidate.direct) > Number(current.direct)) ||
    (candidate.score === current.score &&
      candidate.direct === current.direct &&
      candidate.matchedBy.join() < current.matchedBy.join())
  );
}

function emptyEvidence(): AgentContinuityRecallLabelEvidence {
  return {
    score: 0,
    direct: false,
    matchedBy: [],
    matchedTerms: [],
    matchedLabel: undefined,
    anchorEvidence: false,
  };
}

function codePointLength(value: string): number {
  return [...value].length;
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(6));
}
