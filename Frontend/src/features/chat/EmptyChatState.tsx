import { useRef } from "react";
import { resolveRuntimeEmptySuggestions } from "../../config/runtimeConfig";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { cn } from "../../lib/util";
import { FluidHoverHighlight, useFluidHover, useMotionLevel } from "../../shared/motion";
import { parseEmptySuggestions } from "./emptySuggestions";

export function EmptyChatState({
  onSelectSuggestion,
}: {
  onSelectSuggestion?: (suggestion: string) => void;
}): JSX.Element {
  const locale = useFrontendLocale();
  const { disableMotion } = useMotionLevel();
  const suggestions = parseEmptySuggestions(resolveRuntimeEmptySuggestions(__SENERA_EMPTY_SUGGESTIONS__), locale);
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(listRef, { axis: "y", gapClick: false });
  return (
    <div className="flex w-full max-w-[520px] flex-col items-start text-left" data-ui-chrome>
      <h2 className="text-[18px] font-semibold leading-7 text-ink-900">{frontendMessage("chat.empty.title")}</h2>
      {suggestions.length > 0 ? (
        <div
          ref={listRef}
          className="relative mt-4 w-full divide-y divide-ink-200/80 border-b border-ink-200/80"
          {...hover.handlers}
        >
          <FluidHoverHighlight hover={hover} hidden={disableMotion} surfaceClassName="bg-ink-900/[0.025]" />
          {suggestions.map((suggestion, index) =>
            onSelectSuggestion ? (
              <button
                key={suggestion}
                ref={hover.getItemRef(index)}
                type="button"
                onClick={() => onSelectSuggestion(suggestion)}
                className={cn(
                  "relative z-10 flex w-full px-1 py-2.5 text-left text-[13.5px] text-ink-650 transition-colors duration-150 hover:text-ink-950 focus:outline-none focus-visible:bg-ink-900/[0.045] focus-visible:text-ink-950",
                  disableMotion ? "hover:bg-ink-900/[0.025]" : "hover:bg-transparent",
                )}
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
