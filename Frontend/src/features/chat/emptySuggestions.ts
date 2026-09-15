import {
  FrontendLocales,
  frontendMessage,
  type FrontendLocale,
  type FrontendMessageKey,
} from "../../i18n/frontendMessageCatalog";
import { getFrontendLocale } from "../../i18n/frontendLocaleStore";

const DEFAULT_EMPTY_SUGGESTION_KEYS = [
  "chat.emptySuggestion.prioritizeWork",
  "chat.emptySuggestion.analyzeError",
  "chat.emptySuggestion.breakDownRequest",
] as const satisfies readonly FrontendMessageKey[];

export function parseEmptySuggestions(
  value?: string | string[],
  locale: FrontendLocale = getFrontendLocale(),
): string[] {
  const suggestions = Array.isArray(value) ? value : (value ?? "").split("|");
  const normalized = suggestions.map((suggestion) => suggestion.trim()).filter(Boolean);

  return normalized.length > 0 && !isCatalogDefaultSuggestionSet(normalized)
    ? normalized
    : readCatalogDefaultSuggestions(locale);
}

function isCatalogDefaultSuggestionSet(suggestions: readonly string[]): boolean {
  return Object.values(FrontendLocales).some((locale) => {
    const localizedDefaults = readCatalogDefaultSuggestions(locale);
    return (
      suggestions.length === localizedDefaults.length &&
      suggestions.every((suggestion, index) => suggestion === localizedDefaults[index])
    );
  });
}

function readCatalogDefaultSuggestions(locale: FrontendLocale): string[] {
  return DEFAULT_EMPTY_SUGGESTION_KEYS.map((key) => frontendMessage(key, {}, locale));
}
