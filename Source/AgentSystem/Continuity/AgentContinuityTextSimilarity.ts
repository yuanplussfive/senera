import fuzzysort from "fuzzysort";
import { AgentToolSearchTokenizer, type AgentToolSearchTaggedToken } from "../ToolSearch/AgentToolSearchTokenizer.js";
import { AgentContinuityRecallRankingDefaults } from "./AgentContinuityRecallDefaults.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";

export interface AgentContinuityTextSimilarityResult {
  readonly score: number;
  readonly exact: number;
  readonly coverage: number;
  readonly fuzzy: number;
  /** Unmatched structural terms, normalized to [0, 1]. */
  readonly structuralMismatch?: number;
}

export class AgentContinuityTextSimilarity {
  private readonly tokenizer = new AgentToolSearchTokenizer();

  constructor(
    private readonly policy: ResolvedAgentContinuityRecallRankingConfig["Similarity"] = AgentContinuityRecallRankingDefaults.Similarity,
  ) {}

  compare(query: string, target: string): AgentContinuityTextSimilarityResult {
    const normalizedQuery = normalize(query);
    const normalizedTarget = normalize(target);
    return this.compareNormalized(normalizedQuery, normalizedTarget);
  }

  /**
   * Compares claim bodies: a leading subject ("用户住在上海" -> "住在上海")
   * is conversation boilerplate, not claim content, and must not dilute
   * identity checks between a fact and its profile counterpart.
   */
  compareClaimBodies(query: string, target: string): AgentContinuityTextSimilarityResult {
    return this.compareNormalized(
      normalize(this.tokenizer.stripLeadingSubject(query)),
      normalize(this.tokenizer.stripLeadingSubject(target)),
    );
  }

  /**
   * Compares claims while ignoring an omitted leading subject, but never
   * erases a disagreement when both sides explicitly name different
   * subjects. This keeps identity reconciliation conservative for multi-user
   * or multi-entity workspaces.
   */
  compareClaimIdentity(query: string, target: string): AgentContinuityTextSimilarityResult {
    const body = this.compareClaimBodies(query, target);
    if (
      this.tokenizer.hasDistinctLeadingSubject(query, target) ||
      hasClaimArgumentMismatch(this.tokenizer, query, target)
    ) {
      return { ...body, structuralMismatch: 1 };
    }
    return body;
  }

  private compareNormalized(normalizedQuery: string, normalizedTarget: string): AgentContinuityTextSimilarityResult {
    if (!normalizedQuery || !normalizedTarget) {
      return { score: 0, exact: 0, coverage: 0, fuzzy: 0, structuralMismatch: 0 };
    }

    const allQueryTerms = this.terms(normalizedQuery);
    const allTargetTerms = this.terms(normalizedTarget);
    const queryTerms = retrievalTerms(allQueryTerms);
    const targetTerms = retrievalTerms(allTargetTerms);
    const searchQueryTerms = this.searchTerms(normalizedQuery);
    const searchTargetTerms = this.searchTerms(normalizedTarget);
    const exact = phraseScore(normalizedQuery, normalizedTarget, this.policy.PhraseFloor);
    const coverage = tokenCoverage(queryTerms, targetTerms);
    const fuzzy = fuzzyCoverage(queryTerms, targetTerms);
    const searchCoverage = tokenCoverage(searchQueryTerms, searchTargetTerms);
    const searchFuzzy = fuzzyCoverage(searchQueryTerms, searchTargetTerms);
    const character = characterCoverage(queryTerms, targetTerms);
    const structuralMismatch = structuralMismatchScore(
      this.structuralTerms(normalizedQuery, allQueryTerms),
      this.structuralTerms(normalizedTarget, allTargetTerms),
      allQueryTerms,
      allTargetTerms,
    );
    const baseScore = Math.max(
      exact,
      coverage * this.policy.CoverageWeight + fuzzy * this.policy.FuzzyWeight,
      searchCoverage * this.policy.CoverageWeight + searchFuzzy * this.policy.FuzzyWeight,
      character * this.policy.CharacterWeight,
    );
    return {
      score: clamp01(baseScore * (1 - structuralMismatch * this.policy.StructuralMismatchWeight)),
      exact,
      coverage,
      fuzzy,
      structuralMismatch,
    };
  }

