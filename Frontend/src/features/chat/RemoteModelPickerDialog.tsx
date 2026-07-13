import {
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  ScrollArea,
} from "../../shared/ui";
import { cn } from "../../lib/util";
import {
  inferModelProviderIcon,
  ModelProviderIcon,
} from "./ModelProviderIcon";
import {
  defaultModelCapabilities,
  filterRemoteModelPickerRows,
  groupProviderModelRows,
  readModelCapabilities,
  remoteModelCategories,
  type RemoteModelCategoryId,
} from "./modelConfigData";
import { CapabilityIconStrip } from "./ModelCapabilityControls";
import {
  EmptyList,
  ProviderCatalogStatus,
  SearchInput,
} from "./ModelConfigPrimitives";
import type {
  ModelGroupDraft,
  ModelProviderDraft,
  ProviderEndpointDraft,
  ProviderModelInfo,
} from "./modelConfigTypes";
import type {
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../api/eventTypes";

export function RemoteModelPickerDialog({
  catalog,
  configuredModels,
  defaultModelId,
  disabled,
  error,
  groups,
  loading,
  modelTemplate,
  open,
  provider,
  onConfigureModel,
  onOpenChange,
  onRefresh,
}: {
  catalog?: ProviderModelsSnapshotData;
  configuredModels: ModelProviderDraft[];
  defaultModelId: string;
  disabled: boolean;
  error?: ProviderModelsFailedData & { updatedAt?: string };
  groups: ModelGroupDraft[];
  loading: boolean;
  modelTemplate: Record<string, unknown>;
  open: boolean;
  provider: ProviderEndpointDraft | null;
  onConfigureModel: (model: ProviderModelInfo) => void;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}): JSX.Element {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<RemoteModelCategoryId>("all");
  const configuredByModel = useMemo(
    () => new Map(configuredModels.map((model) => [model.Model, model])),
    [configuredModels],
  );
  const visibleRows = useMemo(
    () => filterRemoteModelPickerRows({
      category,
      rows: catalog?.models ?? [],
      search,
    }),
    [catalog?.models, category, search],
  );
  const groupedRows = useMemo(() => groupProviderModelRows(visibleRows, groups), [groups, visibleRows]);
  const providerLabel = provider?.Id || "选择供应商";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="供应商模型"
        description={`${providerLabel} · 获取模型列表后手动添加，不会覆盖本地模型`}
        motionPreset="focus"
        className="h-[min(760px,calc(100dvh_-_32px))] w-[min(980px,calc(100vw_-_24px))] max-w-none rounded-xl bg-paper-50"
        bodyClassName="flex min-h-0 flex-col"
      >
        <div className="grid gap-2 border-b border-ink-200/70 bg-paper-50 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <SearchInput value={search} disabled={disabled || !catalog} onChange={setSearch} />
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <ProviderCatalogStatus catalog={catalog} error={error} loading={loading} disabled={!provider} />
            <button
              type="button"
              disabled={disabled || loading || !provider?.Id}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[11.5px] font-semibold text-ink-600 transition hover:border-terra-200 hover:bg-terra-50 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-45"
              onClick={onRefresh}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              刷新
            </button>
          </div>
        </div>

        <div className="border-b border-ink-200/70 bg-paper-100/60 px-4 py-2">
          <div className="flex min-w-0 gap-1 overflow-x-auto">
            {remoteModelCategories.map((item) => {
              const active = item.id === category;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={cn(
                    "h-7 shrink-0 rounded-md border px-2.5 text-[11.5px] font-medium transition",
                    active
                      ? "border-ink-800 bg-ink-900 text-paper-50"
                      : "border-ink-200 bg-paper-50 text-ink-550 hover:border-terra-200 hover:bg-terra-50 hover:text-terra-700",
                  )}
                  onClick={() => setCategory(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
          <RemoteModelPickerRows
            configuredByModel={configuredByModel}
            defaultModelId={defaultModelId}
            disabled={disabled}
            groups={groupedRows}
            loading={loading}
            modelTemplate={modelTemplate}
            provider={provider}
            totalRows={visibleRows.length}
            onConfigureModel={onConfigureModel}
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function RemoteModelPickerRows({
  configuredByModel,
  defaultModelId,
  disabled,
  groups,
  loading,
  modelTemplate,
  provider,
  totalRows,
  onConfigureModel,
}: {
  configuredByModel: Map<string, ModelProviderDraft>;
  defaultModelId: string;
  disabled: boolean;
  groups: ReturnType<typeof groupProviderModelRows>;
  loading: boolean;
  modelTemplate: Record<string, unknown>;
  provider: ProviderEndpointDraft | null;
  totalRows: number;
  onConfigureModel: (model: ProviderModelInfo) => void;
}): JSX.Element {
  if (!provider) {
    return <EmptyList text="先选择供应商" />;
  }
  if (loading && totalRows === 0) {
    return <EmptyList text="正在获取模型列表" />;
  }
  if (totalRows === 0) {
    return <EmptyList text="没有匹配的远程模型" />;
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.id} className="border-b border-ink-200/70 last:border-b-0">
          <div className="sticky top-0 z-[1] flex h-8 items-center justify-between border-b border-ink-200/70 bg-paper-100 px-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <ModelProviderIcon icon={group.icon} size={14} className="rounded" />
              <span className="truncate text-[11.5px] font-semibold text-ink-700">{group.label}</span>
            </span>
            <span className="rounded-full bg-ink-900/[0.055] px-2 py-0.5 text-[10.5px] text-ink-500">
              {group.rows.length}
            </span>
          </div>
          <div className="divide-y divide-ink-200/70">
            {group.rows.map((model) => (
              <RemoteModelPickerRow
                key={model.id}
                configured={configuredByModel.get(model.id)}
                defaultModelId={defaultModelId}
                disabled={disabled}
                model={model}
                modelTemplate={modelTemplate}
                onConfigureModel={onConfigureModel}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RemoteModelPickerRow({
  configured,
  defaultModelId,
  disabled,
  model,
  modelTemplate,
  onConfigureModel,
}: {
  configured?: ModelProviderDraft;
  defaultModelId: string;
  disabled: boolean;
  model: ProviderModelInfo;
  modelTemplate: Record<string, unknown>;
  onConfigureModel: (model: ProviderModelInfo) => void;
}): JSX.Element {
  const capabilities = configured
    ? readModelCapabilities(configured, modelTemplate)
    : defaultModelCapabilities(modelTemplate);
  const isDefault = configured?.Id === defaultModelId;

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition hover:bg-paper-100/80">
      <ModelProviderIcon icon={configured?.Icon ?? inferModelProviderIcon(model.id)} size={22} className="rounded" />
      <span className="min-w-0">
        <span className="block truncate font-mono text-[12px] text-ink-850" title={model.id}>
          {model.id}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[10.5px] text-ink-400">
            {model.ownedBy || "供应商模型"}
          </span>
          <CapabilityIconStrip capabilities={capabilities} />
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        {isDefault ? (
          <span className="rounded-full border border-terra-200 bg-terra-50 px-2 py-1 text-[10.5px] font-semibold text-terra-700">
            DEFAULT
          </span>
        ) : configured ? (
          <span className="rounded-full border border-lime-200 bg-lime-50 px-2 py-1 text-[10.5px] font-semibold text-lime-700">
            已添加
          </span>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[11.5px] font-semibold text-ink-600 transition hover:border-terra-200 hover:bg-terra-50 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-45"
          onClick={() => onConfigureModel(model)}
        >
          {configured ? <Settings2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {configured ? "配置" : "添加"}
        </button>
      </span>
    </div>
  );
}
