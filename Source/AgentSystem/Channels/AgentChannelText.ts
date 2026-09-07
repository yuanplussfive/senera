/**
 * Markdown-to-platform text conversion shared by channel adapters.
 *
 * The pipeline treats platform markdown as a capability flag; only Telegram
 * requires escaping (MarkdownV2). Discord renders CommonMark directly and QQ
 * official bots receive plain markdown via their markdown message API.
 */

import MarkdownIt from "markdown-it";
import { createRequire } from "node:module";
import { Jieba } from "@node-rs/jieba";

const CodeFenceBlockPattern = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;

export type AgentChannelMarkdownMode = "markdown_v2" | "markdown" | "plain";

/** Canonical resource URIs appearing as bare text inside inline content. */
const InlineResourceUriPattern = /senera:\/\/resource\/\S+/u;
/** File-like link targets that must survive as standalone resource parts. */
const FileLikeTargetPattern = /\.(?:png|jpe?g|gif|webp|svg|pdf|md|txt|json|zip|mp4|mp3|wav)(?:[?#].*)?$/iu;

const ChannelMarkdownParser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

export interface AgentChannelMarkdownStructure {
  readonly codeBlockCount: number;
  readonly codeLanguages: readonly string[];
  readonly mediaReferenceCount: number;
  readonly resourceLinkCount: number;
  readonly plainLinkCount: number;
  readonly inlineResourceUriCount: number;
}

const EmptyMarkdownStructure: AgentChannelMarkdownStructure = Object.freeze({
  codeBlockCount: 0,
  codeLanguages: [],
  mediaReferenceCount: 0,
  resourceLinkCount: 0,
  plainLinkCount: 0,
  inlineResourceUriCount: 0,
});

/** Guard against pathological inputs; the platform message limit is far smaller. */
const MaxStructureScanCharacters = 512_000;

/**
 * Parses the answer once and reports the structural evidence the channel
 * serializer needs: code fences, explicit media, and resource-like links.
 * Plain http(s) links are counted separately because they stay inline text.
 */
export function analyzeChannelMarkdownStructure(content: string): AgentChannelMarkdownStructure {
  if (content.length === 0) return EmptyMarkdownStructure;
  if (content.length > MaxStructureScanCharacters) {
    // Conservatively require the rewrite for oversized inputs.
    return { ...EmptyMarkdownStructure, codeBlockCount: 1, mediaReferenceCount: 1, resourceLinkCount: 1 };
  }
  const structure = {
    codeBlockCount: 0,
    codeLanguages: [] as string[],
    mediaReferenceCount: 0,
    resourceLinkCount: 0,
    plainLinkCount: 0,
    inlineResourceUriCount: 0,
  };
  for (const token of ChannelMarkdownParser.parse(content, {})) {
    if (token.type === "fence") {
      structure.codeBlockCount += 1;
      const language = token.info.trim();
      if (language) structure.codeLanguages.push(language);
      continue;
    }
    if (token.type === "code_block") {
      structure.codeBlockCount += 1;
      continue;
    }
    if (token.type !== "inline") continue;
    for (const child of token.children ?? []) {
      if (child.type === "image") {
        structure.mediaReferenceCount += 1;
        continue;
      }
      if (child.type === "link_open") {
        const href = child.attrGet("href") ?? "";
        if (isResourceLikeTarget(href)) structure.resourceLinkCount += 1;
        else if (/^https?:\/\//iu.test(href)) structure.plainLinkCount += 1;
        continue;
      }
      if (child.type === "text" && InlineResourceUriPattern.test(child.content)) {
        structure.inlineResourceUriCount += 1;
      }
    }
  }
  return structure;
}

/**
 * Decides whether the model-based final response serializer is required.
 * Code fences and explicit resource references cannot be re-flowed reliably
 * by the local splitter, so they keep the model rewrite; ordinary prose
 * falls through to {@link splitChannelTextByParagraphs}.
 */
export function requiresChannelFinalRewrite(content: string): boolean {
  if (content.length === 0) return false;
  const structure = analyzeChannelMarkdownStructure(content);
  return (
    structure.codeBlockCount > 0 ||
    structure.mediaReferenceCount > 0 ||
    structure.resourceLinkCount > 0 ||
    structure.inlineResourceUriCount > 0
  );
}

function isResourceLikeTarget(href: string): boolean {
  return href.startsWith("senera://") || FileLikeTargetPattern.test(href);
}

/**
 * Splits plain text into paragraph-aware parts, at most {@link maxParts} by
 * default. Blank-line blocks are kept intact when there are few of them; an
 * over-long answer is re-balanced at sentence granularity so each part starts
 * and ends on a sentence boundary. Falls back to single-line blocks when the
 * text has line breaks but no blank lines.
 */
export function splitChannelTextByParagraphs(content: string, maxParts = 4): string[] {
  const normalized = content.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];
  let paragraphs = normalized
    .split(/\n{2,}/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length === 1 && normalized.includes("\n")) {
    paragraphs = normalized
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (paragraphs.length <= maxParts) return paragraphs;
  const units: SentenceUnit[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    for (const unit of splitSentences(paragraph)) {
      units.push({ ...unit, paragraph: paragraphIndex });
    }
  });
  return balanceSentenceUnits(units, maxParts);
}

interface SentenceUnit {
  readonly text: string;
  /** Original gap between this sentence and the previous one. */
  readonly separator: string;
  readonly paragraph: number;
}

/** Splits on Chinese sentence-final punctuation, keeping closing quotes with the sentence. */
const SentenceBreakPattern = /(?<=[。！？；…])["'”』」）)]?(?=\s*\S|$)/gu;

function splitSentences(paragraph: string): Array<{ text: string; separator: string }> {
  const breaks: number[] = [];
  for (const match of paragraph.matchAll(SentenceBreakPattern)) {
    breaks.push(match.index + match[0].length);
  }
  if (breaks.length === 0) return [{ text: paragraph, separator: "" }];
  const units: Array<{ text: string; separator: string }> = [];
  let cursor = 0;
  for (const breakAt of breaks) {
    const raw = paragraph.slice(cursor, breakAt).trim();
    const after = paragraph.slice(breakAt);
    const gap = /^\s*/u.exec(after)?.[0] ?? "";
    units.push({ text: raw, separator: gap });
    cursor = breakAt + gap.length;
  }
  const tail = paragraph.slice(cursor).trim();
  if (tail) units.push({ text: tail, separator: "" });
  return units;
}

function balanceSentenceUnits(units: readonly SentenceUnit[], target: number): string[] {
  if (units.length <= target) return units.map((unit) => unit.text);
  // Cumulative lengths including each unit's leading separator.
  const prefix: number[] = [0];
  for (const unit of units) prefix.push(prefix[prefix.length - 1] + unit.text.length + unit.separator.length);
  const total = prefix[prefix.length - 1];
  // Place each cut point at the sentence boundary closest to the ideal share.
  const boundaries: number[] = [0];
  for (let group = 1; group < target; group += 1) {
    const ideal = (total * group) / target;
    let best = boundaries[group - 1] + 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = best; index < units.length; index += 1) {
      const distance = Math.abs(prefix[index] - ideal);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    boundaries.push(best);
  }
  boundaries.push(units.length);
  const parts: string[] = [];
  for (let group = 0; group < target; group += 1) {
    const start = boundaries[group]!;
    const end = boundaries[group + 1]!;
    const slice = units.slice(start, end);
    let text = slice[0]!.text;
    for (let index = 1; index < slice.length; index += 1) {
      const unit = slice[index]!;
      const previous = slice[index - 1]!;
      text += previous.paragraph === unit.paragraph ? unit.separator : "\n\n";
      text += unit.text;
    }
    parts.push(text);
  }
  return parts;
}

export function convertAgentChannelMarkdown(content: string, mode: AgentChannelMarkdownMode): string {
  switch (mode) {
    case "markdown_v2":
      return escapeTelegramMarkdownV2(content);
    case "markdown":
      return content;
    case "plain":
      return stripMarkdownToPlainText(content);
  }
}

/**
 * Splits long output into platform-sized chunks while keeping code fences
 * intact. A fence that opens in one chunk and closes in the next is
 * deliberately balanced so each chunk renders on its own.
 */
export function splitAgentChannelContent(content: string, maxLength: number): string[] {
  if (maxLength < 1) throw new Error("maxLength must be a positive integer.");
  if (content.length <= maxLength) return [content];

  const chunks: string[] = [];
  let remaining = content;
  let carryLanguage: string | undefined;
  while (remaining.length > maxLength) {
    const prefix = carryLanguage === undefined ? "" : `\`\`\`${carryLanguage}\n`;
    const close = "\n```";
    // Reserve room for a closing fence. Most chunks are ordinary prose and
    // can use the full budget; a second pass below tightens the body only if
    // the selected boundary actually leaves us inside a code block.
    const firstBudget = Math.max(1, maxLength - prefix.length);
    let splitAt = findSplitPoint(remaining.slice(0, firstBudget));
    let body = remaining.slice(0, splitAt);
    let state = scanFenceState(body, carryLanguage);
    if (state.open && prefix.length + body.length + close.length > maxLength) {
      const fencedBudget = Math.max(1, maxLength - prefix.length - close.length);
      splitAt = findSplitPoint(remaining.slice(0, fencedBudget));
      body = remaining.slice(0, splitAt);
      state = scanFenceState(body, carryLanguage);
      // A very small caller-provided limit may be unable to fit a complete
      // fence. Consume one code point rather than looping forever; QQ's real
      // limit is large enough that this branch is only defensive.
      if (state.open && prefix.length + body.length + close.length > maxLength) {
        splitAt = Math.max(1, maxLength - prefix.length - close.length);
        body = remaining.slice(0, splitAt);
        state = scanFenceState(body, carryLanguage);
      }
    }
    const chunk = `${prefix}${body}${state.open ? close : ""}`;
    chunks.push(chunk.length <= maxLength ? chunk : chunk.slice(0, maxLength));
    remaining = remaining.slice(splitAt);
    carryLanguage = state.open ? state.language : undefined;
  }
  if (remaining.length > 0 || chunks.length === 0) {
    const prefix = carryLanguage === undefined ? "" : `\`\`\`${carryLanguage}\n`;
    const state = scanFenceState(remaining, carryLanguage);
    const close = "\n```";
    const suffix = state.open ? close : "";
    if (prefix.length + remaining.length + suffix.length <= maxLength) {
      chunks.push(`${prefix}${remaining}${suffix}`);
    } else {
      // The loop normally handles this path. Keep a defensive fallback for a
      // tiny custom maxLength without dropping the remaining content.
      chunks.push(`${prefix}${remaining}`.slice(0, maxLength));
    }
  }
  return chunks;
}

/**
 * Rebalances unterminated code fences so a standalone chunk does not swallow
 * the rest of the conversation. Mirrors reference gateway behavior where an
 * open fence is closed at the chunk boundary.
 */
export function ensureClosedFences(content: string): string {
  const openings = [...content.matchAll(/```/g)].length;
  if (openings % 2 === 0) return content;
  return `${content}\n\`\`\``;
}

const nodeRequire = createRequire(import.meta.url);
const { dict } = nodeRequire("@node-rs/jieba/dict") as { dict: Uint8Array };

let Segmenter: ReturnType<typeof Jieba.withDict> | undefined;

function getSegmenter(): ReturnType<typeof Jieba.withDict> {
  Segmenter ??= Jieba.withDict(dict);
  return Segmenter;
}

function findSplitPoint(candidate: string): number {
  const mid = Math.floor(candidate.length / 2);
  const newline = candidate.lastIndexOf("\n");
  if (newline > mid) return newline + 1;
  const sentence = lastSentenceBreak(candidate, mid);
  if (sentence > mid) return sentence;
  const space = candidate.lastIndexOf(" ");
  if (space > mid) return space + 1;
  const word = lastJiebaBoundary(candidate, mid);
  if (word > mid) return word;
  return candidate.length;
}

/** Last Chinese sentence-final punctuation at or after the midpoint. */
function lastSentenceBreak(candidate: string, mid: number): number {
  let last = -1;
  for (const match of candidate.matchAll(/[。！？；…]/gu)) {
    if ((match.index ?? 0) >= mid) last = (match.index ?? 0) + 1;
  }
  return last;
}

/** Last complete word boundary at or after the midpoint, via the Rust jieba segmenter. */
function lastJiebaBoundary(candidate: string, mid: number): number {
  try {
    const words = getSegmenter().cutForSearch(candidate, true);
    let position = 0;
    let last = -1;
    for (const word of words) {
      position += word.length;
      if (position > mid && position <= candidate.length) last = position;
    }
    return last;
  } catch {
    return -1;
  }
}

interface FenceState {
  readonly open: boolean;
  readonly language: string;
}

function scanFenceState(content: string, initialLanguage?: string): FenceState {
  let open = initialLanguage !== undefined;
  let language = initialLanguage ?? "";
  for (const line of content.split("\n")) {
    const marker = line.trimStart();
    if (!marker.startsWith("```")) continue;
    if (open) {
      open = false;
      language = "";
      continue;
    }
    open = true;
    const tag = marker.slice(3).trim();
    language = tag.split(/\s+/u)[0] ?? "";
  }
  return { open, language };
}

function escapeTelegramMarkdownV2(content: string): string {
  const fences = [...content.matchAll(CodeFenceBlockPattern)];
  if (fences.length === 0) {
    return escapeTelegramText(content);
  }

  let result = "";
  let cursor = 0;
  for (const match of fences) {
    const index = match.index ?? 0;
    result += escapeTelegramText(content.slice(cursor, index));
    result += match[0];
    cursor = index + match[0].length;
  }
  result += escapeTelegramText(content.slice(cursor));
  return result;
}

function escapeTelegramText(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, (character) => `\\${character}`);
}

function stripMarkdownToPlainText(content: string): string {
  return content
    .replace(CodeFenceBlockPattern, (_, __, body) => body.trim())
    .replace(/```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
    .replace(/>\s?/g, "")
    .replace(/\|/g, "");
}
