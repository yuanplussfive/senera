import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { AgentWebContentMode } from "./AgentWebTypes.js";

export interface AgentWebContentExtractionInput {
  readonly source: string;
  readonly contentType: string;
  readonly finalUrl: string;
  readonly mode: AgentWebContentMode;
  readonly extractPrompt?: string;
  readonly maxExtractBlocks: number;
  readonly maxMarkdownChars: number;
  readonly maxLinks: number;
}

export interface AgentWebContentExtractionResult {
  readonly title: string;
  readonly markdown: string;
  readonly markdownSummary: string;
  readonly links: readonly { title: string; url: string }[];
}

const HtmlContentTypes = new Set(["text/html", "application/xhtml+xml"]);
const Turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});

export function extractAgentWebContent(input: AgentWebContentExtractionInput): AgentWebContentExtractionResult {
  if (input.mode === "text" || !isHtmlContentType(input.contentType)) {
    const markdown = normalizeMarkdown(input.source, input.maxMarkdownChars);
    return {
      title: input.finalUrl,
      markdown,
      markdownSummary: selectRelevantBlocks(markdown, input.extractPrompt, input.maxExtractBlocks),
      links: [],
    };
  }

  const parsed = parseHTML(input.source);
  const document = parsed.document;
  removeNonContentElements(document);
  const links = collectLinks(document, input.finalUrl, input.maxLinks);
  const titleFromDocument = compactText(document.querySelector("title")?.textContent ?? "", 512);
  const article = input.mode === "page" ? undefined : new Readability(document as unknown as Document).parse();
  const title = compactText(article?.title ?? titleFromDocument ?? input.finalUrl, 512);
  const contentHtml = article?.content ?? document.body?.innerHTML ?? input.source;
  const markdown = normalizeMarkdown(Turndown.turndown(contentHtml), input.maxMarkdownChars);

  return {
    title,
    markdown,
    markdownSummary: selectRelevantBlocks(markdown, input.extractPrompt, input.maxExtractBlocks),
    links,
  };
}

export function selectRelevantBlocks(value: string, prompt: string | undefined, maxBlocks: number): string {
  const blocks = value
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return "";
  const limit = Math.max(1, Math.floor(maxBlocks));
  if (!prompt?.trim()) return blocks.slice(0, limit).join("\n\n");

  const query = prompt.trim().toLocaleLowerCase();
  const tokens = tokenize(query);
  const scored = blocks.map((block, index) => {
    const normalized = block.toLocaleLowerCase();
    const tokenScore = tokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0);
    const phraseScore = normalized.includes(query) ? Math.max(2, tokens.length) : 0;
    return { block, index, score: tokenScore + phraseScore };
  });
  const relevant = scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index);
  return (relevant.length > 0 ? relevant : scored.slice(0, limit)).map((entry) => entry.block).join("\n\n");
}

function isHtmlContentType(contentType: string): boolean {
  return HtmlContentTypes.has(contentType.split(";", 1)[0]!.trim().toLowerCase());
}

function removeNonContentElements(document: ReturnType<typeof parseHTML>["document"]): void {
  for (const selector of ["script", "style", "noscript", "template", "svg", "canvas", "form", "nav", "footer"]) {
    for (const element of Array.from(document.querySelectorAll(selector))) element.remove();
  }
}

function collectLinks(
  document: ReturnType<typeof parseHTML>["document"],
  baseUrl: string,
  maxLinks: number,
): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const result: Array<{ title: string; url: string }> = [];
  for (const element of Array.from(document.querySelectorAll("a"))) {
    if (result.length >= Math.max(0, Math.floor(maxLinks))) break;
    const href = element.getAttribute("href")?.trim();
    if (!href || href.startsWith("#")) continue;
    try {
      const url = new URL(href, baseUrl);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) continue;
      url.hash = "";
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const title = compactText(element.textContent || element.getAttribute("title") || normalized, 256);
      result.push({ title, url: normalized });
    } catch {
      continue;
    }
  }
  return result;
}

function tokenize(value: string): string[] {
  return [...new Set(value.match(/[\p{L}\p{N}]{2,}|[\p{Script=Han}]/gu) ?? [])];
}

function normalizeMarkdown(value: string, maxChars: number): string {
  const normalized = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll(/[ \t]+\n/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
  return Array.from(normalized)
    .slice(0, Math.max(0, Math.floor(maxChars)))
    .join("")
    .trim();
}

function compactText(value: string, maxChars: number): string {
  return Array.from(value.replaceAll(/\s+/gu, " ").trim()).slice(0, maxChars).join("");
}
