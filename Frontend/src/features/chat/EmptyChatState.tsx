import { LogoMark } from "../../shared/ui";
import { resolveRuntimeEmptySuggestions } from "../../config/runtimeConfig";
import { parseEmptySuggestions } from "./emptySuggestions";

export function EmptyChatState({
  onSelectSuggestion,
}: {
  onSelectSuggestion?: (suggestion: string) => void;
}): JSX.Element {
  const suggestions = parseEmptySuggestions(resolveRuntimeEmptySuggestions(__SENERA_EMPTY_SUGGESTIONS__));
  return (
    <div className="flex max-w-xl flex-col items-center text-center">
      <LogoMark size={34} />
      <h2 className="mt-5 font-serif text-[26px] italic text-ink-900" style={{ fontWeight: 500 }}>
        今天想做点什么？
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-500">
        senera 用行动决策协议帮你完成工作
      </p>
      {suggestions.length > 0 ? (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {suggestions.map((suggestion) => (
            onSelectSuggestion ? (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSelectSuggestion(suggestion)}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper-100 px-3 py-1 text-[12.5px] text-ink-700 transition hover:border-ink-300 hover:bg-paper-50 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-terra-200/60"
              >
                {suggestion}
              </button>
            ) : (
              <span
                key={suggestion}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper-100 px-3 py-1 text-[12.5px] text-ink-700"
              >
                {suggestion}
              </span>
            )
          ))}
        </div>
      ) : null}
    </div>
  );
}
