import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { SettingsConfigCommands } from "../SettingsContracts";
import { cn } from "../../../lib/util";
import { FluidHoverHighlight, motionTimings, useFluidHover, useMotionLevel } from "../../../shared/motion";
import { AppIcon, IconButton, ScrollArea, Tooltip } from "../../../shared/ui";
import { inferModelProviderEndpointIcon, ProviderMark } from "../../chat/ModelProviderIcon";
import { EmptyList, ProviderStatusIcon, SearchInput } from "../../chat/ModelConfigPrimitives";
import { providerEnabled, providerIdLabel, sortProviderRows } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";

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
}): JSX.Element {
  const [providerSearch, setProviderSearch] = useState("");
  const { reduceMotion, disableMotion } = useMotionLevel();
  const animateSelection = !reduceMotion && !disableMotion;
  const providerListRef = useRef<HTMLDivElement>(null);
  const providerHover = useFluidHover(providerListRef, {
    axis: "y",
    gapClick: false,
    isItemDisabled: (element) => element.hasAttribute("disabled"),
  });
  const providerQuery = providerSearch.trim().toLowerCase();
  const providerResults = sortProviderRows(providers).filter(({ provider }) => {
    if (!providerQuery) return true;
    return [providerIdLabel(provider), provider.Id, provider.BaseUrl, provider.ApiVersion].some((value) =>
      String(value ?? "")
        .toLowerCase()
        .includes(providerQuery),
    );
  });
  const selectedProviderIndex = providerResults.findIndex(({ provider }) => provider.Id === selectedProviderId);

  const providerRows =
    providers.length > 0 ? (
      <div className="p-2">
        <div ref={providerListRef} className="relative flex flex-col gap-1.5" {...providerHover.handlers}>
          <FluidHoverHighlight
            hover={providerHover}
            hidden={disableMotion || providerHover.activeIndex === selectedProviderIndex}
            className="rounded-md"
          />
          {providerResults.map(({ provider }, index) => {
            const active = provider.Id === selectedProviderId;
            const catalog = provider.Id ? catalogs[provider.Id] : undefined;
            const error = provider.Id ? errors[provider.Id] : undefined;
            const loading = provider.Id ? loadingProviderIds[provider.Id] : false;
            const enabled = providerEnabled(provider);
            const modelCount = catalog?.models.length ?? 0;
            const statusText = loading
              ? frontendMessage("settings.modelManagement.fetching")
              : error
                ? frontendMessage("settings.modelManagement.fetchFailed", { error: error.message })
                : catalog
                  ? frontendMessage("settings.provider.modelsCount", { count: modelCount })
                  : null;
            return (
              <div
                ref={providerHover.getItemRef(index)}
                key={provider.Id}
                className={cn(
                  "relative z-10 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-2 py-1.5 transition-colors",
                  active
                    ? "text-ink-900"
                    : cn(
                        "text-ink-650 hover:text-ink-900",
                        disableMotion ? "hover:bg-surface-hover" : "hover:bg-transparent",
                      ),
                  !enabled && "opacity-50",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId={animateSelection ? "settings-provider-selection" : undefined}
                    className="absolute inset-0 rounded-md bg-surface-hover"
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
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center overflow-hidden rounded-md border border-line-subtle bg-surface-subtle",
                      active && "border-ink-300 bg-surface-panel",
                    )}
                  >
                    <ProviderMark
                      icon={provider.Icon || inferModelProviderEndpointIcon(provider.Id)}
                      label={provider.Id}
                      size={14}
                    />
                  </span>
                  <span className="min-w-0 self-center">
                    <span
                      className={cn("block truncate text-[12.5px] font-medium", active && "font-semibold")}
                      title={providerIdLabel(provider)}
                    >
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
                <Tooltip
                  content={frontendMessage(enabled ? "settings.provider.statusReady" : "settings.provider.disabled")}
                  side="top"
                >
                  <span
                    className={cn(
                      "relative z-[1] h-1.5 w-1.5 shrink-0 cursor-help rounded-full transition-colors",
                      enabled ? "bg-moss-500" : "bg-ink-350 opacity-40",
                    )}
                    aria-label={frontendMessage(enabled ? "settings.provider.statusOn" : "settings.provider.statusOff")}
                  />
                </Tooltip>
              </div>
            );
          })}
          {providerResults.length === 0 ? <EmptyList text={frontendMessage("settings.provider.searchEmpty")} /> : null}
        </div>
      </div>
    ) : (
      <div className="p-2 pt-4">
        <EmptyList text={frontendMessage("settings.provider.addDescription")} />
      </div>
    );
  const addProviderButton = (
    <IconButton
      label={frontendMessage("settings.provider.add")}
      tooltip={frontendMessage("settings.provider.add")}
      tone="muted"
      disabled={disabled}
      onClick={onRequestAdd}
    >
      <AppIcon icon="plus" size={16} aria-hidden="true" />
    </IconButton>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {compact ? (
        <div
          className="flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-2 border-b border-line-subtle px-3"
          data-provider-list-toolbar="compact"
          data-window-drag-region
        >
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
          <div className="flex h-[var(--senera-top-chrome-height)] shrink-0 items-center px-3" data-window-drag-region>
            <div className="min-w-0 flex-1 truncate pl-1 text-[13px] font-semibold text-content-primary">
              {frontendMessage("settings.model.serviceTitle")}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle/50 px-3 pb-2 pt-1.5">
            <SearchInput
              value={providerSearch}
              disabled={providers.length === 0}
              placeholder={frontendMessage("settings.provider.searchPlaceholder")}
              className="flex-1"
              onChange={setProviderSearch}
            />
            {addProviderButton}
          </div>
        </>
      )}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {providerRows}
      </ScrollArea>
    </div>
  );
}
