import {
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
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
import {
  inferModelProviderIcon,
  ModelProviderIcon,
} from "../../chat/ModelProviderIcon";
import {
  EmptyList,
  ProviderStatusIcon,
  SearchInput,
} from "../../chat/ModelConfigPrimitives";
import {
  formatShortTime,
  providerEnabled,
  providerIdLabel,
  sortProviderRows,
} from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import { isProtectedProvider } from "./ProviderConnectionIdentity";

export function ProviderConnectionList({
  providers,
  catalogs,
  errors,
  loadingProviderIds,
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
    return [
      providerIdLabel(provider),
      provider.Id,
      provider.BaseUrl,
      provider.ApiVersion,
    ].some((value) => String(value ?? "").toLowerCase().includes(providerQuery));
  });
  const providerRows = providers.length > 0 ? (
    <div className="space-y-1.5 p-2">
      {providerResults.map(({ provider }) => {
        const active = provider.Id === selectedProviderId;
        const catalog = provider.Id ? catalogs[provider.Id] : undefined;
        const error = provider.Id ? errors[provider.Id] : undefined;
        const loading = provider.Id ? loadingProviderIds[provider.Id] : false;
        const enabled = providerEnabled(provider);
        const modelCount = catalog?.models.length ?? 0;
        const protectedProvider = isProtectedProvider(provider.Id);
        return (
          <div
            key={provider.Id}
            className={cn(
              "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg border px-2 py-2 transition",
              active
                ? "border-ink-200 bg-paper-50 text-ink-900 shadow-panel"
                : "border-transparent text-ink-650 hover:border-ink-200/70 hover:bg-paper-50/80",
              !enabled && "opacity-65",
            )}
          >
            <button
              type="button"
              disabled={disabled}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-left disabled:pointer-events-none disabled:opacity-60"
              aria-label={`${providerIdLabel(provider)}，${modelCount} 个模型，${enabled ? "已启用" : "已停用"}${active ? "，当前已选择" : ""}`}
              aria-pressed={active}
              onClick={() => onSelect(provider)}
            >
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full border border-ink-200 bg-paper-100">
                <ModelProviderIcon icon={provider.Icon || inferModelProviderIcon(provider.Id)} size={20} />
              </span>
              <span className="min-w-0 self-center">
                <span className="block truncate text-[13px] font-semibold" title={providerIdLabel(provider)}>
                  {providerIdLabel(provider)}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-450">
                  <ProviderStatusIcon loading={loading} catalog={catalog} error={error} />
                  <span className="truncate">
                    {catalog ? `${modelCount} 个模型 · ${formatShortTime(catalog.fetchedAt)}` : provider.Id || "未设置 ID"}
                  </span>
                </span>
              </span>
              <span className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                enabled
                  ? "border-lime-200 bg-lime-50 text-lime-700"
                  : "border-ink-200 bg-ink-900/[0.035] text-ink-450",
              )}>
                {enabled ? "ON" : "OFF"}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  className="grid h-8 w-8 place-items-center rounded-md text-ink-400 transition hover:bg-ink-900/[0.045] hover:text-ink-800 disabled:pointer-events-none disabled:opacity-45"
                  aria-label="供应商操作"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 bg-paper-50">
                <DropdownMenuItem
                  disabled={protectedProvider}
                  onSelect={() => onRename(provider)}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  disabled={protectedProvider}
                  onSelect={() => onDelete(provider)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      {providerResults.length === 0 ? (
        <EmptyList text="没有匹配的供应商" />
      ) : null}
    </div>
  ) : (
    <EmptyList text="添加供应商后填写连接信息" />
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-ink-200/70 bg-paper-50 p-3">
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink-900">供应商</div>
            <div className="mt-0.5 truncate text-[11px] text-ink-500">
              {providerQuery ? `${providerResults.length} / ${providers.length} 个端点` : `${providers.length} 个端点`}
            </div>
          </div>
        </div>
        <SearchInput
          value={providerSearch}
          disabled={providers.length === 0}
          onChange={setProviderSearch}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {providerRows}
      </ScrollArea>
      <div className="shrink-0 border-t border-ink-200/70 bg-paper-50 p-2">
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] font-medium text-ink-600 transition hover:border-terra-300 hover:bg-terra-50 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-50"
          onClick={onRequestAdd}
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </button>
      </div>
    </div>
  );
}
