import { useMemo } from "react";
import type { ModelProviderListItem, ModelThinkingLevel } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon, InlineError, MenuSelect } from "../../shared/ui";
import {
  AgentModelPlanningRequirements,
  readAgentModelRequirementIssues,
} from "../../api/generatedModelCapabilityContract";
import { ModelSelect, modelSelectOption } from "../../shared/models/ModelSelect";
import { readChatModelProviders, readSelectedModelProvider } from "./modelProvider";
import { composerControlClassName } from "./composerControls";

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
  const selected = readSelectedModelProvider(models, selectedId ?? defaultModelId ?? null);
  const defaultModel = readSelectedModelProvider(chatModels, defaultModelId ?? null);
  const missing = selected
    ? readAgentModelRequirementIssues(
        { ...selected.capabilities, Stream: selected.stream },
        AgentModelPlanningRequirements[selected.toolPlanningMode],
      )
    : [];
  const incompatibility = missing.length
    ? frontendMessage("chat.model.requirementsNotMet", { missing: missing.join(", ") })
    : undefined;
  const options = chatModels.map((model) => ({
    ...modelSelectOption(model),
    badge: model.id === defaultModel?.id ? frontendMessage("chat.model.defaultBadge") : undefined,
  }));
  if (selected && incompatibility) {
    options.unshift({
      ...modelSelectOption(selected),
      disabled: true,
      badge: frontendMessage("chat.model.incompatible"),
      description: incompatibility,
    });
  }
  const levels = selected?.capabilities.Reasoning ? (selected.thinkingLevels ?? []) : [];
  const level =
    selectedThinkingLevel && levels.includes(selectedThinkingLevel)
      ? selectedThinkingLevel
      : (selected?.defaultThinkingLevel ?? levels[0]);
  return (
    <div
      data-composer-model-selector
      className={cn("min-w-0 max-w-[220px] flex-1", prefersCompactControls && "max-w-[176px]")}
    >
      <ModelSelect
        showSelectedIcon={false}
        value={selected?.id ?? ""}
        disabled={disabled || !options.length}
        ariaLabel={frontendMessage("chat.composer.selectModel")}
        placeholder={frontendMessage("chat.model.search")}
        side="top"
        onChange={onSelect}
        emptyState={frontendMessage(chatModels.length ? "chat.model.noMatches" : "config.model.noConfigured")}
        options={options}
        renderValue={(value, option) => (
          <span className="flex w-full min-w-0 items-center justify-center text-xs leading-5" title={incompatibility}>
            <span className="min-w-0 truncate">{option?.label ?? value}</span>
          </span>
        )}
        triggerClassName={cn(
          "max-w-[220px] rounded-lg border-0 bg-transparent text-content-secondary [&_input]:text-xs",
          composerControlClassName(prefersCompactControls),
          prefersCompactControls && "max-w-[176px]",
        )}
        footer={() => (
          <>
            {incompatibility ? <InlineError className="px-2 py-2">{incompatibility}</InlineError> : null}
            {levels.length > 1 ? (
              <div className="flex items-center gap-3 border-t border-line-subtle px-2 py-2.5">
                <AppIcon icon="brain" size={16} className="text-content-muted" />
                <span className="flex-1 text-xs text-content-secondary">{frontendMessage("chat.thinking.label")}</span>
                <MenuSelect
                  ariaLabel={frontendMessage("chat.thinking.label")}
                  placeholder={frontendMessage("chat.thinking.label")}
                  value={level ?? ""}
                  options={levels.map((value) => ({
                    value,
                    label: selected?.thinkingProfiles?.find((profile) => profile.level === value)?.label || value,
                  }))}
                  onChange={(value) => {
                    const next = levels.find((candidate) => candidate === value);
                    if (next) onSelectThinkingLevel(next);
                  }}
                  triggerClassName="w-auto min-w-24 border-0 bg-surface-subtle"
                />
              </div>
            ) : null}
          </>
        )}
      />
    </div>
  );
}
