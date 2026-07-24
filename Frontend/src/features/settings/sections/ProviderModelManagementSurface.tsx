import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { ConfigFormFieldData } from "../../../api/eventTypes";
import type { ProviderModelConfigInput } from "../../../api/providerModelCommandTypes";
import { cn } from "../../../lib/util";
import {
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  FormField,
  FormLabel,
  Input,
  ScrollArea,
} from "../../../shared/ui";
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

interface ModelSaveQueueEntry {
  draft: ModelProviderDraft;
  requestId: string | null;
  requestDraft: ModelProviderDraft | null;
  timer: number | null;
  closeRequested: boolean;
}

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
  embedded = false,
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
  /** Let the parent detail pane own scrolling and use the compact model toolbar. */
  embedded?: boolean;
}): JSX.Element {
  const modelGroups = readModelGroups(readDraftOrEffectiveValue(draft, section, "ModelGroups"));
  const [selectedProviderId, setSelectedProviderId] = useState(
    initialSelectedProviderId ?? state.providers[0]?.Id ?? "",
  );
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
  const modelSaveQueueRef = useRef<Map<string, ModelSaveQueueEntry>>(new Map());
  const pendingNewModelIdRef = useRef<string | null>(null);
  const operationsRef = useRef(operations);
  const flushExistingModelSaveRef = useRef<(modelId?: string, closeRequested?: boolean) => boolean>(() => true);
  operationsRef.current = operations;
  const deferredSearch = useDeferredValue(search);
  const selectedProvider =
    state.providers.find((provider) => provider.Id === selectedProviderId) ?? state.providers[0] ?? null;

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
  useEffect(
    () => () => {
      for (const entry of modelSaveQueueRef.current.values()) {
        if (entry.timer !== null) window.clearTimeout(entry.timer);
      }
    },
    [],
  );
  useEffect(() => {
    for (const [modelId, current] of modelSaveQueueRef.current) {
      if (!current.requestId) continue;
      const operation = operations[modelId];
      if (!operation || operation.commandId !== current.requestId || operation.status === "pending") continue;
      if (operation.status === "error") {
        modelSaveQueueRef.current.set(modelId, {
          ...current,
          requestId: null,
          requestDraft: null,
          closeRequested: false,
        });
        continue;
      }
      const hasNewerDraft = !sameModelDraft(current.draft, current.requestDraft ?? current.draft);
      modelSaveQueueRef.current.set(modelId, {
        ...current,
        requestId: null,
        requestDraft: null,
        closeRequested: hasNewerDraft ? current.closeRequested : false,
      });
      if (hasNewerDraft) {
        flushExistingModelSaveRef.current(modelId, false);
        continue;
      }
      if (current.closeRequested && editingModel?.Id === modelId) {
        modelSaveQueueRef.current.delete(modelId);
        pendingNewModelIdRef.current = null;
        setEditingModel(null);
        setEditingExisting(false);
      }
    }
  }, [editingModel?.Id, operations]);
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
    ? (selectedList?.rows.filter((row) => {
        const query = deferredSearch.trim().toLowerCase();
        if (
          configuredOnly &&
          !state.models.some((model) => model.ProviderId === selectedProvider.Id && model.Model === row.id)
        )
          return false;
        if (!query) return true;
        return row.id.toLowerCase().includes(query);
      }) ?? [])
    : [];
  const visibleGroups = groupProviderModelRows(visibleRows, modelGroups);
  const catalogRows = selectedList?.catalog?.models ?? [];
  const catalogVisibleRows = catalogRows.filter((row) => {
    const query = catalogSearch.trim().toLowerCase();
    return !query || `${row.id} ${row.ownedBy ?? ""}`.toLowerCase().includes(query);
  });
  const catalogGroups = groupProviderModelRows(catalogVisibleRows, modelGroups);
  const pendingModelIds = useMemo(
    () =>
      new Set(
        Object.entries(operations)
          .filter(([, operation]) => operation.status === "pending")
          .map(([modelId]) => modelId),
      ),
    [operations],
  );

  if (!selectedProvider || !selectedList) {
    return <SettingsWorkspaceState>{frontendMessage("settings.modelManagement.noProvider")}</SettingsWorkspaceState>;
  }

  const configuredModel = (modelId: string): ModelProviderDraft | undefined =>
    state.models.find((model) => model.ProviderId === selectedProvider.Id && model.Model === modelId);

  const openModel = (modelInfo: ProviderModelInfo): void => {
    const configured = configuredModel(modelInfo.id);
    const queued = modelSaveQueueRef.current.get(modelConfigId(selectedProvider.Id, modelInfo.id));
    const draft =
      queued?.draft ??
      configured ??
      createModelDraft({
        provider: selectedProvider,
        modelInfo,
        modelField,
        endpointOptions: endpointChoices,
      });
    setEditingModel(draft);
    setEditingExisting(Boolean(configured));
    pendingNewModelIdRef.current = null;
  };

  const submitModelRequest = (model: ModelProviderDraft): string | null =>
    onUpsertProviderModel({
      model: {
        ...model,
        Endpoint: model.Endpoint as ProviderModelConfigInput["Endpoint"],
      },
    });

  const requestModelSave = (model: ModelProviderDraft, closeRequested: boolean): boolean => {
    const current = modelSaveQueueRef.current.get(model.Id) ?? {
      draft: model,
      requestId: null,
      requestDraft: null,
      timer: null,
      closeRequested: false,
    };
    if (current.requestId && operationsRef.current[model.Id]?.status === "pending") {
      modelSaveQueueRef.current.set(model.Id, {
        ...current,
        draft: model,
        closeRequested: current.closeRequested || closeRequested,
      });
      return false;
    }
    const requestId = submitModelRequest(model);
    if (!requestId) return false;
    modelSaveQueueRef.current.set(model.Id, {
      ...current,
      draft: model,
      requestId,
      requestDraft: model,
      timer: null,
      closeRequested: current.closeRequested || closeRequested,
    });
    return true;
  };

  const flushExistingModelSave = (modelId = editingModel?.Id, closeRequested = false): boolean => {
    if (!modelId) return true;
    const current = modelSaveQueueRef.current.get(modelId);
    if (!current) return true;
    if (current.timer !== null) window.clearTimeout(current.timer);
    modelSaveQueueRef.current.set(modelId, {
      ...current,
      timer: null,
      closeRequested: current.closeRequested || closeRequested,
    });
    if (current.requestId) return false;
    return requestModelSave(current.draft, closeRequested || current.closeRequested);
  };
  flushExistingModelSaveRef.current = flushExistingModelSave;

  const scheduleExistingModelSave = (model: ModelProviderDraft, immediate: boolean): void => {
    const current = modelSaveQueueRef.current.get(model.Id) ?? {
      draft: model,
      requestId: null,
      requestDraft: null,
      timer: null,
      closeRequested: false,
    };
    if (current.timer !== null) window.clearTimeout(current.timer);
    const timer = window.setTimeout(
      () => {
        const entry = modelSaveQueueRef.current.get(model.Id);
        if (!entry) return;
        modelSaveQueueRef.current.set(model.Id, { ...entry, timer: null, draft: model });
        requestModelSave(model, false);
      },
      immediate ? 0 : 500,
    );
    modelSaveQueueRef.current.set(model.Id, { ...current, draft: model, timer });
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
    if (
      onUpsertProviderModel({
        model: {
          ...model,
          Endpoint: model.Endpoint as ProviderModelConfigInput["Endpoint"],
        },
      })
    ) {
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
    <div
      className={cn(
        embedded ? "grid min-h-0 bg-paper-50" : "grid h-full min-h-0 bg-paper-50",
        showProviderList ? "grid-cols-[minmax(210px,260px)_minmax(0,1fr)]" : "grid-cols-1",
      )}
    >
      {showProviderList ? (
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50">
          <div className="flex shrink-0 items-center justify-between border-b border-ink-200/70 px-3 py-3">
            <div>
              <div className="text-[13px] font-semibold text-ink-900">
                {frontendMessage("settings.modelManagement.title")}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-500">
                {frontendMessage("settings.modelManagement.providerHint")}
              </div>
            </div>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => setManualOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              {frontendMessage("settings.modelManagement.add")}
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
                    provider.Id === selectedProvider.Id
                      ? "border-accent-border bg-accent-surface text-accent-content"
                      : "border-transparent hover:border-ink-200 hover:bg-paper-100",
                  )}
                  aria-pressed={provider.Id === selectedProvider.Id}
                  onClick={() => setSelectedProviderId(provider.Id)}
                >
                  <span className="block truncate font-medium">
                    {provider.Id || frontendMessage("settings.provider.unnamed")}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] opacity-70">
                    {frontendMessage("settings.modelManagement.configuredCount", {
                      count: state.models.filter((model) => model.ProviderId === provider.Id).length,
                    })}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </section>
      ) : null}
      <section className={cn("min-h-0 min-w-0 bg-paper-50", embedded ? "overflow-visible" : "overflow-hidden")}>
        <ProviderModelList
          selectedProvider={selectedProvider}
          catalog={selectedList.catalog}
          error={
            selectedList.error ? { ...selectedList.error, updatedAt: selectedList.error.updatedAt ?? "" } : undefined
          }
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
          layoutMode={embedded ? "embedded" : "panel"}
          compactHeader={embedded}
          onSearch={setSearch}
          onConfiguredOnlyChange={setConfiguredOnly}
          onOpenModelGroups={() => setGroupUnsupportedDialogOpen(true)}
          showFetchAction={showFetchAction}
          onAddManualModel={() => setManualOpen(true)}
          onFetch={(force) => {
            setCatalogOpen(true);
            onFetchProviderModels(
              selectedProvider.Id,
              force,
              fetchEndpoint ?? toProviderEndpointInput(selectedProvider),
            );
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
        commitLabels={{
          existing: frontendMessage(
            editingModel &&
              (operations[editingModel.Id]?.status === "error" || pendingNewModelIdRef.current === editingModel.Id)
              ? "settings.action.retry"
              : "settings.action.confirm",
          ),
          new: frontendMessage(
            editingModel &&
              (operations[editingModel.Id]?.status === "error" || pendingNewModelIdRef.current === editingModel.Id)
              ? "settings.action.retry"
              : "settings.action.add",
          ),
        }}
        onOpenChange={(open) => {
          if (open) return;
          if (!editingModel) return;
          if (editingExisting) {
            const flushed = flushExistingModelSave(editingModel.Id, true);
            if (!flushed || modelSaveQueueRef.current.get(editingModel.Id)?.requestId) return;
          } else {
            const current = modelSaveQueueRef.current.get(editingModel.Id);
            if (current?.requestId) {
              modelSaveQueueRef.current.set(editingModel.Id, { ...current, closeRequested: true });
              return;
            }
            pendingNewModelIdRef.current = null;
          }
          setEditingModel(null);
          setEditingExisting(false);
        }}
        onChange={(patch) => {
          if (!editingModel) return;
          const nextModel = { ...editingModel, ...patch };
          setEditingModel(nextModel);
          if (editingExisting) {
            const immediate =
              "Capabilities" in patch ||
              "Endpoint" in patch ||
              "Icon" in patch ||
              Object.values(patch).some((value) => typeof value === "boolean");
            scheduleExistingModelSave(nextModel, immediate);
          }
        }}
        onCommitDraft={() => {
          if (editingExisting) flushExistingModelSave();
        }}
        onCommit={() => {
          if (!editingModel) return;
          if (!editingExisting) {
            const current = modelSaveQueueRef.current.get(editingModel.Id);
            if (current?.requestId) {
              modelSaveQueueRef.current.set(editingModel.Id, { ...current, closeRequested: true });
              return;
            }
            const requestId = submitModelRequest(editingModel);
            if (requestId) {
              modelSaveQueueRef.current.set(editingModel.Id, {
                draft: editingModel,
                requestId,
                requestDraft: editingModel,
                timer: null,
                closeRequested: true,
              });
              pendingNewModelIdRef.current = editingModel.Id;
            }
            return;
          }
          const flushed = flushExistingModelSave(editingModel.Id, true);
          if (flushed && !modelSaveQueueRef.current.get(editingModel.Id)?.requestId) {
            setEditingModel(null);
            setEditingExisting(false);
          }
        }}
        onRemove={() => editingModel && requestModelRemoval(editingModel)}
      />
      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent
          title={frontendMessage("settings.modelManagement.fetchTitle")}
          description={
            selectedProvider
              ? frontendMessage("settings.modelManagement.fetchDescription", { provider: selectedProvider.Id })
              : undefined
          }
          className="h-[min(760px,calc(100dvh_-_32px))] w-[min(780px,calc(100vw_-_32px))] max-w-none"
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
        <DialogContent
          title={frontendMessage("settings.modelManagement.addModelTitle")}
          description={frontendMessage("settings.modelManagement.providerLabel", { provider: selectedProvider.Id })}
          className="min-h-[480px] w-[min(560px,calc(100vw_-_32px))]"
          bodyClassName="flex min-h-0 flex-1 flex-col px-8 pb-7 pt-3"
        >
          <FormField>
            <FormLabel required>{frontendMessage("settings.modelManagement.modelIdLabel")}</FormLabel>
            <Input
              autoFocus
              value={manualModelId}
              placeholder={frontendMessage("settings.modelManagement.modelIdPlaceholder")}
              onChange={(event) => setManualModelId(event.currentTarget.value)}
              onKeyDown={(event) => event.key === "Enter" && addManualModel()}
            />
          </FormField>
          <DialogActions className="mt-auto">
            <DialogActionButton onClick={() => setManualOpen(false)}>
              {frontendMessage("settings.action.cancel")}
            </DialogActionButton>
            <DialogActionButton variant="primary" disabled={disabled || !manualModelId.trim()} onClick={addManualModel}>
              {frontendMessage("settings.action.add")}
            </DialogActionButton>
          </DialogActions>
        </DialogContent>
      </Dialog>
      <Dialog open={groupUnsupportedDialogOpen} onOpenChange={setGroupUnsupportedDialogOpen}>
        <DialogContent
          title={frontendMessage("settings.modelManagement.unsupportedTitle")}
          className="w-[min(460px,calc(100vw-32px))]"
        >
          <div className="p-4 text-[13px] text-ink-700">
            <p>{frontendMessage("settings.modelManagement.unsupportedDescription")}</p>
            <p className="mt-2">{frontendMessage("settings.modelManagement.unsupportedHint")}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function sameModelDraft(left: ModelProviderDraft, right: ModelProviderDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
          aria-label={frontendMessage("settings.modelManagement.search")}
          placeholder={frontendMessage("settings.modelManagement.search")}
          className="h-9 w-full rounded-md border border-ink-200 bg-paper-50 px-3 text-[12.5px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {loading ? (
          <SettingsWorkspaceState className="min-h-[260px]">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {frontendMessage("settings.modelManagement.fetching")}
            </span>
          </SettingsWorkspaceState>
        ) : error ? (
          <SettingsWorkspaceState className="min-h-[260px]">
            {frontendMessage("settings.modelManagement.fetchFailed", { error })}
          </SettingsWorkspaceState>
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
                    <div
                      key={row.id}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[12px] text-ink-850" title={row.id}>
                          {row.id}
                        </div>
                        <div className="mt-0.5 truncate text-[10.5px] text-ink-450">
                          {row.ownedBy || frontendMessage("settings.modelManagement.providerModel")}
                        </div>
                      </div>
                      {configured ? (
                        <span className="text-[10.5px] font-medium text-moss-700">
                          {frontendMessage("settings.modelManagement.added")}
                        </span>
                      ) : pending ? (
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-ink-600">
                          <Loader2 className="h-3 w-3 animate-spin" />{" "}
                          {frontendMessage("settings.modelManagement.adding")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={disabled}
                          aria-label={frontendMessage("settings.modelManagement.addModelAria", { model: row.id })}
                          title={frontendMessage("settings.modelManagement.addModel")}
                          className="grid h-8 w-8 place-items-center rounded-md border border-ink-200 bg-paper-50 text-ink-600 transition hover:border-accent-border-strong hover:bg-accent-surface-hover hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-50"
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
          <SettingsWorkspaceState className="min-h-[260px]">
            {frontendMessage("settings.modelManagement.noMatches")}
          </SettingsWorkspaceState>
        )}
      </ScrollArea>
    </div>
  );
}
