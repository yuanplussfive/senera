import { resolveRuntimeEmptySuggestions } from "../../config/runtimeConfig";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { parseEmptySuggestions } from "./emptySuggestions";

export function EmptyChatState({
  onSelectSuggestion,
}: {
  onSelectSuggestion?: (suggestion: string) => void;
}): JSX.Element {
  const suggestions = parseEmptySuggestions(resolveRuntimeEmptySuggestions(__SENERA_EMPTY_SUGGESTIONS__));
  return (
    <div className="flex w-full max-w-[520px] flex-col items-start text-left" data-ui-chrome>
      <h2 className="text-[18px] font-semibold leading-7 text-ink-900">{frontendMessage("chat.empty.title")}</h2>
      {suggestions.length > 0 ? (
        <div className="mt-4 w-full divide-y divide-ink-200/80 border-y border-ink-200/80">
          {suggestions.map((suggestion) =>
            onSelectSuggestion ? (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSelectSuggestion(suggestion)}
                className="flex w-full px-1 py-2.5 text-left text-[13.5px] text-ink-650 transition-colors duration-150 hover:bg-ink-900/[0.025] hover:text-ink-950 focus:outline-none focus-visible:bg-ink-900/[0.045] focus-visible:text-ink-950"
              >
                <span>{suggestion}</span>
              </button>
            ) : (
              <span key={suggestion} className="block px-1 py-2.5 text-[13.5px] text-ink-600">
                {suggestion}
              </span>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
