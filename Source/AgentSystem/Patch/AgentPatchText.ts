export function contentToLines(content: string): string[] {
  const normalized = normalizeLineEndings(content);
  if (normalized.length === 0) {
    return [];
  }
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
}

export function linesToContent(lines: string[]): string {
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function ensureTrailingNewline(content: string): string {
  const normalized = normalizeLineEndings(content);
  return normalized.length > 0 && !normalized.endsWith("\n")
    ? `${normalized}\n`
    : normalized;
}

function normalizeLineEndings(value: string): string {
  return value.split("\r\n").join("\n").split("\r").join("\n");
}
