import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import type { ProviderModelInfo } from "../../api/eventTypes";
import {
  Dialog,
  DialogContent,
} from "../../shared/ui";
import type { JsonConfigObject } from "../../shared/config/JsonConfigForm";
import {
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

export function ModelConfigView({
  value,
  section,
  disabled = false,
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
    const normalizedModels = nextModels.map(normalizeModelProviderDraft);
    const resolvedDefault = normalizedModels.some((model) => model.Id === requestedDefaultModelId)
      ? requestedDefaultModelId
      : normalizedModels[0]?.Id;
    const nextValue: JsonConfigObject = {
      ...value,
      ModelProviders: normalizedModels,
    };
    if (resolvedDefault) {
      nextValue.DefaultModelProviderId = resolvedDefault;
    } else {
      delete nextValue.DefaultModelProviderId;
    }
    onChange(nextValue);
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
    const resolvedDefault = nextModels.some((model) => model.Id === defaultModelId)
      ? defaultModelId
      : nextModels[0]?.Id;
    const nextValue: JsonConfigObject = {
      ...value,
      ModelProviderEndpoints: nextProviders.map(normalizeProviderEndpointDraft),
      ModelProviders: nextModels.map(normalizeModelProviderDraft),
    };
    if (resolvedDefault) {
      nextValue.DefaultModelProviderId = resolvedDefault;
    } else {
      delete nextValue.DefaultModelProviderId;
    }
    onChange(nextValue);
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

  return (
    <>
      <div className="grid h-full min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(260px,42%)_minmax(0,1fr)] overflow-hidden bg-paper-50 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <section className="flex h-full min-h-0 flex-col overflow-hidden border-b border-ink-200/70 bg-[#f6f0e7] lg:border-b-0 lg:border-r">
          <ProviderList
            providers={providers}
            catalogs={catalogs}
            errors={errors}
            loadingProviderIds={loadingProviderIds}
            selectedIndex={selectedProviderIndex}
            disabled={disabled}
            onAdd={addProvider}
            onSelect={(index) => startProviderTransition(() => setSelectedProviderIndex(index))}
            onRemove={removeProvider}
            onOpenSettings={() => setProviderSettingsOpen(true)}
          />
        </section>
        <section className="h-full min-h-0 min-w-0 overflow-hidden bg-paper-50">
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
            onFetch={(force) => selectedProvider?.Id && selectedProviderEnabled && onFetchProviderModels(
              selectedProvider.Id,
              force,
              toProviderEndpointInput(selectedProvider),
            )}
            onConfigureModel={configureModelFromCatalog}
          />
        </section>
      </div>
      <Dialog open={providerSettingsOpen} onOpenChange={setProviderSettingsOpen}>
        <DialogContent
          title="供应商设置"
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
            onFetch={(force) => selectedProvider?.Id && selectedProviderEnabled && onFetchProviderModels(
              selectedProvider.Id,
              force,
              toProviderEndpointInput(selectedProvider),
            )}
          />
        </DialogContent>
      </Dialog>
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
