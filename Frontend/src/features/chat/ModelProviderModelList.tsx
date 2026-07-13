import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useMemo, useRef } from "react";
import {
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Tags,
} from "lucide-react";
import type {
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../api/eventTypes";
import { cn } from "../../lib/util";
import {
  ScrollArea,
  Tooltip,
} from "../../shared/ui";
import {
  inferModelProviderIcon,
  ModelProviderIcon,
} from "./ModelProviderIcon";
import {
  defaultModelCapabilities,
  modelConfigId,
  providerEnabled,
  readModelCapabilities,
} from "./modelConfigData";
import type {
  ModelConfigLayoutMode,
  ModelProviderDraft,
  ProviderEndpointDraft,
  ProviderModelGroup,
  ProviderModelInfo,
} from "./modelConfigTypes";
import { CapabilityIconStrip } from "./ModelCapabilityControls";
import {
  EmptyList,
  ListHeader,
  ProviderCatalogStatus,
  SearchInput,
  iconButtonClassName,
} from "./ModelConfigPrimitives";

const EMPTY_PENDING_MODEL_IDS: ReadonlySet<string> = new Set();
const modelActionClassName = "inline-flex h-7 items-center rounded-md border border-ink-200 bg-paper-50 px-2 text-[10.5px] font-medium text-ink-650 transition hover:border-terra-300 hover:bg-terra-50 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-50";
const modelRemoveActionClassName = "inline-flex h-7 items-center rounded-md border border-brick-200 bg-brick-50 px-2 text-[10.5px] font-medium text-brick-700 transition hover:border-brick-300 hover:bg-brick-100 disabled:pointer-events-none disabled:opacity-50";

export function ProviderModelList({
  selectedProvider,
  catalog,
  error,
  loading,
  enabled,
  rows,
  groups,
  models,
  modelTemplate,
  defaultModelId,
  pendingModelIds = EMPTY_PENDING_MODEL_IDS,
  search,
  configuredOnly,
  disabled,
  layoutMode = "panel",
  onSearch,
  onConfiguredOnlyChange,
  onOpenModelGroups,
  onFetch,
  onAddManualModel,
  showFetchAction = true,
  onConfigureModel,
  onSetDefaultModel,
  onRemoveModel,
  onAddModel,
}: {
  selectedProvider: ProviderEndpointDraft | null;
  catalog?: ProviderModelsSnapshotData;
  error?: ProviderModelsFailedData & { updatedAt: string };
  loading: boolean;
  enabled: boolean;
  rows: ProviderModelInfo[];
  groups: ProviderModelGroup[];
  models: ModelProviderDraft[];
  modelTemplate: Record<string, unknown>;
  defaultModelId: string;
  pendingModelIds?: ReadonlySet<string>;
  search: string;
  configuredOnly: boolean;
  disabled: boolean;
  layoutMode?: ModelConfigLayoutMode;
  onSearch: (value: string) => void;
  onConfiguredOnlyChange: (enabled: boolean) => void;
  onOpenModelGroups: () => void;
  onFetch: (force?: boolean) => void;
  onAddManualModel?: () => void;
  showFetchAction?: boolean;
  onConfigureModel: (model: ProviderModelInfo) => void;
  onSetDefaultModel?: (model: ModelProviderDraft) => void;
  onRemoveModel?: (model: ModelProviderDraft) => void;
  onAddModel?: (model: ProviderModelInfo) => void;
}): JSX.Element {
  const embedded = layoutMode === "embedded";
  const scrollTopRef = useRef<HTMLDivElement | null>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const scrollToGroup = (groupId: string | null): void => {
    const target = groupId === null ? scrollTopRef.current : groupRefs.current.get(groupId);
    target?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  };
  const modelRows = (
    <>
      <div ref={scrollTopRef} />
      <ProviderModelRows
        selectedProvider={selectedProvider}
        enabled={enabled}
        catalog={catalog}
        rows={rows}
        groups={groups}
        models={models}
        modelTemplate={modelTemplate}
        defaultModelId={defaultModelId}
        pendingModelIds={pendingModelIds}
        disabled={disabled}
        onConfigureModel={onConfigureModel}
        onSetDefaultModel={onSetDefaultModel}
        onRemoveModel={onRemoveModel}
        onAddModel={onAddModel}
        onGroupRef={(groupId, element) => {
          if (element) {
            groupRefs.current.set(groupId, element);
          } else {
            groupRefs.current.delete(groupId);
          }
        }}
      />
    </>
  );

  return (
    <div className={cn(
      "flex min-h-0 flex-col",
      embedded ? "overflow-visible" : "h-full overflow-hidden",
    )}>
      <ListHeader
        title={frontendMessage("runtime.migrated.features.chat.ModelProviderModelList.138.15")}
        subtitle={modelListSubtitle(selectedProvider, catalog, rows.length)}
        action={(
          <div className="flex items-center gap-1.5">
            <Tooltip content="模型分组" side="top">
              <button
                type="button"
                disabled={disabled}
                className={iconButtonClassName}
                onClick={onOpenModelGroups}
                aria-label="模型分组"
              >
                <Tags className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <button
              type="button"
              disabled={disabled || !selectedProvider}
              className={cn(
                "inline-flex h-8 items-center rounded-md border px-2.5 text-[11px] font-semibold transition",
                configuredOnly
                  ? "border-lime-200 bg-lime-50 text-lime-700"
                  : "border-ink-200 bg-paper-50 text-ink-500 hover:border-terra-200 hover:bg-terra-50 hover:text-terra-700",
                "disabled:pointer-events-none disabled:opacity-45",
              )}
              onClick={() => onConfiguredOnlyChange(!configuredOnly)}
              aria-pressed={configuredOnly}
            >
                {frontendMessage("runtime.migrated.features.chat.ModelProviderModelList.166.17")}</button>
            {onAddManualModel ? (
              <Tooltip content="手动添加模型" side="top">
                <button
                  type="button"
                  disabled={disabled || !selectedProvider}
                  className={iconButtonClassName}
                  onClick={onAddManualModel}
                  aria-label="手动添加模型"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            ) : null}
            {showFetchAction ? <Tooltip content="获取模型列表" side="top">
              <button
                type="button"
                disabled={disabled || loading || !enabled || !selectedProvider?.Id}
                className={iconButtonClassName}
                onClick={() => onFetch(true)}
                aria-label="获取模型列表"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </button>
            </Tooltip> : null}
          </div>
        )}
      />
      <div className="grid gap-2 border-b border-ink-200/70 bg-paper-50/75 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <SearchInput value={search} disabled={disabled || !selectedProvider} onChange={onSearch} />
        <ProviderCatalogStatus catalog={catalog} error={error} loading={loading} disabled={!enabled} />
      </div>
      <ModelGroupSummary
        groups={groups}
        total={rows.length}
        onSelectGroup={scrollToGroup}
      />
      {embedded ? (
        <div className="min-h-0">{modelRows}</div>
      ) : (
        <ScrollArea
          className="min-h-0 flex-1 overflow-hidden"
          viewportClassName="h-full pr-2 [scrollbar-gutter:stable]"
        >
          {modelRows}
        </ScrollArea>
      )}
    </div>
  );
}

function ProviderModelRows({
  selectedProvider,
  enabled,
  catalog,
  rows,
  groups,
  models,
  modelTemplate,
  defaultModelId,
  pendingModelIds,
  disabled,
  onConfigureModel,
  onSetDefaultModel,
  onRemoveModel,
  onAddModel,
  onGroupRef,
}: {
  selectedProvider: ProviderEndpointDraft | null;
  enabled: boolean;
  catalog?: ProviderModelsSnapshotData;
  rows: ProviderModelInfo[];
  groups: ProviderModelGroup[];
  models: ModelProviderDraft[];
  modelTemplate: Record<string, unknown>;
  defaultModelId: string;
  pendingModelIds: ReadonlySet<string>;
  disabled: boolean;
  onConfigureModel: (model: ProviderModelInfo) => void;
  onSetDefaultModel?: (model: ModelProviderDraft) => void;
  onRemoveModel?: (model: ModelProviderDraft) => void;
  onAddModel?: (model: ProviderModelInfo) => void;
  onGroupRef: (groupId: string, element: HTMLElement | null) => void;
}): JSX.Element {
  const selectedProviderId = selectedProvider?.Id ?? "";
  const configuredByModel = useMemo(
    () => new Map(
      models
        .filter((model) => model.ProviderId === selectedProviderId)
        .map((model) => [model.Model, model]),
    ),
    [models, selectedProviderId],
  );

  if (!selectedProvider) {
    return <EmptyList text="先添加供应商" />;
  }
  if (!enabled) {
    return <EmptyList text="当前供应商已关闭" />;
  }
  if (!catalog && rows.length === 0) {
    return <EmptyList text="点击获取模型列表读取 /models 列表" />;
  }
  if (rows.length === 0) {
    return <EmptyList text="没有匹配的模型" />;
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.id} className="border-b border-ink-200/70 last:border-b-0">
          <div
            ref={(element) => onGroupRef(group.id, element)}
            className="sticky top-0 z-[1] flex h-8 scroll-mt-0 items-center justify-between border-b border-ink-200/70 bg-paper-100 px-3"
          >
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
              <ProviderModelRow
                key={model.id}
                model={model}
                providerId={selectedProvider.Id}
                configured={configuredByModel.get(model.id)}
                defaultModelId={defaultModelId}
                pending={pendingModelIds.has(modelConfigId(selectedProviderId, model.id))}
                modelTemplate={modelTemplate}
                disabled={disabled}
                onConfigureModel={onConfigureModel}
                onSetDefaultModel={onSetDefaultModel}
                onRemoveModel={onRemoveModel}
                onAddModel={onAddModel}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProviderModelRow({
  model,
  providerId,
  configured,
  defaultModelId,
  pending,
  modelTemplate,
  disabled,
  onConfigureModel,
  onSetDefaultModel,
  onRemoveModel,
  onAddModel,
}: {
  model: ProviderModelInfo;
  providerId: string;
  configured?: ModelProviderDraft;
  defaultModelId: string;
  pending: boolean;
  modelTemplate: Record<string, unknown>;
  disabled: boolean;
  onConfigureModel: (model: ProviderModelInfo) => void;
  onSetDefaultModel?: (model: ModelProviderDraft) => void;
  onRemoveModel?: (model: ModelProviderDraft) => void;
  onAddModel?: (model: ProviderModelInfo) => void;
}): JSX.Element {
  const isDefault = configured?.Id === defaultModelId;
  const capabilities = configured
    ? readModelCapabilities(configured, modelTemplate)
    : defaultModelCapabilities(modelTemplate);

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition hover:bg-paper-100/80 [content-visibility:auto] [contain-intrinsic-size:52px]">
      <ModelProviderIcon
        icon={configured?.Icon ?? inferModelProviderIcon(model.id)}
        size={22}
        className="rounded"
      />
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
      <span className="flex flex-wrap items-center justify-end gap-1.5">
        <ConfiguredModelBadge isDefault={isDefault} configured={Boolean(configured)} />
        {pending ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10.5px] font-semibold text-sky-700">
            <Loader2 className="h-3 w-3 animate-spin" /> {frontendMessage("runtime.migrated.features.chat.ModelProviderModelList.356.58")}</span>
        ) : configured && (onSetDefaultModel || onRemoveModel) ? (
          <>
            <button
              type="button"
              disabled={disabled || !providerId}
              className={modelActionClassName}
              onClick={() => onConfigureModel(model)}
            >
              {frontendMessage("chat.model.configure")}
            </button>
            {!isDefault && onSetDefaultModel ? (
              <button
                type="button"
                disabled={disabled || !providerId}
                className={modelActionClassName}
                onClick={() => onSetDefaultModel(configured)}
              >
                {frontendMessage("chat.model.setDefault")}
              </button>
            ) : null}
            {onRemoveModel ? (
              <button
                type="button"
                disabled={disabled || !providerId}
                className={modelRemoveActionClassName}
                onClick={() => onRemoveModel(configured)}
              >
                {frontendMessage("chat.model.remove")}
              </button>
            ) : null}
          </>
        ) : configured || !onAddModel ? <button
          type="button"
          disabled={disabled || !providerId}
          className={iconButtonClassName}
          title={frontendMessage("runtime.migrated.features.chat.ModelProviderModelList.362.17")}
          aria-label="配置模型"
          onClick={() => onConfigureModel(model)}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button> : <button
          type="button"
          disabled={disabled || !providerId}
          className={iconButtonClassName}
          title={frontendMessage("runtime.migrated.features.chat.ModelProviderModelList.371.17")}
          aria-label="添加模型"
          onClick={() => onAddModel(model)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>}
      </span>
    </div>
  );
}

