import { useMemo } from "react";
import type { ModelProviderListItem, ModelThinkingLevel } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  AppIcon,
} from "../../shared/ui";
import { MotionButton } from "../../shared/motion";
import { ModelProviderIcon } from "./ModelProviderIcon";
import { readChatModelProviders, readSelectedModelProvider } from "./modelProvider";

export function ChatModelSelector({
  disabled,
  models,
  selectedId,
  defaultModelId,
  selectedThinkingLevel,
  onSelect,
  onSelectThinkingLevel,
  prefersCompactControls,
}: {
  disabled: boolean;
  models: ModelProviderListItem[];
  selectedId: string | null;
  defaultModelId?: string | null;
  selectedThinkingLevel: ModelThinkingLevel | null;
  onSelect: (id: string) => void;
  onSelectThinkingLevel: (level: ModelThinkingLevel) => void;
  prefersCompactControls: boolean;
}): JSX.Element {
  const chatModels = useMemo(() => readChatModelProviders(models), [models]);
  // A conversation without its own choice inherits the configured default, so the default
  // model — not a stale id — is what the menu and the trigger display.
  const selected = useMemo(
    () => readSelectedModelProvider(chatModels, selectedId ?? defaultModelId ?? null) ?? null,
    [chatModels, selectedId, defaultModelId],
  );
  const label = selected?.model.trim() || frontendMessage("chat.composer.selectModel");
  const thinkingLevels = selected?.capabilities.Reasoning ? (selected.thinkingLevels ?? []) : [];
  const hasThinkingLevels = thinkingLevels.length > 1;
  const selectedLevel =
    selectedThinkingLevel && thinkingLevels.includes(selectedThinkingLevel)
      ? selectedThinkingLevel
      : (selected?.defaultThinkingLevel ?? thinkingLevels[0]);
  const selectorDisabled = disabled;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={selectorDisabled}>
        <MotionButton
          className={cn(
            "inline-flex h-8 min-w-0 max-w-[280px] items-center gap-1 rounded-md border-0 bg-transparent px-2 text-[12px] font-medium",
            prefersCompactControls && "h-11 max-w-[200px] px-2",
            "text-content-secondary shadow-none transition-colors hover:bg-surface-hover data-[state=open]:bg-surface-muted data-[state=open]:text-content-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            selectorDisabled && "pointer-events-none opacity-55",
          )}
          aria-label={frontendMessage("chat.composer.selectModel")}
          data-composer-model-selector
        >
          <span className="truncate">{label}</span>
          <AppIcon icon="chevron-down" size={10} className="shrink-0 text-content-muted" />
        </MotionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        className="w-[min(280px,calc(100vw-24px))] p-1"
      >
        <div className="min-w-0">
          {chatModels.length > 0 ? (
            <DropdownMenuGroup className="max-h-[min(360px,calc(100dvh-200px))] overflow-y-auto pr-1 ">
              {chatModels.map((model) => {
                const active = model.id === selected?.id;
                return (
                  <DropdownMenuItem
                    key={model.id}
                    onSelect={() => onSelect(model.id)}
                    className="h-10 py-2"
                    icon={<ModelProviderIcon icon={model.icon} size={14} />}
                    trailing={
                      active ? <AppIcon icon="checkmark" size={14} className="text-accent-content" /> : undefined
                    }
                  >
                    <span className="min-w-0 truncate text-[13px] text-content-primary">
                      {model.model.trim() || "..."}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ) : (
            <div className="px-2 py-3 text-[12px] text-content-muted">
              {frontendMessage("config.model.noConfigured")}
            </div>
          )}
        </div>
        {hasThinkingLevels ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="min-w-0 flex-1 truncate text-[13px] text-content-primary">
                  {frontendMessage("chat.thinking.label")}
                </span>
                <span className="ml-2 shrink-0 text-[12px] text-content-muted">
                  {frontendMessage(readThinkingLevelLabelKey(selectedLevel))}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-[160px]">
                {thinkingLevels.map((level) => {
                  const profile = selected?.thinkingProfiles?.find((item) => item.level === level);
                  const label = profile?.label || frontendMessage(readThinkingLevelLabelKey(level));
                  return (
                    <DropdownMenuItem
                      key={level}
                      onClick={() => onSelectThinkingLevel(level)}
                      className="h-9 py-1.5"
                      trailing={
                        level === selectedLevel ? (
                          <AppIcon icon="checkmark" size={14} className="text-accent-content" />
                        ) : undefined
                      }
                    >
                      <span className="min-w-0 truncate text-[13px] text-content-primary">{label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function readThinkingLevelLabelKey(level: ModelThinkingLevel | undefined): Parameters<typeof frontendMessage>[0] {
  switch (level) {
    case "off":
      return "chat.thinking.off";
    case "minimal":
      return "chat.thinking.minimal";
    case "low":
      return "chat.thinking.low";
    case "high":
      return "chat.thinking.high";
    case "xhigh":
      return "chat.thinking.xhigh";
    case "max":
      return "chat.thinking.max";
    case "medium":
    default:
      return "chat.thinking.medium";
  }
}
