import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useMemo, useRef, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, Settings2, Star, Tags, Trash2 } from "lucide-react";
import type { ProviderModelsFailedData, ProviderModelsSnapshotData } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { ScrollArea, Switch, Tooltip } from "../../shared/ui";
import { inferModelProviderIcon, ModelProviderIcon } from "./ModelProviderIcon";
import { defaultModelCapabilities, modelConfigId, providerEnabled, readModelCapabilities } from "./modelConfigData";
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
const modelActionClassName =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium text-ink-650 transition hover:bg-ink-900/[0.05] hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-50";
const modelRemoveActionClassName =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium text-brick-700 transition hover:bg-brick-50 disabled:pointer-events-none disabled:opacity-50";

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
  compactHeader = false,
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
  compactHeader?: boolean;
  onConfigureModel: (model: ProviderModelInfo) => void;
  onSetDefaultModel?: (model: ModelProviderDraft) => void;
  onRemoveModel?: (model: ModelProviderDraft) => void;
  onAddModel?: (model: ProviderModelInfo) => void;
}): JSX.Element {
  const embedded = layoutMode === "embedded";
  const [compactSearchOpen, setCompactSearchOpen] = useState(false);
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
        groupedCards={compactHeader}
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
    <div className={cn("flex min-h-0 flex-col", embedded ? "overflow-visible" : "h-full overflow-hidden")}>
      {compactHeader ? (
        <div className="border-b border-ink-200/70 bg-paper-50 px-3 py-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[13.5px] font-semibold text-ink-900">{frontendMessage("config.model.title")}</span>
              <span className="tabular-nums text-[11px] text-ink-450">{rows.length}</span>
              <Tooltip content={frontendMessage("config.model.searchPlaceholder")} side="top">
                <button
                  type="button"
                  disabled={disabled || !selectedProvider}
                  className="grid h-8 w-8 place-items-center rounded-md text-ink-450 transition hover:bg-ink-900/[0.05] hover:text-ink-800 disabled:pointer-events-none disabled:opacity-45"
                  onClick={() => setCompactSearchOpen((current) => !current)}
                  aria-label={frontendMessage("config.model.searchPlaceholder")}
                  aria-pressed={compactSearchOpen}
                >
                  <Search className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
            <div className="flex items-center gap-1.5">
              {showFetchAction ? (
                <button
                  type="button"
                  disabled={disabled || loading || !enabled || !selectedProvider?.Id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[11.5px] font-medium text-ink-650 transition hover:border-accent-border-strong hover:bg-accent-surface-hover hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-45"
                  onClick={() => onFetch(true)}
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {frontendMessage("config.model.fetchList")}
                </button>
              ) : null}
              {onAddManualModel ? (
                <Tooltip content={frontendMessage("config.model.customModel")} side="top">
                  <button
                    type="button"
                    disabled={disabled || !selectedProvider}
                    className={iconButtonClassName}
                    onClick={onAddManualModel}
                    aria-label={frontendMessage("config.model.addCustomModel")}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          </div>
          {compactSearchOpen ? (
            <div className="mt-2.5">
              <SearchInput value={search} disabled={disabled || !selectedProvider} onChange={onSearch} />
            </div>
          ) : null}
        </div>
      ) : (
        <ListHeader
          title={frontendMessage("config.model.title")}
          subtitle={modelListSubtitle(selectedProvider, catalog, rows.length)}
          action={
            <div className="flex items-center gap-1.5">
              <Tooltip content={frontendMessage("config.model.modelGroups")} side="top">
                <button
                  type="button"
                  disabled={disabled}
                  className={iconButtonClassName}
                  onClick={onOpenModelGroups}
                  aria-label={frontendMessage("config.model.modelGroups")}
                >
                  <Tags className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <span className="inline-flex items-center gap-2 text-[11px] text-ink-600">
                <span>{frontendMessage("config.model.configuredOnly")}</span>
                <Switch
                  checked={configuredOnly}
                  disabled={disabled || !selectedProvider}
                  ariaLabel={frontendMessage("config.model.configuredOnly")}
                  className="h-8 w-10 justify-center"
                  onCheckedChange={onConfiguredOnlyChange}
                />
              </span>
              {onAddManualModel ? (
                <Tooltip content={frontendMessage("config.model.manualAdd")} side="top">
                  <button
                    type="button"
                    disabled={disabled || !selectedProvider}
                    className={iconButtonClassName}
                    onClick={onAddManualModel}
                    aria-label={frontendMessage("config.model.manualAdd")}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              ) : null}
              {showFetchAction ? (
                <Tooltip content={frontendMessage("config.model.fetchList")} side="top">
                  <button
                    type="button"
                    disabled={disabled || loading || !enabled || !selectedProvider?.Id}
                    className={iconButtonClassName}
                    onClick={() => onFetch(true)}
                    aria-label={frontendMessage("config.model.fetchList")}
                  >
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </button>
                </Tooltip>
              ) : null}
            </div>
          }
        />
      )}
      {compactHeader ? null : (
        <div className="grid gap-2 border-b border-ink-200/70 bg-paper-50/75 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <SearchInput value={search} disabled={disabled || !selectedProvider} onChange={onSearch} />
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            <ProviderCatalogStatus catalog={catalog} error={error} loading={loading} disabled={!enabled} />
          </div>
        </div>
      )}
      {compactHeader ? null : <ModelGroupSummary groups={groups} total={rows.length} onSelectGroup={scrollToGroup} />}
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
  groupedCards,
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
  groupedCards: boolean;
  onGroupRef: (groupId: string, element: HTMLElement | null) => void;
}): JSX.Element {
  const selectedProviderId = selectedProvider?.Id ?? "";
  const configuredByModel = useMemo(
    () =>
      new Map(models.filter((model) => model.ProviderId === selectedProviderId).map((model) => [model.Model, model])),
    [models, selectedProviderId],
  );

  if (!selectedProvider) {
    return <EmptyList text={frontendMessage("config.model.addProviderFirst")} />;
  }
  if (!enabled) {
    return <EmptyList text={frontendMessage("config.model.providerDisabled")} />;
  }
  if (!catalog && rows.length === 0) {
    return <EmptyList text={frontendMessage("config.model.fetchHint")} />;
  }
  if (rows.length === 0) {
    return <EmptyList text={frontendMessage("config.model.noMatches")} />;
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.id} className={cn("border-b border-ink-200/70 last:border-b-0")}>
          <div
            ref={(element) => onGroupRef(group.id, element)}
            className={cn(
              "flex scroll-mt-0 items-center justify-between border-b border-ink-200/70 bg-paper-100 px-3",
              groupedCards ? "h-9" : "sticky top-0 z-[1] h-8",
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <ModelProviderIcon icon={group.icon} size={14} className="rounded" />
              <span className="truncate text-[11.5px] font-semibold text-ink-700">{group.label}</span>
            </span>
            <span className="tabular-nums text-[10.5px] text-ink-400">{group.rows.length}</span>
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
      <ModelProviderIcon icon={configured?.Icon ?? inferModelProviderIcon(model.id)} size={22} className="rounded" />
      <span className="min-w-0">
        <span className="block truncate font-mono text-[12px] text-ink-850" title={model.id}>
          {model.id}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[10.5px] text-ink-400">
            {model.ownedBy || frontendMessage("config.model.providerModel")}
          </span>
          <CapabilityIconStrip capabilities={capabilities} />
        </span>
      </span>
      <span className="flex flex-wrap items-center justify-end gap-1.5">
        <ConfiguredModelBadge isDefault={isDefault} configured={Boolean(configured)} />
        {pending ? (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-ink-600">
            <Loader2 className="h-3 w-3 animate-spin text-accent-content" />{" "}
            {frontendMessage("settings.modelManagement.adding")}
          </span>
        ) : configured && (onSetDefaultModel || onRemoveModel) ? (
          <>
            <button
              type="button"
              disabled={disabled || !providerId}
              className={modelActionClassName}
              onClick={() => onConfigureModel(model)}
            >
              <Settings2 className="h-3 w-3" />
              {frontendMessage("chat.model.configure")}
            </button>
            {!isDefault && onSetDefaultModel ? (
              <button
                type="button"
                disabled={disabled || !providerId}
                className={modelActionClassName}
                onClick={() => onSetDefaultModel(configured)}
              >
                <Star className="h-3 w-3" />
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
                <Trash2 className="h-3 w-3" />
                {frontendMessage("chat.model.remove")}
              </button>
            ) : null}
          </>
        ) : configured || !onAddModel ? (
          <button
            type="button"
            disabled={disabled || !providerId}
            className={iconButtonClassName}
            title={frontendMessage("chat.model.configure")}
            aria-label={frontendMessage("chat.model.configure")}
            onClick={() => onConfigureModel(model)}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled || !providerId}
            className={iconButtonClassName}
            title={frontendMessage("config.model.addModel")}
            aria-label={frontendMessage("config.model.addModel")}
            onClick={() => onAddModel(model)}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
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
      <span className="text-[10.5px] font-medium text-accent-content">{frontendMessage("config.model.default")}</span>
    );
  }
  if (configured) {
    // TODO: this is a configured-state badge, not model enablement. Persisted
    // model Enabled plus runtime filtering require a backend contract first.
    return <span className="text-[10.5px] text-ink-500">{frontendMessage("settings.modelManagement.added")}</span>;
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
      <div className="flex min-w-0 flex-wrap gap-1">
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 border-b border-accent-border px-1.5 text-[11px] text-ink-750 transition-colors duration-150 hover:text-accent-content-hover"
          onClick={() => onSelectGroup(null)}
          title={frontendMessage("config.model.allModelsTitle", { count: total })}
        >
          <Tags className="h-3.5 w-3.5" />
          <span className="font-medium">{frontendMessage("config.model.allModels")}</span>
          <span className="tabular-nums text-[10px] text-ink-400">{total}</span>
        </button>
        {groups.map((group) => (
          <button
            type="button"
            key={group.id}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 border-b border-transparent px-1.5 text-[11px] text-ink-650 transition-colors duration-150 hover:border-ink-350 hover:text-ink-850"
            title={`${group.label}: ${group.rows.length}`}
            onClick={() => onSelectGroup(group.id)}
          >
            <ModelProviderIcon icon={group.icon} size={14} className="rounded" />
            <span className="max-w-24 truncate font-medium">{group.label}</span>
            <span className="tabular-nums text-[10px] text-ink-400">{group.rows.length}</span>
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
    return frontendMessage("config.model.selectProviderHint");
  }
  if (!providerEnabled(selectedProvider)) {
    return frontendMessage("config.model.providerDisabled");
  }
  if (!catalog) {
    return visibleRows > 0
      ? frontendMessage("config.model.configuredCount", { count: visibleRows })
      : frontendMessage("config.model.fetchToShow");
  }
  return visibleRows === catalog.models.length
    ? frontendMessage("config.model.count", { count: catalog.models.length })
    : frontendMessage("config.model.filteredCount", { visible: visibleRows, total: catalog.models.length });
}
