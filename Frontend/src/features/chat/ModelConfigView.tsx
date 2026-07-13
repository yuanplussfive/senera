import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import type { ProviderModelInfo } from "../../api/eventTypes";
import {
  Dialog,
  DialogContent,
} from "../../shared/ui";
import { cn } from "../../lib/util";
import {
  applyModelProvidersDraft,
  cloneRecord,
  createModelDraft,
  createProviderDraft,
  findItemField,
  findTopField,
  groupProviderModelRows,
  normalizeModelGroupDraft,
  normalizeModelProviderDraft,
  normalizeProviderEndpointDraft,
  providerEnabled,
  providerIdLabel,
  readDraftOrEffectiveValue,
  readFieldOptions,
  readModelGroups,
  readModelProviders,
  readProviderModelRows,
  readProviderEndpoints,
  readString,
  sortProviderModelRows,
  toProviderEndpointInput,
} from "./modelConfigData";
import type {
  ModelConfigViewProps,
  ModelGroupDraft,
  ModelOptionsState,
  ModelProviderDraft,
  ProviderEndpointDraft,
} from "./modelConfigTypes";
import { ModelGroupsDialog } from "./ModelGroupsDialog";
import { ModelOptionsDialog } from "./ModelOptionsDialog";
import {
  ProviderEditor,
  ProviderList,
} from "./ModelProviderPanels";
import { ProviderModelList } from "./ModelProviderModelList";
import { RemoteModelPickerDialog } from "./RemoteModelPickerDialog";

