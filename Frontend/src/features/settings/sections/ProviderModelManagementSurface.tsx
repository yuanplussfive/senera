import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { ConfigFormFieldData } from "../../../api/eventTypes";
import type { ProviderModelConfigInput } from "../../../api/providerModelCommandTypes";
import { cn } from "../../../lib/util";
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
import {
  ProviderModelCatalogDialog,
  ProviderModelGroupUnsupportedDialog,
  ProviderModelManualAddDialog,
} from "./ProviderModelManagementDialogs";
import { ProviderModelProviderRail } from "./ProviderModelProviderRail";
import { useProviderModelSaveQueue } from "./useProviderModelSaveQueue";

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
  const pendingNewModelIdRef = useRef<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const selectedProvider =
    state.providers.find((provider) => provider.Id === selectedProviderId) ?? state.providers[0] ?? null;
  const submitModelRequest = (model: ModelProviderDraft): string | null =>
    onUpsertProviderModel({
      model: {
        ...model,
        Endpoint: model.Endpoint as ProviderModelConfigInput["Endpoint"],
      },
    });
  const modelSaveQueue = useProviderModelSaveQueue({
    operations,
    onSubmit: submitModelRequest,
    onCloseSaved: (modelId) => {
      if (editingModel?.Id !== modelId) return;
      pendingNewModelIdRef.current = null;
      setEditingModel(null);
      setEditingExisting(false);
    },
  });

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
    const queued = modelSaveQueue.readDraft(modelConfigId(selectedProvider.Id, modelInfo.id));
    const draft =
      queued ??
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
        <ProviderModelProviderRail
          disabled={disabled}
          models={state.models}
          providers={state.providers}
          selectedProviderId={selectedProvider.Id}
          onAdd={() => setManualOpen(true)}
          onSelect={setSelectedProviderId}
        />
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
            const flushed = modelSaveQueue.flush(editingModel.Id, true);
            if (!flushed || !modelSaveQueue.requestClose(editingModel.Id)) return;
          } else {
            if (!modelSaveQueue.requestClose(editingModel.Id)) return;
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
            modelSaveQueue.schedule(nextModel, immediate);
          }
        }}
        onCommitDraft={() => {
          if (editingExisting) modelSaveQueue.flush(editingModel?.Id);
        }}
        onCommit={() => {
          if (!editingModel) return;
          if (!editingExisting) {
            if (modelSaveQueue.submitNew(editingModel)) {
              pendingNewModelIdRef.current = editingModel.Id;
            }
            return;
          }
          const flushed = modelSaveQueue.flush(editingModel.Id, true);
          if (flushed && modelSaveQueue.requestClose(editingModel.Id)) {
            setEditingModel(null);
            setEditingExisting(false);
          }
        }}
        onRemove={() => editingModel && requestModelRemoval(editingModel)}
      />
      <ProviderModelCatalogDialog
        configuredModels={state.models}
        disabled={disabled}
        error={selectedList.error?.message ?? null}
        groups={catalogGroups}
        loading={Boolean(selectedList.loading)}
        open={catalogOpen}
        pendingModelIds={pendingModelIds}
        providerId={selectedProvider.Id}
        rows={catalogVisibleRows}
        search={catalogSearch}
        onAddModel={addFetchedModel}
        onOpenChange={setCatalogOpen}
        onSearch={setCatalogSearch}
      />
      <ProviderModelManualAddDialog
        disabled={disabled}
        modelId={manualModelId}
        open={manualOpen}
        providerId={selectedProvider.Id}
        onAdd={addManualModel}
        onModelIdChange={setManualModelId}
        onOpenChange={setManualOpen}
      />
      <ProviderModelGroupUnsupportedDialog
        open={groupUnsupportedDialogOpen}
        onOpenChange={setGroupUnsupportedDialogOpen}
      />
    </div>
  );
}
