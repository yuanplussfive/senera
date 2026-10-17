export interface AgentDisplayLineOptions {
  maxChars?: number;
  ellipsis?: string;
}

const CollapsedWhitespacePattern = /\s+/gu;
const DefaultEllipsis = "...";

export function projectDisplayLine(value: string, options: AgentDisplayLineOptions = {}): string {
  return clampDisplayLine(collapseDisplayWhitespace(value), options);
}

export function collapseDisplayWhitespace(value: string): string {
  return value.replace(CollapsedWhitespacePattern, " ").trim();
}

function clampDisplayLine(value: string, options: AgentDisplayLineOptions): string {
  const maxChars = options.maxChars;
  if (maxChars === undefined || maxChars <= 0) {
    return value;
  }

  const symbols = Array.from(value);
  if (symbols.length <= maxChars) {
    return value;
  }

  const ellipsis = options.ellipsis ?? DefaultEllipsis;
  const budget = Math.max(0, maxChars - Array.from(ellipsis).length);
  return `${symbols.slice(0, budget).join("")}${ellipsis}`;
}
