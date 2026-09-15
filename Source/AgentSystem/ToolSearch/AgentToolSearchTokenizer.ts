import { createRequire } from "node:module";
import { Jieba, TfIdf } from "@node-rs/jieba";

const nodeRequire = createRequire(import.meta.url);
const { dict, idf } = nodeRequire("@node-rs/jieba/dict") as {
  dict: Uint8Array;
  idf: Uint8Array;
};

const SearchCharacterPattern = /[\p{L}\p{N}]/u;

/**
 * Closed POS-class prefixes that carry no retrieval value once segmentation
 * is done. jieba emits ICTCLAS-style tags with subclasses (uj/uz/ug for
 * particles, rz/ry for pronouns), so prefixes cover the whole family.
 * "eng" marks English words (all of them, regardless of function) and must
 * stay in; negation (d) and content words stay in too: dropping 不/没 would
 * collapse a fact into its own opposite.
 */
const StopPartOfSpeechTagPrefixes = ["u", "y", "p", "r", "e", "o"] as const;
const KeepPartOfSpeechTags = new Set(["eng"]);
const SubjectTagPrefixes = ["n", "r"] as const;
const PredicateHeadTagPrefixes = ["v", "a"] as const;
const PronounTagPrefixes = ["r"] as const;

export interface AgentToolSearchTaggedToken {
  readonly word: string;
  readonly tag: string;
}

function isStopPartOfSpeech(tag: string): boolean {
  if (KeepPartOfSpeechTags.has(tag)) return false;
  return StopPartOfSpeechTagPrefixes.some((prefix) => tag === prefix || tag.startsWith(`${prefix}`));
}

function hasTagPrefix(tag: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => tag === prefix || tag.startsWith(`${prefix}`));
}

export class AgentToolSearchTokenizer {
  private readonly segmenter = Jieba.withDict(dict);
  private readonly keywordExtractor = TfIdf.withDict(idf);

  tokenize(text: string): string[] {
    const normalized = this.normalize(text);
    const tokens = this.segmenter
      .cutForSearch(normalized, true)
      .map((token) => this.normalizeToken(token))
      .filter((token) => SearchCharacterPattern.test(token));
    return [...new Set(tokens)];
  }

  /**
   * Tokenizes and drops function words via jieba POS tags instead of a
   * hand-maintained stopword list. English words are tagged as x by jieba and
   * must survive the tag filter on their own merits.
   */
  tokenizeContent(text: string): string[] {
    const words = this.taggedTokens(text);
    const tokens = words
      .filter((word) => !isStopPartOfSpeech(word.tag))
      .map((word) => this.normalizeToken(word.word))
      .filter((token) => SearchCharacterPattern.test(token));
    return [...new Set(tokens)];
  }

  /** Exposes POS evidence to higher-level structural matching without sharing the segmenter. */
  taggedTokens(text: string): AgentToolSearchTaggedToken[] {
    const normalized = this.normalize(text);
    return this.segmenter.tag(normalized, true).map((word) => ({
      word: word.word,
      tag: word.tag,
    }));
  }

  /**
   * Drops a leading subject noun phrase ("用户住在北京" -> "住在北京") so
   * claim-body comparisons ignore conversation-level boilerplate. Structurally
   * driven (noun run followed by a predicate), never a word list.
   */
  stripLeadingSubject(text: string): string {
    return this.splitLeadingSubject(text)?.body ?? text;
  }

  /** Returns the POS-derived subject span when the text is a predicate clause. */
  leadingSubject(text: string): string | undefined {
    return this.splitLeadingSubject(text)?.subject;
  }

  /**
   * Detects a likely subject disagreement without relying on a vocabulary of
   * names.  Jieba can tag one name as an entity and leave another fused with a
   * predicate, so the check also aligns exact body/suffix boundaries and a
   * conservative ordered-token view.
   */
  hasDistinctLeadingSubject(left: string, right: string): boolean {
    const leftSubject = this.leadingSubject(left);
    const rightSubject = this.leadingSubject(right);
    if (leftSubject && rightSubject) {
      return normalizeComparable(leftSubject) !== normalizeComparable(rightSubject);
    }

    const explicit = leftSubject
      ? { subject: leftSubject, body: this.stripLeadingSubject(left), other: right }
      : rightSubject
        ? { subject: rightSubject, body: this.stripLeadingSubject(right), other: left }
        : undefined;
    if (explicit) {
      const body = normalizeComparable(explicit.body);
      const other = normalizeComparable(explicit.other);
      if (!body || !other) return true;
      // A raw body is the only unambiguous omitted-subject form.
      if (other === body) return false;
      if (other.endsWith(body)) {
        const otherPrefix = other.slice(0, other.length - body.length);
        return otherPrefix.length > 0 && normalizeComparable(explicit.subject) !== normalizeComparable(otherPrefix);
      }
      // A paraphrased/reordered body can still retain the same explicit
      // subject at the start.  Anything else is not proven equivalent.
      return !other.startsWith(normalizeComparable(explicit.subject));
    }

    return hasDistinctBoundaryPrefixes(this.orderedContentTokens(left), this.orderedContentTokens(right));
  }

