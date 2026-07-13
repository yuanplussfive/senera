import { useMemo, useState } from "react";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { SettingsWorkspaceState } from "../SettingsWorkspaceSurface";
import { useModelServiceLayout } from "../../../shared/responsive";
import { cn } from "../../../lib/util";
import { findItemField, findTopField, readFieldOptions, toProviderEndpointInput } from "../../chat/modelConfigData";
import type { ModelProviderDraft, ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import { AddProviderDialog, RenameProviderDialog } from "./ProviderConnectionDialogs";
import { ProviderConnectionEditor } from "./ProviderConnectionEditor";
import { ProviderConnectionList } from "./ProviderConnectionList";
import { ProviderModelManagementSurface } from "./ProviderModelManagementSurface";
import {
  readDefaultAssistantModelCandidates,
  readModelServiceState,
  type ModelServiceState,
} from "./modelServiceState";
import { useProviderConnectionActions } from "./useProviderConnectionActions";
import { ProviderModelLifecycleDialogs } from "./ProviderModelLifecycleDialogs";

const EMPTY_DRAFT: Record<string, unknown> = {};

/** Provider/model management. Default assignment lives in DefaultModelSection. */
export function ModelServiceSection({
  systemConfig,
}: {
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [openCatalogSignal, setOpenCatalogSignal] = useState(0);
  const [modelPendingRemoval, setModelPendingRemoval] = useState<ModelProviderDraft | null>(null);
  const [providerPendingRemoval, setProviderPendingRemoval] = useState<ProviderEndpointDraft | null>(null);
  const layout = useModelServiceLayout();
  const snapshot = systemConfig?.configSnapshot ?? null;
  const modelSection = snapshot?.form.sections.find((section) => section.name === "models") ?? null;
  const state = systemConfig && snapshot && modelSection
    ? readModelServiceState({
      catalogs: systemConfig.providerModelCatalogs,
      draft: EMPTY_DRAFT,
      errors: systemConfig.providerModelErrors,
      loadingIds: systemConfig.providerModelLoadingIds,
      section: modelSection,
      selectedProviderId,
    })
    : null;
  const modelField = useMemo(
    () => findTopField(modelSection ?? undefined, "ModelProviders"),
    [modelSection],
  );
  const modelTemplate = useMemo(() => modelField?.defaultItem ?? {}, [modelField]);
  const defaultModelCandidates = useMemo(
    () => state ? readDefaultAssistantModelCandidates({
      models: state.models,
      providers: state.providers,
      modelTemplate,
    }) : [],
    [modelTemplate, state],
  );
  const currentDefaultModelId = state?.defaultModel?.model.Id ?? null;
  const emptyState = useMemo((): ModelServiceState => ({
    providers: [], models: [], selectedProvider: null, selectedProviderModelList: null,
    defaultModel: null, defaultModelStatus: "待设置", defaultSlots: [], diagnostics: [],
    catalogSignalCount: 0, enabledModelCount: 0, enabledProviders: 0, providerCount: 0,
    providerIssues: [],
  }), []);
  const noopCommands = useMemo(() => ({
    deleteProviderEndpoint: () => null as never,
    fetchProviderModels: () => null as never,
    renameProviderEndpoint: () => null as never,
    upsertProviderEndpoint: () => null as never,
  }), []);
  const actions = useProviderConnectionActions({
    state: state ?? emptyState,
    catalogs: systemConfig?.providerModelCatalogs ?? {},
    errors: systemConfig?.providerModelErrors ?? {},
    loadingProviderIds: systemConfig?.providerModelLoadingIds ?? {},
    operations: systemConfig?.providerEndpointOperations ?? {},
    selectedProviderId,
    setSelectedProviderId,
    onDeleteProviderEndpoint: systemConfig?.deleteProviderEndpoint ?? noopCommands.deleteProviderEndpoint,
    onFetchProviderModels: systemConfig?.fetchProviderModels ?? noopCommands.fetchProviderModels,
    onRenameProviderEndpoint: systemConfig?.renameProviderEndpoint ?? noopCommands.renameProviderEndpoint,
    onUpsertProviderEndpoint: systemConfig?.upsertProviderEndpoint ?? noopCommands.upsertProviderEndpoint,
  });

  if (!systemConfig) return <SettingsWorkspaceState>正在连接主配置服务</SettingsWorkspaceState>;
  if (!snapshot || !modelSection || !state) return <SettingsWorkspaceState>主配置连接后会加载模型服务</SettingsWorkspaceState>;

  const selectedProvider = state.providers.find((provider) => provider.Id === (selectedProviderId ?? state.providers[0]?.Id)) ?? null;
  const endpointOptions = readFieldOptions(findItemField(modelField, "Endpoint"));
  const modelSurface = (
    <ProviderModelManagementSurface
      disabled={actions.saving}
      operations={systemConfig.providerModelOperations}
      onFetchProviderModels={systemConfig.fetchProviderModels}
      onRequestRemoveModel={setModelPendingRemoval}
      onSetDefaultModel={systemConfig.setDefaultProviderModel}
      onUpsertProviderModel={systemConfig.upsertProviderModel}
      state={state}
      catalogs={systemConfig.providerModelCatalogs}
      errors={systemConfig.providerModelErrors}
      loadingProviderIds={systemConfig.providerModelLoadingIds}
      draft={EMPTY_DRAFT}
      section={modelSection}
      modelField={modelField}
      endpointOptions={endpointOptions}
        initialSelectedProviderId={selectedProvider?.Id}
        initialManualAdd={false}
        showProviderList={false}
        showFetchAction={false}
        fetchEndpoint={actions.connectionDraft ? toProviderEndpointInput(actions.connectionDraft) : undefined}
        openCatalogSignal={openCatalogSignal}
    />
  );
  const providerList = (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-ink-200/70 bg-[var(--theme-config-list-bg)] shadow-sm">
      <ProviderConnectionList
        providers={state.providers}
        catalogs={systemConfig.providerModelCatalogs}
        errors={systemConfig.providerModelErrors}
        loadingProviderIds={systemConfig.providerModelLoadingIds}
        selectedProviderId={actions.acceptedProvider?.Id ?? null}
        disabled={actions.saving}
        onRequestAdd={() => actions.setShowAddDialog(true)}
        onSelect={(provider) => {
          const selected = actions.selectProvider(provider);
          if (selected && layout === "mobile") setMobileDetailOpen(true);
        }}
        onRename={actions.setRenameTarget}
        onDelete={setProviderPendingRemoval}
      />
    </section>
  );
  const detail = (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50 shadow-sm">
      <div className="min-h-[320px] flex-1 overflow-hidden">
        <ProviderConnectionEditor
          acceptedProvider={actions.acceptedProvider}
          catalog={actions.selectedProviderCatalog}
          dirty={actions.dirty}
          draftProvider={actions.connectionDraft}
          error={actions.selectedProviderError}
          localError={actions.localError}
          loading={actions.selectedProviderLoading}
          operation={actions.providerOperation}
          providerModelCount={actions.selectedProviderModelCount}
          providerIndex={actions.selectedProviderIndex}
          disabled={actions.saving}
          onCancel={actions.resetDraft}
          onChange={actions.updateDraftProvider}
          onConfirm={actions.confirmDraft}
          onFetch={(force) => {
            setOpenCatalogSignal((value) => value + 1);
            actions.fetchSelectedProvider(force);
          }}
          onDelete={actions.acceptedProvider ? () => setProviderPendingRemoval(actions.acceptedProvider!) : undefined}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden border-t border-ink-200/70">{modelSurface}</div>
    </section>
  );

  const content = layout === "mobile" ? (
    <div className="relative h-full min-h-0 overflow-hidden bg-paper-50 p-2">
      {mobileDetailOpen ? (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50">
          <button
            type="button"
            className="flex shrink-0 items-center gap-1.5 border-b border-ink-200/70 px-3 py-2.5 text-left text-[12.5px] font-medium text-ink-600 transition hover:text-ink-900"
            onClick={() => setMobileDetailOpen(false)}
          >
            返回供应商列表
          </button>
          <div className="min-h-0 flex-1 overflow-hidden">{detail}</div>
        </div>
      ) : providerList}
    </div>
  ) : (
    <div className={cn("grid h-full min-h-0 gap-3 bg-paper-50 p-3", layout === "tablet" ? "grid-cols-[280px_minmax(0,1fr)]" : "grid-cols-[260px_minmax(0,1fr)]")}>
      {providerList}
      {detail}
    </div>
  );

  return (
    <>
      {content}
      <AddProviderDialog open={actions.showAddDialog} providers={state.providers} onOpenChange={actions.setShowAddDialog} onAdd={actions.addProvider} />
      <RenameProviderDialog provider={actions.renameTarget} providers={state.providers} onOpenChange={(open) => !open && actions.setRenameTarget(null)} onRename={actions.renameProvider} />
      <ProviderModelLifecycleDialogs
        candidateModels={defaultModelCandidates}
        defaultModelId={currentDefaultModelId}
        disabled={actions.saving}
        modelToRemove={modelPendingRemoval}
        models={state.models}
        providerToRemove={providerPendingRemoval}
        onCloseModelRemoval={() => setModelPendingRemoval(null)}
        onCloseProviderRemoval={() => setProviderPendingRemoval(null)}
        onConfirmModelRemoval={(input) => Boolean(systemConfig.deleteProviderModel(input))}
        onConfirmProviderRemoval={(input) => {
          const provider = state.providers.find((entry) => entry.Id === input.providerId);
          return provider ? actions.deleteProvider(provider, input) : false;
        }}
      />
    </>
  );
}
