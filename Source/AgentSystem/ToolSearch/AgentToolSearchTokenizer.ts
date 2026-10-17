import { createRequire } from "node:module";
import { Jieba, TfIdf } from "@node-rs/jieba";

const nodeRequire = createRequire(import.meta.url);
const { dict, idf } = nodeRequire("@node-rs/jieba/dict") as {
  dict: Uint8Array;
  idf: Uint8Array;
};

const SearchCharacterPattern = /[\p{L}\p{N}]/u;
const SingleHanCharacterPattern = /^\p{Script=Han}$/u;
const SearchWordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/**
 * Closed POS-class prefixes that carry no retrieval value once segmentation
 * is done. jieba emits ICTCLAS-style tags with subclasses (uj/uz/ug for
 * particles, rz/ry for pronouns, m/q for quantities and classifiers), so
 * prefixes cover the whole family.
 * "eng" marks English words (all of them, regardless of function) and must
 * stay in; negation (d) and content words stay in too: dropping 不/没 would
 * collapse a fact into its own opposite.
 */
const StopPartOfSpeechTagPrefixes = ["u", "y", "p", "r", "e", "o", "c", "m", "q"] as const;
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
   * Complete examples are producer-declared usage contracts, not aliases.
   * Compare their normalized phrase form so punctuation and identifier casing
   * do not make the same command look like a different request.
   */
  matchesExactPhrase(left: string, right: string): boolean {
    const normalizedLeft = this.canonicalPhrase(left);
    return normalizedLeft.length > 0 && normalizedLeft === this.canonicalPhrase(right);
  }

  /**
   * Produces a locale-neutral phrase key for declared identities and examples.
   * It is intentionally based on Unicode letters and numbers rather than a
   * language detector, so aliases from every producer share one collision
   * domain during discovery planning.
   */
  canonicalPhrase(text: string): string {
    return canonicalSearchPhrase(this.normalize(text));
  }

  /**
   * Declared tool identities and aliases are names, not bags of terms. Match
   * them as a normalized contiguous phrase so a tokenizer dropping a Chinese
   * ordinal or classifier cannot turn part of a longer alias into a false
   * direct command reference. Padding preserves word boundaries for Latin
   * identifiers while still allowing a declared CJK phrase inside prose.
   */
  containsDeclaredPhrase(phrase: string, text: string): boolean {
    const phraseWords = wordLikeSegments(this.normalize(phrase));
    const textWords = wordLikeSegments(this.normalize(text));
    if (phraseWords.length === 0 || phraseWords.length > textWords.length) return false;
    return textWords.some((_, start) => phraseWords.every((word, index) => textWords[start + index] === word));
  }

  /**
   * Matches a producer-declared multi-term identity through natural request
   * modifiers. For example, a declared "generate image" identity remains
   * recognizable in "generate one image". This is a token-order relation,
   * not a synonym table: every meaningful declared term must occur in order.
   * A one-term declaration deliberately does not use this relaxed path;
   * otherwise a suffix from a longer alias would become a false identity.
   */
  containsDeclaredIdentitySequence(phrase: string, text: string): boolean {
    const phraseTokens = this.tokenizeContent(phrase).filter((token) => this.isIndependentContentToken(token));
    if (phraseTokens.length < 2) return false;
    const textTokens = this.orderedContentTokens(text)
      .map((word) => this.normalizeToken(word.word))
      .filter((token) => this.isIndependentContentToken(token));
    let cursor = 0;
    for (const token of textTokens) {
      if (token === phraseTokens[cursor]) cursor += 1;
      if (cursor === phraseTokens.length) return true;
    }
    return false;
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

  /**
   * Search-mode segmentation intentionally emits short Han fragments to widen
   * recall (for example, a compound noun can expose one of its characters).
   * A lone fragment is useful for candidate generation, but too ambiguous to
   * prove that an operation's declared intent was matched. Other one-character
   * tokens remain valid because identifiers and symbols can be meaningful.
   */
  isIndependentContentToken(token: string): boolean {
    return !SingleHanCharacterPattern.test(token);
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
    return expandIdentifierBoundaries(text.normalize("NFKC")).toLocaleLowerCase();
  }

  private normalizeToken(token: string): string {
    return token.trim().toLocaleLowerCase();
  }
}

function expandIdentifierBoundaries(value: string): string {
  return value
    .replaceAll(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2")
    .replaceAll(/([\p{L}])(\p{N})/gu, "$1 $2")
    .replaceAll(/(\p{N})([\p{L}])/gu, "$1 $2")
    .replaceAll(/_+/gu, " ");
}

function canonicalSearchPhrase(value: string): string {
  return value
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/**
 * Unicode word segmentation gives every script the same boundary model. It
 * prevents `git` from matching the interior of `digital`, while recognizing
 * declared CJK phrases embedded in ordinary prose without a script-specific
 * substring exception.
 */
function wordLikeSegments(value: string): string[] {
  return [...SearchWordSegmenter.segment(value)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => canonicalSearchPhrase(segment.segment))
    .filter(Boolean);
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