  terms(value: string): string[] {
    return this.tokenizer.tokenizeContent(value).filter((term) => term.length > 1 || isCjkSingleTerm(term));
  }

  /** Tokenizes claim content after removing a structural leading subject. */
  contentTerms(value: string): string[] {
    // Subject stripping is a secondary view.  Keep the original terms so a
    // compound label cannot disappear because a POS tag was ambiguous.
    return [...new Set([...this.terms(value), ...this.terms(this.tokenizer.stripLeadingSubject(value))])];
  }

  /**
   * Returns terms suitable for broad retrieval. Structural single Han
   * characters remain available to compare(), but do not drive a multi-term
   * index query where incidental overlap is common.
   */
  searchTerms(value: string): string[] {
    const normalized = normalize(value);
    return retrievalTerms([
      ...new Set([...this.terms(normalized), ...this.tokenizer.tokenize(normalized), ...cjkBigrams(normalized)]),
    ]);
  }

  private structuralTerms(value: string, allTerms: readonly string[]): string[] {
    const markers = allTerms.filter(isCjkSingleTerm);
    for (const { word, tag } of this.tokenizer.taggedTokens(value)) {
      if (isStructuralTag(tag)) {
        markers.push(word);
        continue;
      }
      // Jieba occasionally folds a structural modifier into a predicate
      // (for example, a negator plus a verb).  Inspecting the token prefix
      // through the same POS model catches that shape without a language-
      // specific word list.
      if (!hasPredicateTag(tag) || codePointLength(word) < 2) continue;
      const prefix = [...word][0];
      const prefixTag = this.tokenizer.taggedTokens(prefix)[0]?.tag;
      if (prefixTag && isStructuralTag(prefixTag)) markers.push(prefix);
    }
    return [...new Set(markers)];
  }
}

function phraseScore(query: string, target: string, phraseFloor: number): number {
  if (query === target) return 1;
  if (!query.includes(target) && !target.includes(query)) return 0;
  return Math.max(
    phraseFloor,
    Math.min(codePointLength(query), codePointLength(target)) /
      Math.max(codePointLength(query), codePointLength(target)),
  );
}

function tokenCoverage(queryTerms: readonly string[], targetTerms: readonly string[]): number {
  if (queryTerms.length === 0 || targetTerms.length === 0) return 0;
  const target = new Set(targetTerms);
  return queryTerms.filter((term) => target.has(term)).length / queryTerms.length;
}

/**
 * A single Han character is useful for segmentation, but too ambiguous as a
 * standalone similarity signal when a query has richer terms. Preserve it for
 * one-character queries while preventing incidental overlaps from dominating
 * multi-term comparisons.
 */
function retrievalTerms(terms: readonly string[]): string[] {
  const contentTerms = terms.filter((term) => !isCjkSingleTerm(term));
  return contentTerms.length > 0 ? contentTerms : [...terms];
}

function fuzzyCoverage(queryTerms: readonly string[], targetTerms: readonly string[]): number {
  if (queryTerms.length === 0 || targetTerms.length === 0) return 0;
  const preparedTargets = targetTerms.map((term) => fuzzysort.prepare(term));
  const scores = queryTerms.map((term) =>
    preparedTargets.reduce((best, target) => Math.max(best, fuzzysort.single(term, target)?.score ?? 0), 0),
  );
  return scores.reduce((total, score) => total + Math.max(0, score), 0) / scores.length;
}

/**
 * A single Han term can encode a predicate, negation, or another structural
 * distinction. It is retained for compatibility checks, but only counts as a
 * mismatch when the other side cannot represent it exactly or as part of a
 * longer segmented term.
 */
