import { Check, ChevronDown } from "lucide-react";
import type { ModelProviderListItem, ModelThinkingLevel } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { MotionButton } from "../../shared/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/ui";
import { ModelThinkingLevelMessageKeys } from "./modelThinking";

interface ThinkingSelectorProps {
  disabled: boolean;
  model?: ModelProviderListItem;
  selectedLevel: ModelThinkingLevel | null;
  onSelect: (level: ModelThinkingLevel) => void;
  prefersCompactControls: boolean;
}

export function ThinkingSelector({
  disabled,
  model,
  selectedLevel,
  onSelect,
  prefersCompactControls,
}: ThinkingSelectorProps): JSX.Element | null {
  const levels = model?.thinkingLevels ?? [];
  if (levels.length <= 1) return null;
  const selected =
    selectedLevel && levels.includes(selectedLevel) ? selectedLevel : (model?.defaultThinkingLevel ?? levels[0]);
  const profile = model?.thinkingProfiles?.find((item) => item.level === selected);
  const label = profile?.label || frontendMessage(ModelThinkingLevelMessageKeys[selected]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <MotionButton
          className={cn(
            "group inline-flex h-8 min-w-0 max-w-[112px] items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11.5px] font-medium text-content-muted shadow-none transition-colors hover:bg-surface-hover hover:text-content-primary data-[state=open]:bg-surface-hover data-[state=open]:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            prefersCompactControls && "h-9 max-w-[86px] px-1",
            disabled && "pointer-events-none opacity-55",
          )}
          aria-label={frontendMessage("chat.thinking.select")}
          data-composer-thinking-selector
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-content-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
        </MotionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-[min(220px,calc(100vw-24px))]">
        <DropdownMenuLabel>{frontendMessage("chat.thinking.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {levels.map((level) => {
            const customLabel = model?.thinkingProfiles?.find((item) => item.level === level)?.label;
            return (
              <DropdownMenuItem
                key={level}
                onSelect={() => onSelect(level)}
                className="h-9 py-1.5"
                icon={
                  level === selected ? (
                    <Check className="h-3.5 w-3.5 text-accent-content" />
                  ) : (
                    <span className="h-3.5 w-3.5" />
                  )
                }
              >
                <span className="min-w-0 truncate text-[13px] text-content-primary">
                  {customLabel || frontendMessage(ModelThinkingLevelMessageKeys[level])}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
