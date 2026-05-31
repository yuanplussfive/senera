export const DEFAULT_EMPTY_SUGGESTIONS = [
  "整理今天的工作优先级",
  "分析一段错误日志",
  "把需求拆成可执行步骤",
] as const;

export function parseEmptySuggestions(value?: string): string[] {
  const suggestions = (value ?? "")
    .split("|")
    .map((suggestion) => suggestion.trim())
    .filter(Boolean);

  return suggestions.length > 0 ? suggestions : [...DEFAULT_EMPTY_SUGGESTIONS];
}