function structuralMismatchScore(
  queryStructural: readonly string[],
  targetStructural: readonly string[],
  queryTerms: readonly string[],
  targetTerms: readonly string[],
): number {
  const totalStructural = queryStructural.length + targetStructural.length;
  const insertionConflict = Math.max(
    strictSubsequenceExtraCount(queryTerms, targetTerms),
    strictSubsequenceExtraCount(targetTerms, queryTerms),
  );
  if (totalStructural === 0 && insertionConflict === 0) return 0;
  // Structural markers (most importantly negation) are constraints in both
  // directions. Their effect is gated by shared lexical anchors so an
  // isolated one-character token in an unrelated sentence is not a
  // contradiction, and normalized by complete claim size so richer details
  // are not treated as total opposites.
  const unmatched =
    queryStructural.filter((term) => !containsStructuralTerm(term, targetTerms)).length +
    targetStructural.filter((term) => !containsStructuralTerm(term, queryTerms)).length +
    insertionConflict;
  if (unmatched === 0) return 0;
  const forwardAgreement = tokenCoverage(retrievalTerms(queryTerms), retrievalTerms(targetTerms));
  const reverseAgreement = tokenCoverage(retrievalTerms(targetTerms), retrievalTerms(queryTerms));
  const anchorAgreement = Math.min(forwardAgreement, reverseAgreement);
  if (anchorAgreement <= 0) return 0;
  return (unmatched / Math.max(1, queryTerms.length + targetTerms.length)) * anchorAgreement;
}

/** Returns inserted exact tokens when one claim is a strict subsequence. */
function strictSubsequenceExtraCount(shorter: readonly string[], longer: readonly string[]): number {
  if (shorter.length >= longer.length || shorter.length === 0) return 0;
  let matched = 0;
  for (const term of longer) {
    if (term === shorter[matched]) matched += 1;
    if (matched === shorter.length) return longer.length - shorter.length;
  }
  return 0;
}

function containsStructuralTerm(term: string, terms: readonly string[]): boolean {
  return terms.some((candidate) => candidate === term || (candidate.length > 1 && candidate.includes(term)));
}

/** Keeps short Chinese paraphrases searchable without adding a synonym table. */
function characterCoverage(queryTerms: readonly string[], targetTerms: readonly string[]): number {
  const queryCharacters = new Set(queryTerms.flatMap((term) => [...term]).filter(isCjkSingleTerm));
  const targetCharacters = new Set(targetTerms.flatMap((term) => [...term]).filter(isCjkSingleTerm));
  if (queryCharacters.size === 0 || targetCharacters.size === 0) return 0;
  const overlap = [...queryCharacters].filter((character) => targetCharacters.has(character)).length;
  return (2 * overlap) / (queryCharacters.size + targetCharacters.size);
}

