import { Tooltip } from "../ui/Tooltip";
import type { SearchSelectProps } from "../ui/SearchSelect";
import { SearchSelect } from "../ui/SearchSelect";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { ModelProviderIcon, inferModelProviderIcon, inferModelProviderEndpointIcon } from "./ModelProviderIcon";

export interface ModelSelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  badge?: string;
  disabled?: boolean;
}

export interface ModelSelectProps extends Omit<SearchSelectProps, "options" | "leading" | "renderOption"> {
  options: readonly ModelSelectOption[];
  showSelectedIcon?: boolean;
}

/** Model identity, search and selection share one presentation across chat and configuration. */
export function ModelSelect({
  options,
  value,
  showSelectedIcon = true,
  emptyState,
  ...props
}: ModelSelectProps): JSX.Element {
  const selected = options.find((option) => option.value === value);
  return (
    <SearchSelect
      {...props}
      value={value}
      options={options}
      emptyState={
        emptyState ?? frontendMessage(props.allowCustom ? "settings.selection.customHint" : "chat.model.noMatches")
      }
      leading={showSelectedIcon && selected?.icon ? <ModelProviderIcon icon={selected.icon} size={16} /> : undefined}
      renderOption={(option) => {
        const model = option as ModelSelectOption;
        return (
          <Tooltip content={model.description}>
            <span className="flex min-w-0 items-center gap-2.5">
              {model.icon ? <ModelProviderIcon icon={model.icon} size={17} /> : null}
              <span className="min-w-0 flex-1 truncate">{model.label}</span>
              {model.badge ? <span className="shrink-0 text-[10px] text-content-muted">{model.badge}</span> : null}
            </span>
          </Tooltip>
        );
      }}
    />
  );
}

export function resolveModelIcon(model: {
  icon?: string;
  model: string;
  providerId?: string;
  id?: string;
  baseUrl?: string;
  kind?: string;
}): string | undefined {
  if (model.icon?.trim()) return model.icon;
  const inferred = inferModelProviderIcon(model.model, false);
  if (inferred) return inferred;
  for (const candidate of [model.providerId, model.id, model.baseUrl, model.kind]) {
    if (!candidate) continue;
    const icon = inferModelProviderEndpointIcon(candidate, false);
    if (icon) return icon;
  }
  return inferModelProviderIcon(model.model);
}

export function modelSelectOption(model: Parameters<typeof resolveModelIcon>[0] & { id: string }): ModelSelectOption {
  return {
    value: model.id,
    label: model.model || model.id,
    description: model.providerId,
    icon: resolveModelIcon(model),
  };
}
