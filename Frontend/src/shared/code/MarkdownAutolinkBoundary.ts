interface MarkdownNode {
  type?: string;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  position?: MarkdownNodePosition;
  [key: string]: unknown;
}

interface MarkdownNodePosition {
  start?: MarkdownNodePoint;
  end?: MarkdownNodePoint;
}

interface MarkdownNodePoint {
  offset?: number;
  [key: string]: unknown;
}

const HTTP_URL_PATTERN = /^https?:\/\//i;
const UNICODE_PUNCTUATION_PATTERN = /^\p{P}$/u;

/**
 * GFM's literal URL grammar accepts unescaped Unicode punctuation in a path.
 * In chat text that can turn the following sentence into the same link. Split
 * only literal autolinks after parsing so explicit Markdown links stay intact.
 */
export function normalizeLiteralAutolinkBoundaries(): (tree: unknown) => void {
  return (tree) => {
    if (!isMarkdownNode(tree)) return;
    normalizeChildren(tree);
  };
}

function normalizeChildren(node: MarkdownNode): void {
  if (!Array.isArray(node.children)) return;

  const normalizedChildren: MarkdownNode[] = [];
  for (const child of node.children) {
    normalizeChildren(child);
    const split = splitLiteralAutolink(child);
    if (split) {
      normalizedChildren.push(...split);
    } else {
      normalizedChildren.push(child);
    }
  }

  node.children = normalizedChildren;
}

function splitLiteralAutolink(node: MarkdownNode): MarkdownNode[] | undefined {
  if (node.type !== "link" || typeof node.url !== "string" || !HTTP_URL_PATTERN.test(node.url)) return undefined;

  const text = readNodeText(node);
  if (!text || text !== node.url || !isLiteralAutolink(node, text)) return undefined;

  const boundary = findUrlBoundary(text);
  if (boundary === undefined) return undefined;

  const url = text.slice(0, boundary);
  if (!isValidHttpUrl(url)) return undefined;

  const linkNode: MarkdownNode = {
    ...node,
    url,
    children: [{ type: "text", value: url }],
  };
  delete linkNode.position;

  return [linkNode, { type: "text", value: text.slice(boundary) }];
}

function isLiteralAutolink(node: MarkdownNode, text: string): boolean {
  const startOffset = node.position?.start?.offset;
  const endOffset = node.position?.end?.offset;
  return typeof startOffset === "number" && typeof endOffset === "number" && endOffset - startOffset === text.length;
}

function findUrlBoundary(value: string): number | undefined {
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;

    const character = String.fromCodePoint(codePoint);
    if (isSentenceBoundary(character, codePoint)) return index;
    index += character.length;
  }

  return undefined;
}

function isSentenceBoundary(character: string, codePoint: number): boolean {
  if (/\s/u.test(character)) return true;
  return codePoint > 0x7f && UNICODE_PUNCTUATION_PATTERN.test(character);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^https?:$/i.test(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function readNodeText(node: MarkdownNode): string | undefined {
  if (node.type === "text") return typeof node.value === "string" ? node.value : undefined;
  if (!Array.isArray(node.children)) return undefined;

  let text = "";
  for (const child of node.children) {
    const childText = readNodeText(child);
    if (childText === undefined) return undefined;
    text += childText;
  }
  return text;
}

function isMarkdownNode(value: unknown): value is MarkdownNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