function normalize(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isCjkSingleTerm(value: string): boolean {
  return value.length === 1 && /\p{Script=Han}/u.test(value);
}

/** Adds a language-agnostic subword bridge for short CJK paraphrases. */
function cjkBigrams(value: string): string[] {
  const bigrams: string[] = [];
  let run = "";
  const flush = (): void => {
    for (let index = 0; index + 2 <= run.length; index += 1) {
      bigrams.push(run.slice(index, index + 2));
    }
    run = "";
  };
  for (const character of value) {
    if (/\p{Script=Han}/u.test(character)) run += character;
    else flush();
  }
  flush();
  return bigrams;
}

function codePointLength(value: string): number {
  return [...value].length;
}

function isStructuralTag(tag: string): boolean {
  return tag === "d" || tag.startsWith("d") || tag === "c" || tag.startsWith("c");
}

function hasPredicateTag(tag: string): boolean {
  return tag === "v" || tag.startsWith("v") || tag === "a" || tag.startsWith("a");
}

/**
 * Fact identity needs one additional constraint beyond lexical coverage:
 * shared arguments must stay in the same order and explicit quantities must
 * agree.  This is intentionally kept out of ordinary recall scoring, where a
 * bag-of-terms view is useful for fuzzy retrieval.
 */
function hasClaimArgumentMismatch(tokenizer: AgentToolSearchTokenizer, left: string, right: string): boolean {
  const rawLeftTokens = tokenizer.orderedContentTokens(tokenizer.stripLeadingSubject(left));
  const rawRightTokens = tokenizer.orderedContentTokens(tokenizer.stripLeadingSubject(right));
  // Jieba may fuse an entity and a connector into one `x` token on only one
  // side (for example, `张三而`).  Use POS evidence from the other side to
  // restore that boundary without maintaining a language-specific word list.
  const boundaryTags = identityBoundaryTags([...rawLeftTokens, ...rawRightTokens]);
  const leftTokens = splitFusedIdentityTokens(rawLeftTokens, boundaryTags);
  const rightTokens = splitFusedIdentityTokens(rawRightTokens, boundaryTags);
  if (hasExplicitNumericMismatch(leftTokens, rightTokens)) return true;

  const rawLeftArguments = identityArgumentTokens(leftTokens);
  const rawRightArguments = identityArgumentTokens(rightTokens);
  const [leftArguments, rightArguments] = removeSharedLeadingSubject(rawLeftArguments, rawRightArguments);
  const shared = uniqueSharedArguments(leftArguments, rightArguments);
  if (shared.length < 2) return false;
  const distinctLeft = new Set(leftArguments);
  const distinctRight = new Set(rightArguments);
  const overlap = shared.length / Math.max(distinctLeft.size, distinctRight.size);
  if (overlap < 0.5) return false;

  let comparablePairs = 0;
  let inversions = 0;
  for (let first = 0; first < shared.length; first += 1) {
    for (let second = first + 1; second < shared.length; second += 1) {
      const leftOrder = argumentOrder(leftArguments, shared[first]!, shared[second]!);
      const rightOrder = argumentOrder(rightArguments, shared[first]!, shared[second]!);
      if (leftOrder === 0 || rightOrder === 0) continue;
      comparablePairs += 1;
      if (leftOrder !== rightOrder) inversions += 1;
    }
  }
  // A single swapped pair among two anchors is decisive; with more anchors,
  // require at least half of comparable pairs to be inverted to tolerate minor
  // segmentation/order noise.
  return comparablePairs > 0 && (shared.length === 2 ? inversions > 0 : inversions * 2 >= comparablePairs);
}

function identityBoundaryTags(tokens: readonly AgentToolSearchTaggedToken[]): ReadonlyMap<string, string> {
  const boundaries = new Map<string, string>();
  for (const token of tokens) {
    const word = normalize(token.word);
    if (!word || !isAllHan(word) || isIdentityArgumentToken(token)) continue;
    // Keep the first POS label.  A boundary is only admitted when at least
    // one side's tag says it is structural/non-argument, so an ambiguous
    // noun never becomes a forced split merely because it occurs as a span.
    boundaries.set(word, token.tag);
  }
  return boundaries;
}

/**
 * Restores structural boundaries that an unknown Jieba token swallowed.
 * This is deliberately character/POS based: it handles new names and
 * connectors without a maintained vocabulary or hard-coded phrase list.
 */
function splitFusedIdentityTokens(
  tokens: readonly AgentToolSearchTaggedToken[],
  boundaries: ReadonlyMap<string, string>,
): AgentToolSearchTaggedToken[] {
  if (boundaries.size === 0) return [...tokens];
  return tokens.flatMap((token) => {
    const normalized = normalize(token.word);
    if (token.tag !== "x" || !isAllHan(normalized)) return [token];
    const characters = [...normalized];
    const pieces: AgentToolSearchTaggedToken[] = [];
    let segmentStart = 0;
    let index = 0;
    while (index < characters.length) {
      const boundary = longestIdentityBoundaryAt(characters, index, boundaries);
      if (!boundary) {
        index += 1;
        continue;
      }
      if (index > segmentStart) {
        pieces.push({ word: characters.slice(segmentStart, index).join(""), tag: token.tag });
      }
      pieces.push({ word: boundary.word, tag: boundary.tag });
      index += boundary.length;
      segmentStart = index;
    }
    if (segmentStart < characters.length) {
      pieces.push({ word: characters.slice(segmentStart).join(""), tag: token.tag });
    }
    // A boundary that consumes the whole token is still useful (the other
    // side proved the span's structural role), but retain the original token
    // if no actual split occurred to avoid changing ordinary x semantics.
    return pieces.length > 0 ? pieces : [token];
  });
}

function longestIdentityBoundaryAt(
  characters: readonly string[],
  start: number,
  boundaries: ReadonlyMap<string, string>,
): { readonly word: string; readonly tag: string; readonly length: number } | undefined {
  let match: { readonly word: string; readonly tag: string; readonly length: number } | undefined;
  for (const [word, tag] of boundaries) {
    const boundaryCharacters = [...word];
    if (start + boundaryCharacters.length > characters.length) continue;
    if (!boundaryCharacters.every((character, offset) => characters[start + offset] === character)) continue;
    if (!match || boundaryCharacters.length > match.length) {
      match = { word, tag, length: boundaryCharacters.length };
    }
  }
  return match;
}

function removeSharedLeadingSubject(
  left: readonly string[],
  right: readonly string[],
): [readonly string[], readonly string[]] {
  // Subject stripping is deliberately conservative in the tokenizer.  When
  // it cannot prove a clause boundary (for example, a multi-predicate Chinese
  // sentence), a common first argument is still a strong subject signal.  Do
  // this only when both sides have additional arguments so a two-argument
  // relation is never silently reduced to one anchor.
  if (left.length < 3 || right.length < 3 || left[0] !== right[0]) return [left, right];
  return [left.slice(1), right.slice(1)];
}

function identityArgumentTokens(tokens: readonly AgentToolSearchTaggedToken[]): string[] {
  const argumentsList: string[] = [];
  let cjkSpan = "";
  const flushCjkSpan = (): void => {
    if (cjkSpan) argumentsList.push(cjkSpan);
    cjkSpan = "";
  };
  for (const token of tokens) {
    if (!isIdentityArgumentToken(token)) {
      flushCjkSpan();
      continue;
    }
    const word = normalize(token.word);
    if (!word) continue;
    if (isAllHan(word)) {
      cjkSpan += word;
    } else {
      flushCjkSpan();
      argumentsList.push(word);
    }
  }
  flushCjkSpan();
  return argumentsList;
}

function isIdentityArgumentToken(token: AgentToolSearchTaggedToken): boolean {
  const tag = token.tag;
  if (tag === "eng") return true;
  if (hasTagPrefix(tag, ["v", "a", "c", "d", "u", "y", "p", "e", "o"])) {
    return false;
  }
  // Unknown/English tokens may be proper entities or argument labels.  Keep
  // them when they contain a searchable character; predicate identity is
  // handled by the normal claim comparator.
  return true;
}

function uniqueSharedArguments(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((token) => rightSet.has(token));
}

function argumentOrder(tokens: readonly string[], left: string, right: string): number {
  const leftIndex = tokens.indexOf(left);
  const rightIndex = tokens.indexOf(right);
  if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) return 0;
  return leftIndex < rightIndex ? -1 : 1;
}

function hasExplicitNumericMismatch(
  left: readonly AgentToolSearchTaggedToken[],
  right: readonly AgentToolSearchTaggedToken[],
): boolean {
  const leftNumbers = extractNumericTokens(left);
  const rightNumbers = extractNumericTokens(right);
  if (leftNumbers.length === 0 || rightNumbers.length === 0) return false;
  if (leftNumbers.length !== rightNumbers.length) return true;
  return leftNumbers.some((value, index) => value !== rightNumbers[index]);
}

function extractNumericTokens(tokens: readonly AgentToolSearchTaggedToken[]): string[] {
  return tokens.flatMap((token) => {
    const matches = token.word.normalize("NFKC").match(/[\p{N}]+(?:[.,][\p{N}]+)*/gu);
    return matches ? matches.map((value) => value.replace(/,/gu, "")) : [];
  });
}

function hasTagPrefix(tag: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => tag === prefix || tag.startsWith(prefix));
}

function isAllHan(value: string): boolean {
  return value.length > 0 && [...value].every((character) => /\p{Script=Han}/u.test(character));
}
