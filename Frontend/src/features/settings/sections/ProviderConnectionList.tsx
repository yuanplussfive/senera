import { MoreVertical, PenLine, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { SettingsConfigCommands } from "../SettingsContracts";
import { cn } from "../../../lib/util";
import { motionTimings, useMotionLevel } from "../../../shared/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  ScrollArea,
} from "../../../shared/ui";
import { inferModelProviderEndpointIcon, ModelProviderIcon } from "../../chat/ModelProviderIcon";
import { EmptyList, ProviderStatusIcon, SearchInput } from "../../chat/ModelConfigPrimitives";
import { providerEnabled, providerIdLabel, sortProviderRows } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import { isProtectedProvider } from "./ProviderConnectionIdentity";

export function ProviderConnectionList({
  providers,
  catalogs,
  errors,
  loadingProviderIds,
  selectedProviderId,
  compact = false,
  disabled,
  onRequestAdd,
  onSelect,
  onRename,
  onDelete,
}: {
  providers: ProviderEndpointDraft[];
  catalogs: SettingsConfigCommands["providerModelCatalogs"];
  errors: SettingsConfigCommands["providerModelErrors"];
  loadingProviderIds: SettingsConfigCommands["providerModelLoadingIds"];
  selectedProviderId: string | null;
  compact?: boolean;
  disabled: boolean;
  onRequestAdd: () => void;
  onSelect: (provider: ProviderEndpointDraft) => void;
  onRename: (provider: ProviderEndpointDraft) => void;
  onDelete: (provider: ProviderEndpointDraft) => void;
}): JSX.Element {
  const [providerSearch, setProviderSearch] = useState("");
  const { reduceMotion, disableMotion } = useMotionLevel();
  const animateSelection = !reduceMotion && !disableMotion;
  const providerQuery = providerSearch.trim().toLowerCase();
  const providerResults = sortProviderRows(providers).filter(({ provider }) => {
    if (!providerQuery) return true;
    return [providerIdLabel(provider), provider.Id, provider.BaseUrl, provider.ApiVersion].some((value) =>
      String(value ?? "")
        .toLowerCase()
        .includes(providerQuery),
    );
  });
  const providerRows =
    providers.length > 0 ? (
      <div className="space-y-0.5 p-2">
        {providerResults.map(({ provider }) => {
          const active = provider.Id === selectedProviderId;
          const catalog = provider.Id ? catalogs[provider.Id] : undefined;
          const error = provider.Id ? errors[provider.Id] : undefined;
          const loading = provider.Id ? loadingProviderIds[provider.Id] : false;
          const enabled = providerEnabled(provider);
          const modelCount = catalog?.models.length ?? 0;
          const protectedProvider = isProtectedProvider(provider.Id);
          const statusText = loading
            ? frontendMessage("settings.modelManagement.fetching")
            : error
              ? frontendMessage("settings.modelManagement.fetchFailed", { error: error.message })
              : catalog
                ? frontendMessage("settings.provider.modelsCount", { count: modelCount })
                : null;
          return (
            <div
              key={provider.Id}
              className={cn(
                "relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-0.5 rounded-md px-1.5 py-1.5 transition-colors",
                active ? "text-ink-900" : "text-ink-650 hover:bg-ink-900/[0.03] hover:text-ink-900",
                !enabled && "opacity-65",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={animateSelection ? "settings-provider-selection" : undefined}
                  className="absolute inset-0 rounded-md bg-content-strong/[0.055] shadow-panel"
                  transition={animateSelection ? motionTimings.selection : { duration: 0 }}
                  aria-hidden="true"
                  data-provider-selection-indicator
                />
              ) : null}
              <button
                type="button"
                disabled={disabled}
                className="relative z-[1] grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-left disabled:pointer-events-none disabled:opacity-60"
                aria-label={frontendMessage("settings.provider.rowAria", {
                  provider: providerIdLabel(provider),
                  models: frontendMessage("settings.provider.modelsCount", { count: modelCount }),
                  state: frontendMessage(enabled ? "settings.provider.enabled" : "settings.provider.disabled"),
                  selected: active ? frontendMessage("settings.provider.selectedSuffix") : "",
                })}
                aria-pressed={active}
                onClick={() => onSelect(provider)}
              >
                <span className="grid h-8 w-8 place-items-center overflow-hidden">
                  <ModelProviderIcon icon={provider.Icon || inferModelProviderEndpointIcon(provider.Id)} size={19} />
                </span>
                <span className="min-w-0 self-center">
                  <span className="block truncate text-[12.5px] font-semibold" title={providerIdLabel(provider)}>
                    {providerIdLabel(provider)}
                  </span>
                  {statusText ? (
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10.5px] text-ink-500">
                      <ProviderStatusIcon loading={loading} catalog={catalog} error={error} />
                      <span className="truncate">{statusText}</span>
                    </span>
                  ) : null}
                </span>
              </button>
              <span
                className={cn(
                  "relative z-[1] inline-flex min-w-[30px] items-center justify-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]",
                  enabled
                    ? "border-accent-border/45 bg-accent-surface text-accent-content"
                    : "border-ink-200/80 bg-ink-900/[0.025] text-ink-450",
                )}
                aria-label={frontendMessage(enabled ? "settings.provider.statusOn" : "settings.provider.statusOff")}
              >
                {frontendMessage(enabled ? "settings.provider.statusOn" : "settings.provider.statusOff")}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    className="relative z-[1] grid h-8 w-8 place-items-center rounded-md text-ink-400 transition hover:bg-ink-900/[0.045] hover:text-ink-800 disabled:pointer-events-none disabled:opacity-45"
                    aria-label={frontendMessage("settings.provider.operations")}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 bg-paper-50">
                  <DropdownMenuItem
                    icon={<PenLine className="h-3.5 w-3.5" />}
                    disabled={protectedProvider}
                    onSelect={() => onRename(provider)}
                  >
                    {frontendMessage("settings.provider.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    destructive
                    disabled={protectedProvider}
                    onSelect={() => onDelete(provider)}
                  >
                    {frontendMessage("settings.action.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
        {providerResults.length === 0 ? <EmptyList text={frontendMessage("settings.provider.searchEmpty")} /> : null}
      </div>
    ) : (
      <EmptyList text={frontendMessage("settings.provider.addDescription")} />
    );
  const addProviderButton = (
    <IconButton
      label={frontendMessage("settings.provider.add")}
      tooltip={frontendMessage("settings.provider.add")}
      tone="muted"
      disabled={disabled}
      onClick={onRequestAdd}
    >
      <Plus className="h-4 w-4" />
    </IconButton>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-ink-200/55 bg-paper-50/80 p-3">
        {compact ? (
          <div className="flex min-w-0 items-center gap-2" data-provider-list-toolbar="compact">
            <SearchInput
              value={providerSearch}
              disabled={providers.length === 0}
              placeholder={frontendMessage("settings.provider.searchPlaceholder")}
              className="flex-1"
              onChange={setProviderSearch}
            />
            {addProviderButton}
          </div>
        ) : (
          <>
            <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink-900">
                  {frontendMessage("settings.model.serviceTitle")}
                </div>
              </div>
              {addProviderButton}
            </div>
            <SearchInput
              value={providerSearch}
              disabled={providers.length === 0}
              placeholder={frontendMessage("settings.provider.searchPlaceholder")}
              onChange={setProviderSearch}
            />
          </>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {providerRows}
      </ScrollArea>
    </div>
  );
}
