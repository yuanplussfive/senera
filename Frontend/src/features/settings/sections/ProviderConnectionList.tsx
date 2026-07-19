import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { SettingsConfigCommands } from "../SettingsContracts";
import { cn } from "../../../lib/util";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ScrollArea,
} from "../../../shared/ui";
import { inferModelProviderIcon, ModelProviderIcon } from "../../chat/ModelProviderIcon";
import { EmptyList, ProviderStatusIcon, SearchInput } from "../../chat/ModelConfigPrimitives";
import { formatShortTime, providerEnabled, providerIdLabel, sortProviderRows } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import { isProtectedProvider } from "./ProviderConnectionIdentity";

export function ProviderConnectionList({
  providers,
  catalogs,
  errors,
  loadingProviderIds,
  operations,
  selectedProviderId,
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
  operations: SettingsConfigCommands["providerEndpointOperations"];
  selectedProviderId: string | null;
  disabled: boolean;
  onRequestAdd: () => void;
  onSelect: (provider: ProviderEndpointDraft) => void;
  onRename: (provider: ProviderEndpointDraft) => void;
  onDelete: (provider: ProviderEndpointDraft) => void;
}): JSX.Element {
  const [providerSearch, setProviderSearch] = useState("");
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
          const operation = provider.Id ? operations[provider.Id] : undefined;
          const operationPending = operation?.status === "pending";
          const operationError =
            operation?.status === "error" ? { providerId: provider.Id, message: operation.message ?? "" } : undefined;
          const enabled = providerEnabled(provider);
          const modelCount = catalog?.models.length ?? 0;
          const protectedProvider = isProtectedProvider(provider.Id);
          const statusText = loading
            ? frontendMessage("settings.modelManagement.fetching")
            : operationPending
              ? frontendMessage("settings.provider.savingConnection")
              : operationError
                ? frontendMessage("settings.provider.lastSaveFailed")
                : catalog
                  ? frontendMessage("settings.provider.catalogSummary", {
                      models: frontendMessage("settings.provider.modelsCount", { count: modelCount }),
                      time: formatShortTime(catalog.fetchedAt),
                    })
                  : null;
          return (
            <div
              key={provider.Id}
              className={cn(
                "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-2 py-2 transition-colors",
                active ? "bg-ink-900/[0.055] text-ink-900" : "text-ink-650 hover:bg-ink-900/[0.03] hover:text-ink-900",
                !enabled && "opacity-65",
              )}
            >
              <button
                type="button"
                disabled={disabled}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-left disabled:pointer-events-none disabled:opacity-60"
                aria-label={frontendMessage("settings.provider.rowAria", {
                  provider: providerIdLabel(provider),
                  models: frontendMessage("settings.provider.modelsCount", { count: modelCount }),
                  state: frontendMessage(enabled ? "settings.provider.enabled" : "settings.provider.disabled"),
                  selected: active ? frontendMessage("settings.provider.selectedSuffix") : "",
                })}
                aria-pressed={active}
                onClick={() => onSelect(provider)}
              >
                <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-md border border-ink-200/80 bg-paper-50">
                  <ModelProviderIcon icon={provider.Icon || inferModelProviderIcon(provider.Id)} size={20} />
                </span>
                <span className="min-w-0 self-center">
                  <span className="block truncate text-[13px] font-semibold" title={providerIdLabel(provider)}>
                    {providerIdLabel(provider)}
                  </span>
                  {statusText ? (
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-450">
                      <ProviderStatusIcon
                        loading={loading || operationPending}
                        catalog={catalog}
                        error={error || operationError}
                      />
                      <span className="truncate">{statusText}</span>
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full transition-colors duration-150",
                    enabled ? "bg-accent-solid" : "bg-ink-300",
                  )}
                />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    className="grid h-8 w-8 place-items-center rounded-md text-ink-400 transition hover:bg-ink-900/[0.045] hover:text-ink-800 disabled:pointer-events-none disabled:opacity-45"
                    aria-label={frontendMessage("settings.provider.operations")}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 bg-paper-50">
                  <DropdownMenuItem
                    icon={<Pencil className="h-3.5 w-3.5" />}
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

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <ScrollArea className="h-full min-h-0" viewportClassName="h-full">
        <div className="border-b border-ink-200/70 bg-paper-50 p-3">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-ink-900">
                {frontendMessage("settings.model.serviceTitle")}
              </div>

            </div>
            <button
              type="button"
              disabled={disabled}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-50"
              onClick={onRequestAdd}
              aria-label={frontendMessage("settings.provider.add")}
              title={frontendMessage("settings.provider.add")}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <SearchInput value={providerSearch} disabled={providers.length === 0} onChange={setProviderSearch} />
        </div>
        {providerRows}
      </ScrollArea>
    </div>
  );
}