export function ModelConfigView({
  value,
  section,
  disabled = false,
  layoutMode = "panel",
  catalogs,
  errors,
  loadingProviderIds,
  onFetchProviderModels,
  onChange,
}: ModelConfigViewProps): JSX.Element {
  const providerField = findTopField(section, "ModelProviderEndpoints");
  const modelField = findTopField(section, "ModelProviders");
  const modelGroupField = findTopField(section, "ModelGroups");
  const endpointOptions = readFieldOptions(findItemField(modelField, "Endpoint"));
  const providers = readProviderEndpoints(readDraftOrEffectiveValue(value, section, "ModelProviderEndpoints"));
  const models = readModelProviders(readDraftOrEffectiveValue(value, section, "ModelProviders"));
  const modelGroups = readModelGroups(readDraftOrEffectiveValue(value, section, "ModelGroups"));
  const defaultModelId = readString(readDraftOrEffectiveValue(value, section, "DefaultModelProviderId")) ?? "";
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
  const [optionsModelState, setOptionsModelState] = useState<ModelOptionsState | null>(null);
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const [modelGroupsOpen, setModelGroupsOpen] = useState(false);
  const [remoteModelPickerOpen, setRemoteModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [showConfiguredOnly, setShowConfiguredOnly] = useState(false);
  const deferredModelSearch = useDeferredValue(modelSearch);
  const [, startProviderTransition] = useTransition();

  useEffect(() => {
    if (selectedProviderIndex < providers.length) return;
    setSelectedProviderIndex(Math.max(0, providers.length - 1));
  }, [providers.length, selectedProviderIndex]);

  const selectedProvider = providers[selectedProviderIndex] ?? null;
  const optionsModel = optionsModelState?.model ?? null;
  const modelTemplate = useMemo(() => cloneRecord(modelField?.defaultItem ?? {}), [modelField]);
  const selectedProviderCatalog = selectedProvider?.Id ? catalogs[selectedProvider.Id] : undefined;
  const selectedProviderError = selectedProvider?.Id ? errors[selectedProvider.Id] : undefined;
  const selectedProviderLoading = selectedProvider?.Id
    ? Boolean(loadingProviderIds[selectedProvider.Id])
    : false;
  const selectedProviderEnabled = providerEnabled(selectedProvider);
  const providerModelRows = useMemo(
    () => sortProviderModelRows({
      rows: readProviderModelRows({
        catalogModels: selectedProviderCatalog?.models ?? [],
        models,
        providerId: selectedProvider?.Id ?? "",
        search: deferredModelSearch,
        configuredOnly: showConfiguredOnly,
      }),
      models,
      providerId: selectedProvider?.Id ?? "",
      defaultModelId,
    }),
    [defaultModelId, deferredModelSearch, models, selectedProvider?.Id, selectedProviderCatalog, showConfiguredOnly],
  );
  const providerModelGroups = useMemo(
    () => groupProviderModelRows(providerModelRows, modelGroups),
    [modelGroups, providerModelRows],
  );

  const writeProviders = (
    nextProviders: ProviderEndpointDraft[],
    nextModels: ModelProviderDraft[] = models,
  ): void => {
    onChange({
      ...value,
      ModelProviderEndpoints: nextProviders.map(normalizeProviderEndpointDraft),
      ModelProviders: nextModels.map(normalizeModelProviderDraft),
    });
  };

  const writeModels = (
    nextModels: ModelProviderDraft[],
    requestedDefaultModelId = defaultModelId,
  ): void => {
    onChange(applyModelProvidersDraft({
      models: nextModels,
      requestedDefaultModelId,
      value,
    }));
  };

  const writeModelGroups = (nextGroups: ModelGroupDraft[]): void => {
    onChange({
      ...value,
      ModelGroups: nextGroups.map(normalizeModelGroupDraft),
    });
  };

  const addProvider = (): void => {
    const provider = createProviderDraft(providerField, providers);
    const nextProviders = [...providers, provider];
    writeProviders(nextProviders);
    setSelectedProviderIndex(nextProviders.length - 1);
    setProviderSettingsOpen(true);
  };

  const updateProvider = (index: number, patch: Partial<ProviderEndpointDraft>): void => {
    const previous = providers[index];
    if (!previous) return;
    const nextProvider = normalizeProviderEndpointDraft({ ...previous, ...patch });
    const nextProviders = providers.map((provider, providerIndex) =>
      providerIndex === index ? nextProvider : provider);
    const nextModels = previous.Id !== nextProvider.Id
      ? models.map((model) => model.ProviderId === previous.Id
        ? { ...model, ProviderId: nextProvider.Id }
        : model)
      : models;
    writeProviders(nextProviders, nextModels);
  };

  const removeProvider = (index: number): void => {
    const provider = providers[index];
    if (!provider) return;
    const nextProviders = providers.filter((_, providerIndex) => providerIndex !== index);
    const nextModels = models.filter((model) => model.ProviderId !== provider.Id);
    onChange({
      ...applyModelProvidersDraft({
        models: nextModels,
        requestedDefaultModelId: defaultModelId,
        value,
      }),
      ModelProviderEndpoints: nextProviders.map(normalizeProviderEndpointDraft),
    });
    setSelectedProviderIndex(Math.max(0, Math.min(index, nextProviders.length - 1)));
  };

  const configureModelFromCatalog = (modelInfo: ProviderModelInfo): void => {
    if (!selectedProvider?.Id) return;
    const existingIndex = models.findIndex((model) =>
      model.ProviderId === selectedProvider.Id && model.Model === modelInfo.id);
    if (existingIndex >= 0) {
      setOptionsModelState({
        model: models[existingIndex],
        index: existingIndex,
      });
      return;
    }

    const model = createModelDraft({
      provider: selectedProvider,
      modelInfo,
      modelField,
      endpointOptions,
    });
    setOptionsModelState({
      model,
      index: null,
    });
  };

  const commitModelOptions = (): void => {
    if (!optionsModelState) return;
    const nextModel = normalizeModelProviderDraft(optionsModelState.model);
    if (optionsModelState.index === null) {
      writeModels([...models, nextModel], defaultModelId || nextModel.Id);
      setOptionsModelState(null);
      return;
    }
    const previous = models[optionsModelState.index];
    const nextDefault = previous && defaultModelId === previous.Id ? nextModel.Id : defaultModelId;
    writeModels(
      models.map((model, modelIndex) => modelIndex === optionsModelState.index ? nextModel : model),
      nextDefault,
    );
    setOptionsModelState(null);
  };

  const updateModelDraft = (patch: Partial<ModelProviderDraft>): void => {
    setOptionsModelState((current) => current
      ? {
        ...current,
        model: normalizeModelProviderDraft({ ...current.model, ...patch }),
      }
      : current);
  };

  const removeModel = (index: number): void => {
    const nextModels = models.filter((_, modelIndex) => modelIndex !== index);
    writeModels(nextModels);
    if (optionsModelState?.index === index) {
      setOptionsModelState(null);
    } else if (optionsModelState?.index !== null && optionsModelState?.index !== undefined && optionsModelState.index > index) {
      setOptionsModelState({
        ...optionsModelState,
        index: optionsModelState.index - 1,
      });
    }
  };

  const fetchSelectedProviderModels = (force?: boolean): void => {
    if (!selectedProvider?.Id || !selectedProviderEnabled) return;
    onFetchProviderModels(
      selectedProvider.Id,
      force,
      toProviderEndpointInput(selectedProvider),
    );
  };

  const openRemoteModelPicker = (force?: boolean): void => {
    setRemoteModelPickerOpen(true);
    fetchSelectedProviderModels(force);
  };

  const embedded = layoutMode === "embedded";

  return (
    <>
      <div className={cn(
        "grid bg-paper-50",
        embedded
          ? "min-h-0 grid-cols-1 overflow-visible lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]"
          : "h-full min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(148px,34%)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]",
      )}>
        <section className={cn(
          "flex min-h-0 flex-col border-b border-ink-200/70 bg-[var(--theme-config-list-bg)] lg:border-b-0 lg:border-r",
          embedded ? "overflow-visible" : "h-full overflow-hidden",
        )}>
          <ProviderList
            providers={providers}
            catalogs={catalogs}
            errors={errors}
            loadingProviderIds={loadingProviderIds}
            selectedIndex={selectedProviderIndex}
            disabled={disabled}
            layoutMode={layoutMode}
            onAdd={addProvider}
            onSelect={(index) => startProviderTransition(() => setSelectedProviderIndex(index))}
            onRemove={removeProvider}
            onOpenSettings={() => setProviderSettingsOpen(true)}
          />
        </section>
        <section className={cn(
          "min-h-0 min-w-0 bg-paper-50",
          embedded ? "overflow-visible" : "h-full overflow-hidden",
        )}>
          <ProviderModelList
            selectedProvider={selectedProvider}
            catalog={selectedProviderCatalog}
            error={selectedProviderError}
            loading={selectedProviderLoading}
            enabled={selectedProviderEnabled}
            rows={providerModelRows}
            groups={providerModelGroups}
            models={models}
            modelTemplate={modelTemplate}
            defaultModelId={defaultModelId}
            search={modelSearch}
            configuredOnly={showConfiguredOnly}
            disabled={disabled}
            onSearch={setModelSearch}
            onConfiguredOnlyChange={setShowConfiguredOnly}
            onOpenModelGroups={() => setModelGroupsOpen(true)}
            onFetch={openRemoteModelPicker}
            onConfigureModel={configureModelFromCatalog}
            layoutMode={layoutMode}
          />
        </section>
      </div>
      <Dialog open={providerSettingsOpen} onOpenChange={setProviderSettingsOpen}>
        <DialogContent
          title={frontendMessage("runtime.migrated.features.chat.ModelConfigView.311.17")}
          description={selectedProvider ? providerIdLabel(selectedProvider) : "选择供应商"}
          motionPreset="focus"
          className="h-[min(780px,calc(100dvh_-_48px))] w-[min(860px,calc(100vw_-_32px))] max-w-none rounded-xl bg-paper-50"
          bodyClassName="min-h-0 flex-1"
        >
          <ProviderEditor
            provider={selectedProvider}
            providerIndex={selectedProviderIndex}
            catalog={selectedProviderCatalog}
            error={selectedProviderError}
            loading={selectedProviderLoading}
            disabled={disabled}
            onChange={updateProvider}
            onRemove={(index) => {
              removeProvider(index);
              setProviderSettingsOpen(false);
            }}
            onFetch={fetchSelectedProviderModels}
          />
        </DialogContent>
      </Dialog>
      <RemoteModelPickerDialog
        catalog={selectedProviderCatalog}
        configuredModels={models.filter((model) => model.ProviderId === (selectedProvider?.Id ?? ""))}
        defaultModelId={defaultModelId}
        disabled={disabled}
        error={selectedProviderError}
        groups={modelGroups}
        loading={selectedProviderLoading}
        modelTemplate={modelTemplate}
        open={remoteModelPickerOpen}
        provider={selectedProvider}
        onConfigureModel={(model) => {
          configureModelFromCatalog(model);
          setRemoteModelPickerOpen(false);
        }}
        onOpenChange={setRemoteModelPickerOpen}
        onRefresh={() => fetchSelectedProviderModels(true)}
      />
      <ModelOptionsDialog
        model={optionsModel}
        modelIndex={optionsModelState?.index ?? null}
        modelTemplate={modelTemplate}
        defaultModelId={defaultModelId}
        endpointOptions={endpointOptions}
        disabled={disabled}
        onOpenChange={(open) => {
          if (!open) setOptionsModelState(null);
        }}
        onChange={updateModelDraft}
        onCommit={commitModelOptions}
        onSetDefault={(modelId) => writeModels(models, modelId)}
        onRemove={removeModel}
      />
      <ModelGroupsDialog
        open={modelGroupsOpen}
        groups={modelGroups}
        groupTemplate={cloneRecord(modelGroupField?.defaultItem ?? {})}
        disabled={disabled}
        onOpenChange={setModelGroupsOpen}
        onChange={writeModelGroups}
        onResetDefault={() => {
          const nextValue = { ...value };
          delete nextValue.ModelGroups;
          onChange(nextValue);
        }}
      />
    </>
  );
}
