import { useMemo } from "react";
import { Check, ChevronDown, RotateCcw, Settings2 } from "lucide-react";
import type { ModelProviderListItem } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/ui";
import { MotionButton } from "../../shared/motion";
import { ModelProviderIcon } from "./ModelProviderIcon";
import { readChatModelProviders, readSelectedModelProvider } from "./modelProvider";

export function ChatModelSelector({
  disabled,
  models,
  selectedId,
  defaultModelId,
  onSelect,
  onUseDefault,
  onAddModel,
  prefersCompactControls,
}: {
  disabled: boolean;
  models: ModelProviderListItem[];
  selectedId: string | null;
  defaultModelId?: string | null;
  onSelect: (id: string) => void;
  onUseDefault?: () => void;
  onAddModel?: () => void;
  prefersCompactControls: boolean;
}): JSX.Element {
  const chatModels = useMemo(() => readChatModelProviders(models), [models]);
  const selected = useMemo(() => readSelectedModelProvider(chatModels, selectedId) ?? null, [chatModels, selectedId]);
  const label = selected ? readModelSelectorLabel(selected) : frontendMessage("chat.composer.selectModel");
  const defaultModel = useMemo(
    () => readSelectedModelProvider(chatModels, defaultModelId ?? null) ?? null,
    [chatModels, defaultModelId],
  );
  const usesDefault = Boolean(defaultModel && defaultModel.id === selected?.id);
  const selectorDisabled = disabled || (chatModels.length === 0 && !onAddModel);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={selectorDisabled}>
        <MotionButton
          className={cn(
            "group inline-flex h-8 min-w-0 max-w-[280px] items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11.5px] font-medium",
            prefersCompactControls && "h-9 max-w-[200px] px-1",
            "text-content-muted shadow-none transition-colors hover:bg-surface-hover hover:text-content-primary data-[state=open]:bg-surface-hover data-[state=open]:text-content-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            selectorDisabled && "pointer-events-none opacity-55",
          )}
          aria-label={frontendMessage("chat.composer.selectModel")}
          data-composer-model-selector
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-content-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
        </MotionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-[min(280px,calc(100vw-24px))]">
        <DropdownMenuLabel>{frontendMessage("chat.model.currentConversation")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {chatModels.length > 0 ? (
          <DropdownMenuGroup className="max-h-[min(360px,calc(100dvh-200px))] overflow-y-auto pr-1 scrollbar-thin">
            {chatModels.map((model) => {
              const active = model.id === selected?.id;
              return (
                <DropdownMenuItem
                  key={model.id}
                  onSelect={() => onSelect(model.id)}
                  className="h-10 py-2"
                  icon={
                    active ? (
                      <Check className="h-3.5 w-3.5 text-accent-content" />
                    ) : (
                      <ModelProviderIcon icon={model.icon} size={14} />
                    )
                  }
                >
                  <span className="min-w-0 truncate text-[13px] text-content-primary">
                    {readModelSelectorLabel(model)}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ) : (
          <div className="px-2 py-3 text-[12px] text-content-muted">{frontendMessage("config.model.noConfigured")}</div>
        )}
        {!usesDefault && defaultModel && onUseDefault ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[11px] text-content-muted">
              {frontendMessage("chat.model.defaultHint", { model: readModelSelectorLabel(defaultModel) })}
            </div>
            <DropdownMenuItem
              onSelect={onUseDefault}
              className="h-10 py-2"
              icon={<RotateCcw className="h-3.5 w-3.5 text-accent-content" />}
            >
              <span className="min-w-0 truncate text-[13px] text-content-primary">
                {frontendMessage("chat.model.useDefault")}
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
        {onAddModel ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onAddModel}
              className="h-10 bg-surface-muted py-2"
              icon={<Settings2 className="h-3.5 w-3.5 text-content-secondary" />}
            >
              <span className="min-w-0 truncate text-[13px] text-content-primary">
                {frontendMessage("config.model.addModel")}
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function readModelSelectorLabel(model: ModelProviderListItem | null | undefined): string {
  return model?.model.trim() || "...";
}
