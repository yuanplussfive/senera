import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export const DEFAULT_EMPTY_SUGGESTIONS = [
  frontendMessage("chat.emptySuggestion.prioritizeWork"),
  frontendMessage("chat.emptySuggestion.analyzeError"),
  frontendMessage("chat.emptySuggestion.breakDownRequest"),
] as const;

export function parseEmptySuggestions(value?: string | string[]): string[] {
  const suggestions = Array.isArray(value) ? value : (value ?? "").split("|");
  const normalized = suggestions.map((suggestion) => suggestion.trim()).filter(Boolean);

  return normalized.length > 0 ? normalized : [...DEFAULT_EMPTY_SUGGESTIONS];
}
