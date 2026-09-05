/**
 * Markdown-to-platform text conversion shared by channel adapters.
 *
 * The pipeline treats platform markdown as a capability flag; only Telegram
 * requires escaping (MarkdownV2). Discord renders CommonMark directly and QQ
 * official bots receive plain markdown via their markdown message API.
 */

const CodeFenceBlockPattern = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;

export type AgentChannelMarkdownMode = "markdown_v2" | "markdown" | "plain";

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

function findSplitPoint(candidate: string): number {
  for (const separator of ["\n", " "]) {
    const at = candidate.lastIndexOf(separator);
    if (at > Math.floor(candidate.length / 2)) return at + 1;
  }
  return candidate.length;
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