function ConfiguredModelBadge({
  isDefault,
  configured,
}: {
  isDefault: boolean;
  configured: boolean;
}): JSX.Element | null {
  if (isDefault) {
    return (
      <span className="rounded-full border border-terra-200 bg-terra-50 px-2 py-1 text-[10.5px] font-semibold text-terra-700">
        DEFAULT
      </span>
    );
  }
  if (configured) {
    // TODO: this is a configured-state badge, not model enablement. Persisted
    // model Enabled plus runtime filtering require a backend contract first.
    return (
      <span className="rounded-full border border-lime-200 bg-lime-50 px-2 py-1 text-[10.5px] font-semibold text-lime-700">
        {frontendMessage("runtime.migrated.features.chat.ModelProviderModelList.401.9")}</span>
    );
  }
  return null;
}

function ModelGroupSummary({
  groups,
  total,
  onSelectGroup,
}: {
  groups: ProviderModelGroup[];
  total: number;
  onSelectGroup: (groupId: string | null) => void;
}): JSX.Element | null {
  if (groups.length === 0) {
    return null;
  }
  return (
    <div className="border-b border-ink-200/70 bg-paper-50 px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap gap-1.5">
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-ink-300 bg-paper-100 px-2.5 text-[11px] text-ink-750 transition hover:border-terra-200 hover:bg-terra-50 hover:text-terra-700"
          onClick={() => onSelectGroup(null)}
          title={`所有模型: ${total}`}
        >
          <Tags className="h-3.5 w-3.5" />
          <span className="font-medium">{frontendMessage("runtime.migrated.features.chat.ModelProviderModelList.430.41")}</span>
          <span className="rounded-full bg-ink-900/[0.06] px-1.5 py-0.5 text-[10px] text-ink-500">
            {total}
          </span>
        </button>
        {groups.map((group) => (
          <button
            type="button"
            key={group.id}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-ink-200 bg-paper-100 px-2.5 text-[11px] text-ink-650 transition hover:border-terra-200 hover:bg-terra-50 hover:text-terra-700"
            title={`${group.label}: ${group.rows.length}`}
            onClick={() => onSelectGroup(group.id)}
          >
            <ModelProviderIcon icon={group.icon} size={14} className="rounded" />
            <span className="max-w-24 truncate font-medium">{group.label}</span>
            <span className="rounded-full bg-ink-900/[0.06] px-1.5 py-0.5 text-[10px] text-ink-500">
              {group.rows.length}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function modelListSubtitle(
  selectedProvider: ProviderEndpointDraft | null,
  catalog: ProviderModelsSnapshotData | undefined,
  visibleRows: number,
): string {
  if (!selectedProvider) {
    return "选择供应商后显示模型";
  }
  if (!providerEnabled(selectedProvider)) {
    return "当前供应商已关闭";
  }
  if (!catalog) {
    return visibleRows > 0 ? `${visibleRows} 个已配置模型` : "获取后显示可用模型";
  }
  return visibleRows === catalog.models.length
    ? `${catalog.models.length} 个模型`
    : `${visibleRows} / ${catalog.models.length} 个模型`;
}
