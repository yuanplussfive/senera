export const DEFAULT_EMPTY_SUGGESTIONS = [
  "整理今天的工作优先级",
  "分析一段错误日志",
  "把需求拆成可执行步骤",
] as const;

export function parseEmptySuggestions(value?: string | string[]): string[] {
  const suggestions = Array.isArray(value)
    ? value
    : (value ?? "").split("|");
  const normalized = suggestions
    .map((suggestion) => suggestion.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : [...DEFAULT_EMPTY_SUGGESTIONS];
}
