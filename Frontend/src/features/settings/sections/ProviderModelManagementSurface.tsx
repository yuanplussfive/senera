import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { ConfigFormFieldData } from "../../../api/eventTypes";
import type { ProviderModelConfigInput } from "../../../api/providerModelCommandTypes";
import type { ProviderModelUpsertInput } from "../../../app/providerModelMutations";
import { cn } from "../../../lib/util";
import { Button, Dialog, DialogContent, ScrollArea } from "../../../shared/ui";
import {
  createModelDraft,
  groupProviderModelRows,
  modelConfigId,
  readDraftOrEffectiveValue,
  readModelGroups,
  toProviderEndpointInput,
} from "../../chat/modelConfigData";
import { readProviderModelListState, type ReadProviderModelListStateInput } from "./modelServiceState";
import { ModelOptionsDialog } from "../../chat/ModelOptionsDialog";
import { ProviderModelList } from "../../chat/ModelProviderModelList";
import type { ModelProviderDraft, ProviderModelInfo } from "../../chat/modelConfigTypes";
import { SettingsWorkspaceState } from "../SettingsWorkspaceSurface";
import type { SettingsConfigCommands } from "../SettingsContracts";
import type { ModelServiceState } from "./modelServiceState";
import type { ConfigFormSectionData } from "../../../api/eventTypes";
import type { JsonConfigObject } from "../../../shared/config/JsonConfigForm";