  /** Keeps token order for syntax-sensitive identity checks; retrieval remains set-based. */
  orderedContentTokens(text: string): AgentToolSearchTaggedToken[] {
    return this.taggedTokens(text).filter((word) => SearchCharacterPattern.test(word.word));
  }

  private splitLeadingSubject(text: string): { readonly subject: string; readonly body: string } | undefined {
    const normalized = this.normalize(text);
    const words = this.taggedTokens(normalized);
    let index = 0;
    while (index < words.length && hasTagPrefix(words[index]!.tag, SubjectTagPrefixes)) {
      index += 1;
    }
    if (index === 0 || index >= words.length || !looksLikePredicateClause(words, index)) return undefined;
    return {
      subject: words
        .slice(0, index)
        .map((word) => word.word)
        .join(""),
      body: words
        .slice(index)
        .map((word) => word.word)
        .join(""),
    };
  }

  keywords(text: string): string[] {
    const normalized = this.normalize(text);
    const tokenLimit = this.tokenize(normalized).length;
    if (tokenLimit === 0) {
      return [];
    }

    const keywords = this.keywordExtractor
      .extractKeywords(this.segmenter, normalized, tokenLimit)
      .map((entry) => this.normalizeToken(entry.keyword))
      .filter((token) => SearchCharacterPattern.test(token));
    return [...new Set(keywords)];
  }

  private normalize(text: string): string {
    return text.normalize("NFKC").toLocaleLowerCase();
  }

  private normalizeToken(token: string): string {
    return token.trim().toLocaleLowerCase();
  }
}

/**
 * POS tagging alone cannot distinguish a subject-predicate clause from a
 * compound label (for example, a noun followed by a verb-tagged name).  Only
 * strip when a predicate has an argument/complement, or when the leading
 * subject is an actual pronoun.  The original text remains the fallback view.
 */
function looksLikePredicateClause(
  words: readonly { readonly tag: string; readonly word: string }[],
  subjectEnd: number,
): boolean {
  const subject = words.slice(0, subjectEnd);
  const body = words.slice(subjectEnd);
  const hasPronounSubject = subject.some((word) => hasTagPrefix(word.tag, PronounTagPrefixes));
  const predicateIndex = body.findIndex((word) => hasTagPrefix(word.tag, PredicateHeadTagPrefixes));
  if (predicateIndex < 0) return false;
  if (hasPronounSubject) return true;
  const predicate = body[predicateIndex]!;
  if (codePointLength(predicate.word) === 1) {
    const nextPredicateIndex = body.findIndex(
      (word, index) => index > predicateIndex && hasTagPrefix(word.tag, PredicateHeadTagPrefixes),
    );
    if (nextPredicateIndex > predicateIndex) {
      const intervening = body.slice(predicateIndex + 1, nextPredicateIndex);
      const hasNominalArgument = intervening.some((word) => hasTagPrefix(word.tag, SubjectTagPrefixes));
      if (!hasNominalArgument) return false;
    }
  }
  const continuation = body
    .slice(predicateIndex + 1)
    .map((word) => word.word.trim())
    .filter((word) => SearchCharacterPattern.test(word));
  return continuation.length > 0;
}

function codePointLength(value: string): number {
  return [...value].length;
}

function normalizeComparable(value: string): string {
  return compactComparable(value).toLocaleLowerCase();
}

function compactComparable(value: string): string {
  return [...value.normalize("NFKC")].filter((character) => SearchCharacterPattern.test(character)).join("");
}

function hasDistinctBoundaryPrefixes(
  left: readonly AgentToolSearchTaggedToken[],
  right: readonly AgentToolSearchTaggedToken[],
): boolean {
  const suffixLength = commonSuffixLength(left, right);
  // A one-token overlap is too weak to establish a clause boundary.  This
  // keeps predicate paraphrases such as "住在上海"/"居住在上海" mergeable.
  if (suffixLength < 2 || suffixLength >= left.length || suffixLength >= right.length) return false;
  const leftPrefix = left.slice(0, left.length - suffixLength);
  const rightPrefix = right.slice(0, right.length - suffixLength);
  if (sameTokenSequence(leftPrefix, rightPrefix)) return false;
  // Degree/adverbial modifiers are part of the predicate, not subjects.
  if (leftPrefix.some((token) => isPredicateOrModifierTag(token.tag))) return false;
  if (rightPrefix.some((token) => isPredicateOrModifierTag(token.tag))) return false;
  return true;
}

function commonSuffixLength(
  left: readonly AgentToolSearchTaggedToken[],
  right: readonly AgentToolSearchTaggedToken[],
): number {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    normalizeComparable(left[left.length - 1 - length]!.word) ===
      normalizeComparable(right[right.length - 1 - length]!.word)
  ) {
    length += 1;
  }
  return length;
}

function sameTokenSequence(
  left: readonly AgentToolSearchTaggedToken[],
  right: readonly AgentToolSearchTaggedToken[],
): boolean {
  return (
    left.length === right.length &&
    left.every((token, index) => normalizeComparable(token.word) === normalizeComparable(right[index]!.word))
  );
}

function isPredicateOrModifierTag(tag: string): boolean {
  return hasTagPrefix(tag, [...PredicateHeadTagPrefixes, "d"]);
}
