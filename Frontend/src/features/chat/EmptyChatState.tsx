import { ArrowUpRight } from "lucide-react";
import { LogoMark } from "../../shared/ui";
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
    <div className="flex w-full max-w-[560px] flex-col items-start text-left">
      <LogoMark size={30} />
      <h2 className="mt-6 text-[28px] font-semibold leading-9 text-ink-950">
        {frontendMessage("chat.empty.title")}
      </h2>
      <p className="mt-2 max-w-md text-[14px] leading-6 text-ink-500">{frontendMessage("chat.empty.subtitle")}</p>
      {suggestions.length > 0 ? (
        <div className="mt-8 w-full divide-y divide-ink-200 border-y border-ink-200">
          {suggestions.map((suggestion) =>
            onSelectSuggestion ? (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSelectSuggestion(suggestion)}
                className="group flex w-full items-center justify-between gap-4 px-3 py-3 text-left text-[13.5px] text-ink-700 transition-colors duration-150 hover:bg-ink-900/[0.035] hover:text-ink-950 focus:outline-none focus-visible:bg-ink-900/[0.045] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terra-300/60"
              >
                <span>{suggestion}</span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-350 transition-colors group-hover:text-terra-600" />
              </button>
            ) : (
              <span
                key={suggestion}
                className="block px-3 py-3 text-[13.5px] text-ink-600"
              >
                {suggestion}
              </span>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