export function ProviderModelManagementSurface({
  disabled,
  endpointOptions = [],
  modelField,
  onFetchProviderModels,
  onRequestRemoveModel,
  onSetDefaultModel,
  onUpsertProviderModel,
  operations,
  state,
  catalogs,
  errors,
  loadingProviderIds,
  draft,
  section,
  initialSelectedProviderId,
  initialManualAdd = false,
  showProviderList = true,
  showFetchAction = true,
  fetchEndpoint,
  openCatalogSignal = 0,
}: {
  disabled: boolean;
  endpointOptions?: Array<{ value: string; label: string }>;
  modelField?: ConfigFormFieldData;
  operations: SettingsConfigCommands["providerModelOperations"];
  onFetchProviderModels: SettingsConfigCommands["fetchProviderModels"];
  onRequestRemoveModel: (model: ModelProviderDraft) => void;
  onSetDefaultModel: (modelId: string) => void;
  onUpsertProviderModel: SettingsConfigCommands["upsertProviderModel"];
  state: ModelServiceState;
  catalogs: ReadProviderModelListStateInput["catalogs"];
  errors: ReadProviderModelListStateInput["errors"];
  loadingProviderIds: ReadProviderModelListStateInput["loadingIds"];
  draft: JsonConfigObject;
  section: ConfigFormSectionData;
  /**
   * Seeds the internal provider-picker strip's selection when this surface is opened
   * pre-scoped to a provider from the outer provider list. The strip remains
   * independently switchable when this surface is used standalone.
   */
  initialSelectedProviderId?: string;
  /** Opens the manual "add model by ID" sub-dialog immediately on mount. */
  initialManualAdd?: boolean;
  /** Hide the internal provider strip when embedded below the outer provider rail. */
  showProviderList?: boolean;
  /** Hide the model-list fetch action when the provider editor owns discovery. */
  showFetchAction?: boolean;
  /** Uses the visible provider draft for discovery before endpoint save. */
  fetchEndpoint?: Parameters<SettingsConfigCommands["fetchProviderModels"]>[2];
  /** Opens the catalog when the sibling provider editor triggers fetch. */
  openCatalogSignal?: number;
}): JSX.Element {
  const modelGroups = readModelGroups(readDraftOrEffectiveValue(draft, section, "ModelGroups"));
  const [selectedProviderId, setSelectedProviderId] = useState(initialSelectedProviderId ?? state.providers[0]?.Id ?? "");
  const [search, setSearch] = useState("");
  const [configuredOnly, setConfiguredOnly] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelProviderDraft | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
  const [manualOpen, setManualOpen] = useState(initialManualAdd);
  const [manualModelId, setManualModelId] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [groupUnsupportedDialogOpen, setGroupUnsupportedDialogOpen] = useState(false);
  const previousCatalogSignal = useRef(openCatalogSignal);
  const deferredSearch = useDeferredValue(search);
  const selectedProvider = state.providers.find((provider) => provider.Id === selectedProviderId) ?? state.providers[0] ?? null;

  useEffect(() => {
    if (!showProviderList && initialSelectedProviderId && initialSelectedProviderId !== selectedProviderId) {
      setSelectedProviderId(initialSelectedProviderId);
      return;
    }
    if (selectedProviderId && state.providers.some((provider) => provider.Id === selectedProviderId)) return;
    setSelectedProviderId(state.providers[0]?.Id ?? "");
  }, [initialSelectedProviderId, selectedProviderId, showProviderList, state.providers]);
  useEffect(() => {
    if (openCatalogSignal === previousCatalogSignal.current) return;
    previousCatalogSignal.current = openCatalogSignal;
    if (openCatalogSignal > 0) setCatalogOpen(true);
  }, [openCatalogSignal]);
  const selectedList = selectedProvider
    ? readProviderModelListState({
        catalogs,
        defaultModelId: state.defaultModel?.model.Id ?? "",
        errors,
        loadingIds: loadingProviderIds,
        modelGroups,
        models: state.models,
        provider: selectedProvider,
      })
    : null;
  const modelTemplate = useMemo(() => modelField?.defaultItem ?? {}, [modelField]);
  const endpointChoices = endpointOptions;
  const visibleRows = selectedProvider
    ? selectedList?.rows.filter((row) => {
        const query = deferredSearch.trim().toLowerCase();
        if (configuredOnly && !state.models.some((model) => model.ProviderId === selectedProvider.Id && model.Model === row.id)) return false;
        if (!query) return true;
        return row.id.toLowerCase().includes(query);
      }) ?? []
    : [];
  const visibleGroups = groupProviderModelRows(visibleRows, modelGroups);
  const catalogRows = selectedList?.catalog?.models ?? [];
  const catalogVisibleRows = catalogRows.filter((row) => {
    const query = catalogSearch.trim().toLowerCase();
    return !query || `${row.id} ${row.ownedBy ?? ""}`.toLowerCase().includes(query);
  });
  const catalogGroups = groupProviderModelRows(catalogVisibleRows, modelGroups);
  const pendingModelIds = useMemo(
    () => new Set(
      Object.entries(operations)
        .filter(([, operation]) => operation.status === "pending")
        .map(([modelId]) => modelId),
    ),
    [operations],
  );

  if (!selectedProvider || !selectedList) {
    return <SettingsWorkspaceState>先在供应商中添加连接，再管理模型。</SettingsWorkspaceState>;
  }

  const configuredModel = (modelId: string): ModelProviderDraft | undefined =>
    state.models.find((model) => model.ProviderId === selectedProvider.Id && model.Model === modelId);

  const openModel = (modelInfo: ProviderModelInfo): void => {
    const configured = configuredModel(modelInfo.id);
    const draft = configured ?? createModelDraft({
      provider: selectedProvider,
      modelInfo,
      modelField,
      endpointOptions: endpointChoices,
    });
    setEditingModel(draft);
    setEditingExisting(Boolean(configured));
  };

  const saveModel = (model: ModelProviderDraft): void => {
    const payload: ProviderModelConfigInput = {
      ...model,
      Endpoint: model.Endpoint as ProviderModelConfigInput["Endpoint"],
    };
    const request: ProviderModelUpsertInput = { model: payload };
    if (onUpsertProviderModel(request)) {
      setEditingModel(null);
    }
  };

  const requestModelRemoval = (model: ModelProviderDraft): void => {
    setEditingModel(null);
    onRequestRemoveModel(model);
  };

  const addManualModel = (): void => {
    const modelId = manualModelId.trim();
    if (!modelId) return;
    const model = createModelDraft({
      provider: selectedProvider,
      modelInfo: { id: modelId },
      modelField,
      endpointOptions: endpointChoices,
    });
    if (pendingModelIds.has(model.Id)) return;
    if (onUpsertProviderModel({
      model: {
        ...model,
        Endpoint: model.Endpoint as ProviderModelConfigInput["Endpoint"],
      },
    })) {
      setManualOpen(false);
      setManualModelId("");
    }
  };

  const addFetchedModel = (modelInfo: ProviderModelInfo): void => {
    const model = createModelDraft({
      provider: selectedProvider,
      modelInfo,
      modelField,
      endpointOptions: endpointChoices,
    });
    if (pendingModelIds.has(model.Id)) return;
    onUpsertProviderModel({
      model: {
        ...model,
        Endpoint: model.Endpoint as ProviderModelConfigInput["Endpoint"],
      },
    });
  };

  return (
    <div className={cn("grid h-full min-h-0 gap-3 bg-paper-50 p-3", showProviderList ? "grid-cols-[minmax(210px,260px)_minmax(0,1fr)]" : "grid-cols-1")}>
      {showProviderList ? <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50">
        <div className="flex shrink-0 items-center justify-between border-b border-ink-200/70 px-3 py-3">
          <div>
            <div className="text-[13px] font-semibold text-ink-900">供应商模型</div>
            <div className="mt-0.5 text-[11px] text-ink-500">选择要管理的供应商</div>
          </div>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setManualOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            添加
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full p-2">
          <div className="space-y-1">
            {state.providers.map((provider) => (
              <button
                key={provider.Id}
                type="button"
                disabled={disabled}
                className={cn(
                  "w-full rounded-md border px-2.5 py-2 text-left text-[12px] disabled:pointer-events-none disabled:opacity-60",
                  provider.Id === selectedProvider.Id ? "border-terra-200 bg-terra-50 text-terra-800" : "border-transparent hover:border-ink-200 hover:bg-paper-100",
                )}
                aria-pressed={provider.Id === selectedProvider.Id}
                onClick={() => setSelectedProviderId(provider.Id)}
              >
                <span className="block truncate font-medium">{provider.Id || "未命名供应商"}</span>
                <span className="mt-0.5 block text-[10.5px] opacity-70">{state.models.filter((model) => model.ProviderId === provider.Id).length} 个已配置模型</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </section> : null}
      <section className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50">
        <ProviderModelList
          selectedProvider={selectedProvider}
          catalog={selectedList.catalog}
          error={selectedList.error ? { ...selectedList.error, updatedAt: selectedList.error.updatedAt ?? "" } : undefined}
          loading={Boolean(selectedList.loading)}
          enabled={Boolean(selectedList.enabled)}
          rows={visibleRows}
          groups={visibleGroups}
          models={state.models}
          modelTemplate={modelTemplate}
          defaultModelId={state.defaultModel?.model.Id ?? ""}
          pendingModelIds={pendingModelIds}
          search={search}
          configuredOnly={configuredOnly}
          disabled={disabled}
          onSearch={setSearch}
          onConfiguredOnlyChange={setConfiguredOnly}
          onOpenModelGroups={() => setGroupUnsupportedDialogOpen(true)}
          showFetchAction={showFetchAction}
          onAddManualModel={() => setManualOpen(true)}
          onFetch={(force) => {
            setCatalogOpen(true);
            onFetchProviderModels(selectedProvider.Id, force, fetchEndpoint ?? toProviderEndpointInput(selectedProvider));
          }}
          onConfigureModel={openModel}
          onSetDefaultModel={(model) => onSetDefaultModel(model.Id)}
          onRemoveModel={requestModelRemoval}
          onAddModel={addFetchedModel}
        />
      </section>
      <ModelOptionsDialog
        model={editingModel}
        modelIndex={editingExisting ? 0 : null}
        modelTemplate={modelTemplate}
        defaultModelId={state.defaultModel?.model.Id ?? ""}
        endpointOptions={endpointChoices}
        disabled={disabled || Boolean(editingModel && operations[editingModel.Id]?.status === "pending")}
        commitLabels={{ existing: "保存", new: "添加" }}
        onOpenChange={(open) => !open && setEditingModel(null)}
        onChange={(patch) => setEditingModel((current) => current ? { ...current, ...patch } : current)}
        onCommit={() => editingModel && saveModel(editingModel)}
        onRemove={() => editingModel && requestModelRemoval(editingModel)}
      />
      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent
          title={`获取模型列表${selectedProvider ? ` - ${selectedProvider.Id}` : ""}`}
          description="点击每一行右侧的 + 立即加入可用模型。"
          className="h-[min(720px,calc(100dvh_-_48px))] w-[min(760px,calc(100vw_-_32px))] max-w-none rounded-xl bg-paper-50"
          bodyClassName="min-h-0 flex-1 p-0"
        >
          <CatalogModelDialogContent
            rows={catalogVisibleRows}
            groups={catalogGroups}
            configuredModels={state.models}
            pendingModelIds={pendingModelIds}
            providerId={selectedProvider.Id}
            search={catalogSearch}
            loading={Boolean(selectedList.loading)}
            error={selectedList.error?.message ?? null}
            disabled={disabled}
            onSearch={setCatalogSearch}
            onAddModel={addFetchedModel}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent title="添加模型" description={selectedProvider.Id} className="w-[min(460px,calc(100vw_-_32px))]" bodyClassName="p-4">
          <div className="space-y-4">
            <label className="block text-[12px] font-medium text-ink-750">
              模型 ID
              <input
                autoFocus
                value={manualModelId}
                placeholder="例如 gpt-4o"
                className="mt-1 h-9 w-full rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12.5px] outline-none focus:border-terra-300"
                onChange={(event) => setManualModelId(event.currentTarget.value)}
                onKeyDown={(event) => event.key === "Enter" && addManualModel()}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setManualOpen(false)}>取消</Button>
              <Button disabled={disabled || !manualModelId.trim()} onClick={addManualModel}>添加</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={groupUnsupportedDialogOpen} onOpenChange={setGroupUnsupportedDialogOpen}>
        <DialogContent title="暂不支持" className="w-[min(460px,calc(100vw-32px))]">
          <div className="p-4 text-[13px] text-ink-700">
            <p>完整的分组规则编辑（新增、修改、删除分组策略，以及模型分组赋值）需要修订保护的批量配置命令，暂未接入此即时保存界面。</p>
            <p className="mt-2">当前界面会保留已有分组的显示和筛选，但不会修改分组规则或模型归属。</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CatalogModelDialogContent({
  rows,
  groups,
  configuredModels,
  pendingModelIds,
  providerId,
  search,
  loading,
  error,
  disabled,
  onSearch,
  onAddModel,
}: {
  rows: ProviderModelInfo[];
  groups: ReturnType<typeof groupProviderModelRows>;
  configuredModels: readonly ModelProviderDraft[];
  pendingModelIds: ReadonlySet<string>;
  providerId: string;
  search: string;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onSearch: (value: string) => void;
  onAddModel: (model: ProviderModelInfo) => void;
}): JSX.Element {
  const configuredIds = new Set(
    configuredModels.filter((model) => model.ProviderId === providerId).map((model) => model.Model),
  );
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-ink-200/70 bg-paper-50 p-3">
        <input
          value={search}
          disabled={disabled}
          onChange={(event) => onSearch(event.currentTarget.value)}
          aria-label="搜索模型列表"
          placeholder="搜索模型"
          className="h-9 w-full rounded-md border border-ink-200 bg-paper-50 px-3 text-[12.5px] text-ink-800 outline-none focus:border-terra-300 focus:ring-2 focus:ring-terra-100"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {loading ? (
          <SettingsWorkspaceState className="min-h-[260px]">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />正在获取模型列表</span>
          </SettingsWorkspaceState>
        ) : error ? (
          <SettingsWorkspaceState className="min-h-[260px]">获取失败：{error}</SettingsWorkspaceState>
        ) : rows.length > 0 ? (
          <div className="divide-y divide-ink-200/70">
            {groups.map((group) => (
              <section key={group.id}>
                <div className="flex h-8 items-center justify-between border-b border-ink-200/70 bg-paper-100 px-3 text-[11.5px] font-semibold text-ink-700">
                  <span>{group.label}</span>
                  <span className="text-[10.5px] font-normal text-ink-450">{group.rows.length}</span>
                </div>
                {group.rows.map((row) => {
                  const configured = configuredIds.has(row.id);
                  const pending = pendingModelIds.has(modelConfigId(providerId, row.id));
                  return (
                    <div key={row.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[12px] text-ink-850" title={row.id}>{row.id}</div>
                        <div className="mt-0.5 truncate text-[10.5px] text-ink-450">{row.ownedBy || "供应商模型"}</div>
                      </div>
                      {configured ? (
                        <span className="rounded-md border border-moss-200 bg-moss-50 px-2 py-1 text-[10.5px] font-medium text-moss-700">已添加</span>
                      ) : pending ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10.5px] font-medium text-sky-700">
                          <Loader2 className="h-3 w-3 animate-spin" /> 添加中
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={disabled}
                          aria-label={`添加模型 ${row.id}`}
                          title="添加模型"
                          className="grid h-8 w-8 place-items-center rounded-md border border-ink-200 bg-paper-50 text-ink-600 transition hover:border-terra-300 hover:bg-terra-50 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-50"
                          onClick={() => onAddModel(row)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ) : (
          <SettingsWorkspaceState className="min-h-[260px]">没有匹配的模型</SettingsWorkspaceState>
        )}
      </ScrollArea>
    </div>
  );
}
