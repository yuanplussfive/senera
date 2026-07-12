import { useState } from "react";
import { BrainCircuit, Eye, EyeOff, KeyRound, Loader2, Plus, RefreshCw, Server, Settings2, Trash2 } from "lucide-react";
import type { ProviderModelsFailedData, ProviderModelsSnapshotData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Button, ScrollArea, Tooltip } from "../../shared/ui";
import { inferModelProviderIcon, ModelProviderIcon, ModelProviderIconNames } from "./ModelProviderIcon";
import { formatShortTime, nextHeaderKey, providerEnabled, providerIdLabel, sortProviderRows } from "./modelConfigData";
import type { ProviderEndpointDraft } from "./modelConfigTypes";
import {
  DetailTitle,
  EmptyDetail,
  EmptyList,
  IconAction,
  ListHeader,
  MenuRow,
  MenuSelect,
  ProviderCatalogStatus,
  ProviderStatusIcon,
  SettingRow,
  SettingsTable,
  TextRow,
  ToggleRow,
  iconButtonClassName,
  inputClassName,
} from "./ModelConfigPrimitives";

export function ProviderList({
  providers,
  catalogs,
  errors,
  loadingProviderIds,
  selectedIndex,
  disabled,
  onAdd,
  onSelect,
  onRemove,
  onOpenSettings,
}: {
  providers: ProviderEndpointDraft[];
  catalogs: Record<string, ProviderModelsSnapshotData>;
  errors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  loadingProviderIds: Record<string, boolean>;
  selectedIndex: number;
  disabled: boolean;
  onAdd: () => void;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onOpenSettings: () => void;
}): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ListHeader
        title={frontendMessage("config.provider.title")}
        subtitle={frontendMessage("config.provider.endpointCount", { count: providers.length })}
        action={
          <div className="flex items-center gap-1.5">
            <Tooltip content={frontendMessage("config.provider.settings")} side="top">
              <button
                type="button"
                disabled={disabled || providers.length === 0}
                className={iconButtonClassName}
                onClick={onOpenSettings}
                aria-label={frontendMessage("config.provider.settings")}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={frontendMessage("config.provider.delete")} side="top">
              <button
                type="button"
                disabled={disabled || providers.length === 0}
                className={cn(iconButtonClassName, "hover:border-brick-200 hover:bg-brick-50 hover:text-brick-600")}
                onClick={() => onRemove(selectedIndex)}
                aria-label={frontendMessage("config.provider.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={frontendMessage("config.provider.add")} side="top">
              <button
                type="button"
                disabled={disabled}
                className={iconButtonClassName}
                onClick={onAdd}
                aria-label={frontendMessage("config.provider.add")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        }
      />
      <ScrollArea className="min-h-0 flex-1 overflow-hidden" viewportClassName="h-full">
        {providers.length > 0 ? (
          <div className="space-y-1.5 p-2">
            {sortProviderRows(providers).map(({ provider, index }) => {
              const active = index === selectedIndex;
              const catalog = provider.Id ? catalogs[provider.Id] : undefined;
              const error = provider.Id ? errors[provider.Id] : undefined;
              const loading = provider.Id ? loadingProviderIds[provider.Id] : false;
              const enabled = providerEnabled(provider);
              const providerId = providerIdLabel(provider);
              return (
                <button
                  key={`${index}:${provider.Id}`}
                  type="button"
                  className={cn(
                    "grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left transition",
                    "[content-visibility:auto] [contain-intrinsic-size:52px]",
                    active
                      ? "border-ink-200 bg-paper-50 text-ink-900 shadow-panel"
                      : "border-transparent text-ink-650 hover:border-ink-200/70 hover:bg-paper-50/80",
                    !enabled && "opacity-60",
                  )}
                  onClick={() => onSelect(index)}
                >
                  <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full border border-ink-200 bg-paper-100">
                    <ModelProviderIcon icon={provider.Icon || inferModelProviderIcon(provider.Id)} size={20} />
                  </span>
                  <span className="min-w-0 self-center">
                    <span className="block truncate text-[13px] font-semibold" title={providerId}>
                      {providerId}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-450">
                      <ProviderStatusIcon loading={loading} catalog={catalog} error={error} />
                      <span className="truncate">
                        {catalog
                          ? frontendMessage("config.provider.catalogSummary", {
                              count: catalog.models.length,
                              time: formatShortTime(catalog.fetchedAt),
                            })
                          : provider.Id || frontendMessage("config.provider.idUnset")}
                      </span>
                    </span>
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      enabled
                        ? "border-lime-200 bg-lime-50 text-lime-700"
                        : "border-ink-200 bg-ink-900/[0.035] text-ink-450",
                    )}
                  >
                    {enabled ? "ON" : "OFF"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyList text={frontendMessage("config.provider.emptyList")} />
        )}
      </ScrollArea>
    </div>
  );
}

export function ProviderEditor({
  provider,
  providerIndex,
  catalog,
  error,
  loading,
  disabled,
  onChange,
  onRemove,
  onFetch,
}: {
  provider: ProviderEndpointDraft | null;
  providerIndex: number;
  catalog?: ProviderModelsSnapshotData;
  error?: ProviderModelsFailedData & { updatedAt: string };
  loading: boolean;
  disabled: boolean;
  onChange: (index: number, patch: Partial<ProviderEndpointDraft>) => void;
  onRemove: (index: number) => void;
  onFetch: (force?: boolean) => void;
}): JSX.Element {
  const [showKey, setShowKey] = useState(false);
  const iconOptions = ModelProviderIconNames.map((icon) => ({ value: icon, label: icon }));

  if (!provider) {
    return (
      <EmptyDetail
        icon={<Server className="h-5 w-5" />}
        title={frontendMessage("config.provider.select")}
        text={frontendMessage("config.provider.emptyDetail")}
      />
    );
  }

  const enabled = providerEnabled(provider);
  const providerId = providerIdLabel(provider);

  return (
    <ScrollArea className="h-full min-h-0" viewportClassName="h-full">
      <div className="mx-auto min-h-full w-full max-w-[820px] px-4 py-5">
        <DetailTitle
          icon={<ModelProviderIcon icon={provider.Icon || inferModelProviderIcon(provider.Id)} size={22} />}
          title={providerId}
          subtitle={frontendMessage(enabled ? "config.provider.enabled" : "config.provider.disabled")}
          actions={
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || loading || !enabled || !provider.Id}
                onClick={() => onFetch(true)}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {frontendMessage("config.provider.check")}
              </Button>
              <IconAction
                label={frontendMessage("config.provider.delete")}
                danger
                disabled={disabled}
                onClick={() => onRemove(providerIndex)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconAction>
            </>
          }
        />

        <SettingsTable>
          <ToggleRow
            label={frontendMessage("config.provider.enable")}
            enabled={enabled}
            disabled={disabled}
            onChange={(Enabled) => onChange(providerIndex, { Enabled })}
          />
          <TextRow
            icon={<Server className="h-3.5 w-3.5" />}
            label={frontendMessage("config.provider.name")}
            value={provider.Id}
            disabled={disabled}
            placeholder={frontendMessage("config.provider.namePlaceholder")}
            onChange={(Id) => onChange(providerIndex, { Id })}
          />
          <MenuRow icon={<BrainCircuit className="h-3.5 w-3.5" />} label={frontendMessage("config.provider.icon")}>
            <MenuSelect
              value={provider.Icon ?? ""}
              placeholder={frontendMessage("config.provider.selectIcon")}
              options={iconOptions}
              disabled={disabled}
              renderValue={(value) =>
                value ? (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ModelProviderIcon icon={value} size={18} />
                    <span className="truncate">{value}</span>
                  </span>
                ) : null
              }
              renderOption={(option) => (
                <span className="inline-flex min-w-0 items-center gap-2">
                  <ModelProviderIcon icon={option.value} size={16} />
                  <span className="truncate">{option.label}</span>
                </span>
              )}
              onChange={(Icon) => onChange(providerIndex, { Icon })}
            />
          </MenuRow>
          <TextRow
            icon={<Server className="h-3.5 w-3.5" />}
            label="Base URL"
            value={provider.BaseUrl ?? ""}
            disabled={disabled}
            placeholder="https://.../v1"
            onChange={(BaseUrl) => onChange(providerIndex, { BaseUrl })}
          />
          <TextRow
            icon={<KeyRound className="h-3.5 w-3.5" />}
            label="API Key"
            value={provider.ApiKey ?? ""}
            disabled={disabled}
            secret={!showKey}
            placeholder="sk-..."
            trailing={
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center border-l border-ink-200 text-ink-450 transition hover:text-ink-800"
                onClick={() => setShowKey((current) => !current)}
                aria-label={frontendMessage(showKey ? "config.provider.hideApiKey" : "config.provider.showApiKey")}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            }
            onChange={(ApiKey) => onChange(providerIndex, { ApiKey })}
          />
          <TextRow
            icon={<Settings2 className="h-3.5 w-3.5" />}
            label={frontendMessage("config.provider.apiVersion")}
            value={provider.ApiVersion ?? ""}
            disabled={disabled}
            placeholder={frontendMessage("config.provider.optionalPlaceholder")}
            onChange={(ApiVersion) => onChange(providerIndex, { ApiVersion })}
          />
          <HeadersRow
            headers={provider.Headers ?? {}}
            disabled={disabled}
            onChange={(Headers) => onChange(providerIndex, { Headers })}
          />
        </SettingsTable>

        <div className="mt-4">
          <ProviderCatalogStatus catalog={catalog} error={error} loading={loading} expanded disabled={!enabled} />
        </div>
      </div>
    </ScrollArea>
  );
}

function HeadersRow({
  headers,
  disabled,
  onChange,
}: {
  headers: Record<string, string>;
  disabled: boolean;
  onChange: (headers: Record<string, string>) => void;
}): JSX.Element {
  const entries = Object.entries(headers);
  return (
    <SettingRow icon={<Settings2 className="h-3.5 w-3.5" />} label={frontendMessage("config.provider.headers")}>
      <div className="grid gap-2">
        {entries.map(([key, value], index) => (
          <div key={`${key}:${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              value={key}
              placeholder="Header"
              disabled={disabled}
              className={inputClassName}
              onChange={(event) => {
                const next = [...entries];
                next[index] = [event.currentTarget.value, value];
                onChange(Object.fromEntries(next.filter(([entryKey]) => entryKey.trim())));
              }}
            />
            <input
              value={value}
              placeholder="Value"
              disabled={disabled}
              className={inputClassName}
              onChange={(event) => {
                const next = [...entries];
                next[index] = [key, event.currentTarget.value];
                onChange(Object.fromEntries(next));
              }}
            />
            <IconAction
              label={frontendMessage("config.provider.deleteHeader")}
              danger
              disabled={disabled}
              onClick={() => onChange(Object.fromEntries(entries.filter((_, entryIndex) => entryIndex !== index)))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconAction>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-terra-300 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-50"
          onClick={() => onChange({ ...headers, [nextHeaderKey(headers)]: "" })}
        >
          <Plus className="h-3.5 w-3.5" />
          {frontendMessage("config.provider.addHeader")}
        </button>
      </div>
    </SettingRow>
  );
}
