import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

export interface AgentMarkdownDocument {
  title?: string;
  sections: Map<string, string>;
}

interface AgentMarkdownHeading {
  readonly level: number;
  readonly title: string;
  readonly startLine: number;
  readonly endLine: number;
}

const MarkdownParser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

export function parseMarkdownSections(content: string): AgentMarkdownDocument {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split("\n");
  const headings = readHeadings(MarkdownParser.parse(normalized, {}));
  const sectionHeadings = headings.filter((heading) => heading.level === 2);
  const sections = new Map<string, string>();

  sectionHeadings.forEach((heading, index) => {
    const nextHeading = sectionHeadings[index + 1];
    sections.set(
      heading.title,
      lines
        .slice(heading.endLine, nextHeading?.startLine ?? lines.length)
        .join("\n")
        .trim(),
    );
  });

  return {
    title: headings.find((heading) => heading.level === 1)?.title,
    sections,
  };
}

export function normalizeMarkdownSectionText(value: string | undefined): string {
  return normalizeLineEndings(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function readHeadings(tokens: readonly Token[]): AgentMarkdownHeading[] {
  return tokens.flatMap((token, index) => {
    if (token.type !== "heading_open" || !token.map) return [];
    const level = headingLevel(token.tag);
    const inline = tokens[index + 1];
    if (!level || inline?.type !== "inline") return [];
    return [
      {
        level,
        title: inline.content.trim(),
        startLine: token.map[0],
        endLine: token.map[1],
      },
    ];
  });
}

function headingLevel(tag: string): number | undefined {
  if (!tag.startsWith("h")) return undefined;
  const level = Number(tag.slice(1));
  return Number.isInteger(level) && level > 0 ? level : undefined;
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
