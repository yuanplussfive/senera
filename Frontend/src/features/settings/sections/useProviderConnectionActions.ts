import { useEffect, useRef, useState } from "react";
import type { SettingsConfigCommands } from "../SettingsContracts";
import type { SocketStatus } from "../../../api/useAgentSocket";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { normalizeProviderEndpointDraft } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import type { ModelServiceState } from "./modelServiceState";
import { buildProviderEndpointMutationInput, sameProviderEndpoint } from "./providerConnectionState";
import { useProviderConnectionDraftQueue } from "./useProviderConnectionDraftQueue";

interface PendingProviderRename {
  providerId: string;
  nextProviderId: string;
  requestId: string;
}

interface PendingProviderDraft {
  draft: ProviderEndpointDraft;
  requestId: string;
}

interface PendingProviderDraftConfirmation {
  providerId: string;
  requestId: string;
}

export interface UseProviderConnectionActionsInput {
  catalogs: SettingsConfigCommands["providerModelCatalogs"];
  errors: SettingsConfigCommands["providerModelErrors"];
  loadingProviderIds: SettingsConfigCommands["providerModelLoadingIds"];
  operations: SettingsConfigCommands["providerEndpointOperations"];
  onDeleteProviderEndpoint: SettingsConfigCommands["deleteProviderEndpoint"];
  onFetchProviderModels: SettingsConfigCommands["fetchProviderModels"];
  onRenameProviderEndpoint: SettingsConfigCommands["renameProviderEndpoint"];
  onUpsertProviderEndpoint: SettingsConfigCommands["upsertProviderEndpoint"];
  onRefreshConfig?: () => void;
  socketStatus?: SocketStatus;
  state: ModelServiceState;
  selectedProviderId: string | null;
  setSelectedProviderId: (id: string | null) => void;
}

export interface ProviderConnectionActions {
  acceptedProvider: ProviderEndpointDraft | null;
  selectedProviderIndex: number;
  selectedProviderModelCount: number;
  providerOperation: SettingsConfigCommands["providerEndpointOperations"][string] | undefined;
  selectedProviderCatalog: SettingsConfigCommands["providerModelCatalogs"][string] | undefined;
  selectedProviderError: SettingsConfigCommands["providerModelErrors"][string] | undefined;
  selectedProviderLoading: boolean;
  connectionDraft: ProviderEndpointDraft | null;
  dirty: boolean;
  saving: boolean;
  localError: string | null;
  showAddDialog: boolean;
  setShowAddDialog: (open: boolean) => void;
  dismissAddDialog: () => void;
  addPending: boolean;
  addError: string | null;
  renameTarget: ProviderEndpointDraft | null;
  setRenameTarget: (provider: ProviderEndpointDraft | null) => void;
  renameError: string | null;
  selectProvider: (provider: ProviderEndpointDraft) => boolean;
  commitAndSelectProvider: (provider: ProviderEndpointDraft) => boolean;
  discardAndSelectProvider: (provider: ProviderEndpointDraft) => void;
  updateDraftProvider: (patch: Partial<ProviderEndpointDraft>) => void;
  resetDraft: () => void;
  confirmDraft: (patch?: Partial<ProviderEndpointDraft>) => void;
  addProvider: (provider: ProviderEndpointDraft) => void;
  renameProvider: (providerId: string, nextProviderId: string) => void;
  deleteProvider: (
    provider: ProviderEndpointDraft,
    options?: Parameters<SettingsConfigCommands["deleteProviderEndpoint"]>[1],
  ) => boolean;
  fetchSelectedProvider: (force?: boolean) => void;
}

/**
 * Shared provider-connection editing logic for the ModelServiceSection list/detail
 * layouts, keeping confirm/cancel/fetch/add/rename/delete behavior on one
 * externally-owned selectedProviderId across desktop and narrow screens.
 */
export function useProviderConnectionActions({
  catalogs,
  errors,
  loadingProviderIds,
  operations,
  onDeleteProviderEndpoint,
  onFetchProviderModels,
  onRenameProviderEndpoint,
  onUpsertProviderEndpoint,
  onRefreshConfig = noop,
  socketStatus = "open",
  state,
  selectedProviderId,
  setSelectedProviderId,
}: UseProviderConnectionActionsInput): ProviderConnectionActions {
  const [draftProvider, setDraftProvider] = useState<ProviderEndpointDraft | null>(state.providers[0] ?? null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [renameTarget, setRenameTargetState] = useState<ProviderEndpointDraft | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [pendingProviderDraft, setPendingProviderDraft] = useState<PendingProviderDraft | null>(null);
  const [pendingProviderDraftConfirmation, setPendingProviderDraftConfirmation] =
    useState<PendingProviderDraftConfirmation | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingProviderRename | null>(null);

  // `readModelServiceState` intentionally materializes fresh provider objects. Depend on
  // their normalized values rather than object identity so effects do not reset a local
  // draft on every render.
  const providerListKey = JSON.stringify(state.providers.map(normalizeProviderEndpointDraft));
  const pendingRenameProviderId = pendingRename?.providerId;
  const pendingRenameNextProviderId = pendingRename?.nextProviderId;
  const pendingRenameOperation = pendingRenameProviderId ? operations[pendingRenameProviderId] : undefined;
  const pendingRenameStatus =
    pendingRenameOperation && pendingRenameOperation.commandId === pendingRename?.requestId
      ? pendingRenameOperation.status
      : undefined;
  const pendingProviderDraftId = pendingProviderDraft?.draft.Id;
  const pendingAddOperation = pendingProviderDraftId ? operations[pendingProviderDraftId] : undefined;
  const pendingAddStatus =
    pendingAddOperation && pendingAddOperation.commandId === pendingProviderDraft?.requestId
      ? pendingAddOperation.status
      : undefined;
  const pendingProviderDraftConfirmationStatus =
    pendingProviderDraftConfirmation &&
    operations[pendingProviderDraftConfirmation.providerId]?.commandId === pendingProviderDraftConfirmation.requestId
      ? operations[pendingProviderDraftConfirmation.providerId]?.status
      : undefined;
  const providersRef = useRef(state.providers);
  providersRef.current = state.providers;
  const draftQueue = useProviderConnectionDraftQueue({
    operations,
    onPendingDraftSave: (providerId, requestId) => setPendingProviderDraftConfirmation({ providerId, requestId }),
    onRefreshConfig,
    onUpsertProviderEndpoint,
    pendingProviderDraftId,
    providers: state.providers,
    socketStatus,
  });

  useEffect(() => {
    const providers = providersRef.current;
    if (pendingRenameProviderId && pendingRenameNextProviderId) {
      const renamedProvider = providers.find((provider) => provider.Id === pendingRenameNextProviderId);
      if (renamedProvider) {
        // Follow the rename only while the user is still on the old id — a
        // click on another provider mid-rename must not be overridden.
        if (
          selectedProviderId === pendingRenameProviderId ||
          !providers.some((provider) => provider.Id === selectedProviderId)
        ) {
          setSelectedProviderId(renamedProvider.Id);
        }
        setPendingRename(null);
        return;
      }

      if (pendingRenameStatus === "error") {
        setPendingRename(null);
        return;
      }

      // Rename request still pending: keep whatever valid selection the user
      // has; only restore the renaming provider when nothing else is selected.
      if (providers.some((provider) => provider.Id === pendingRenameProviderId)) {
        if (!providers.some((provider) => provider.Id === selectedProviderId)) {
          setSelectedProviderId(pendingRenameProviderId);
        }
        return;
      }
      return;
    }

    if (pendingProviderDraftId === selectedProviderId && pendingAddStatus !== "error") {
      if (!providers.some((provider) => provider.Id === pendingProviderDraftId)) {
        return;
      }
    }

    const nextProviderId = providers.some((provider) => provider.Id === selectedProviderId)
      ? selectedProviderId
      : (providers[0]?.Id ?? null);
    if (nextProviderId !== selectedProviderId) {
      setSelectedProviderId(nextProviderId);
    }
  }, [
    pendingAddStatus,
    pendingProviderDraftId,
    pendingRenameNextProviderId,
    pendingRenameProviderId,
    pendingRenameStatus,
    providerListKey,
    selectedProviderId,
    setSelectedProviderId,
  ]);

  const acceptedProvider = selectedProviderId
    ? (state.providers.find((provider) => provider.Id === selectedProviderId) ??
      (pendingRenameProviderId === selectedProviderId ? draftProvider : null))
    : (state.providers[0] ?? null);
  const selectedEntry = acceptedProvider ? draftQueue.read(acceptedProvider) : undefined;
  const selectedProviderIndex = acceptedProvider
    ? state.providers.findIndex((provider) => provider.Id === acceptedProvider.Id)
    : -1;
  const selectedProviderModelCount = acceptedProvider
    ? state.models.filter((model) => model.ProviderId === acceptedProvider.Id).length
    : 0;
  const providerOperation = acceptedProvider?.Id ? operations[acceptedProvider.Id] : undefined;
  const selectedProviderCatalog = acceptedProvider?.Id ? catalogs[acceptedProvider.Id] : undefined;
  const selectedProviderError = acceptedProvider?.Id ? errors[acceptedProvider.Id] : undefined;
  const selectedProviderLoading = acceptedProvider?.Id ? Boolean(loadingProviderIds[acceptedProvider.Id]) : false;
  const connectionDraft =
    selectedEntry?.draft ?? (acceptedProvider ? normalizeProviderEndpointDraft(acceptedProvider) : null);
  const dirty = Boolean(selectedEntry && !sameProviderEndpoint(selectedEntry.synced, selectedEntry.draft));
  const localError = selectedEntry?.error ?? null;
  const providerSaveOperation =
    selectedEntry?.active &&
    providerOperation?.kind === "provider.endpoint.upsert" &&
    providerOperation.commandId === selectedEntry.active.requestId
      ? providerOperation
      : undefined;
  const saving = providerSaveOperation?.status === "pending" || pendingProviderDraftConfirmation !== null;

  useEffect(() => {
    if (pendingRenameProviderId) {
      return;
    }

    if (pendingProviderDraftId === selectedProviderId) {
      if (!acceptedProvider || acceptedProvider.Id !== selectedProviderId) {
        // A failed add keeps its pending draft so the dialog can surface the
        // error and offer Retry; dismissAddDialog() clears it when the user
        // gives up. Clearing here would blank the error after a single frame.
        return;
      }

      if (!pendingProviderDraftConfirmation) {
        return;
      }
      if (pendingProviderDraftConfirmationStatus === "error") {
        setPendingProviderDraftConfirmation(null);
        return;
      }
      if (pendingProviderDraftConfirmationStatus !== "success") {
        return;
      }
      setPendingProviderDraft(null);
      setPendingProviderDraftConfirmation(null);
    }
  }, [
    acceptedProvider,
    pendingProviderDraftConfirmation,
    pendingProviderDraftConfirmationStatus,
    pendingProviderDraftId,
    pendingRenameProviderId,
    selectedProviderId,
  ]);

  const selectProvider = (provider: ProviderEndpointDraft): boolean => {
    setSelectedProviderId(provider.Id);
    return true;
  };

  const commitAndSelectProvider = (provider: ProviderEndpointDraft): boolean => {
    if (provider.Id === acceptedProvider?.Id) return true;
    const currentEntry = acceptedProvider ? draftQueue.read(acceptedProvider) : undefined;
    const currentDirty = Boolean(currentEntry && !sameProviderEndpoint(currentEntry.synced, currentEntry.draft));
    // Blocked edits (save error / offline) cannot be committed in passing;
    // report failure so the caller can ask the user to keep or discard them.
    if (currentDirty && currentEntry && (currentEntry.error || currentEntry.autoSaveBlocked)) {
      return false;
    }
    if (currentDirty && currentEntry) {
      const mutation = buildProviderEndpointMutationInput(currentEntry.draft, currentEntry.synced);
      if (!mutation.ok || socketStatus !== "open") {
        confirmDraft();
        return false;
      }
      confirmDraft();
    }
    setSelectedProviderId(provider.Id);
    setDraftProvider(provider);
    return true;
  };

  const discardAndSelectProvider = (provider: ProviderEndpointDraft): void => {
    if (acceptedProvider) draftQueue.discard(acceptedProvider);
    setSelectedProviderId(provider.Id);
    setDraftProvider(provider);
    setPendingProviderDraft(null);
    setPendingProviderDraftConfirmation(null);
  };

  const updateDraftProvider = (patch: Partial<ProviderEndpointDraft>): void => {
    if (!acceptedProvider || !connectionDraft) return;
    draftQueue.update(acceptedProvider, connectionDraft, patch);
  };

  const resetDraft = (): void => {
    if (!acceptedProvider) return;
    draftQueue.reset(acceptedProvider);
    setPendingProviderDraft(null);
    setPendingProviderDraftConfirmation(null);
  };

  const confirmDraft = (patch?: Partial<ProviderEndpointDraft>): void => {
    draftQueue.confirm(acceptedProvider, connectionDraft, patch);
  };

  const addProvider = (provider: ProviderEndpointDraft): void => {
    // Send the full preset draft (BaseUrl/ApiVersion/Headers included) so the
    // server-side endpoint matches what the editor shows. Registering the same
    // draft keeps the queue baseline honest: the success snapshot matches it,
    // so auto-save stays enabled for the new provider.
    const mutation = buildProviderEndpointMutationInput(provider);
    if (!mutation.ok) {
      if (acceptedProvider) draftQueue.setError(acceptedProvider, mutation.message);
      return;
    }
    const requestId = onUpsertProviderEndpoint(mutation.endpoint);
    if (requestId) {
      const nextDraft = normalizeProviderEndpointDraft({
        ...provider,
        Id: mutation.providerId,
      });
      draftQueue.registerActive(nextDraft, mutation.providerId, requestId);
      setSelectedProviderId(mutation.providerId);
      setDraftProvider(nextDraft);
      setPendingProviderDraft({ draft: nextDraft, requestId });
      // The dialog stays open until the command resolves — closing on success
      // (effect below) keeps a failed add from discarding the typed identity
      // with nothing but a toast.
    }
  };

  useEffect(() => {
    if (pendingAddStatus !== "success") return;
    setShowAddDialog(false);
    setPendingProviderDraft(null);
    setPendingProviderDraftConfirmation(null);
  }, [pendingAddStatus]);

  const dismissAddDialog = (): void => {
    // Abandon an in-flight or failed add: drop the pending draft so the editor
    // does not stay pointed at a provider the server never accepted, and so a
    // stale error does not resurface when the dialog reopens.
    setShowAddDialog(false);
    setPendingProviderDraft(null);
    setPendingProviderDraftConfirmation(null);
  };

  const addPending = pendingAddStatus === "pending";
  const addError = pendingAddStatus === "error" ? (pendingAddOperation?.message ?? null) : null;

  const setRenameTarget = (provider: ProviderEndpointDraft | null): void => {
    setRenameTargetState(provider);
    setRenameError(null);
  };

  const renameProvider = (providerId: string, nextProviderId: string): void => {
    if (providerId === selectedProviderId && dirty) {
      // Surface the conflict inside the rename dialog — the connection
      // editor's error area sits underneath the dialog overlay.
      setRenameError(frontendMessage("settings.provider.pendingDraftError"));
      return;
    }
    const requestId = onRenameProviderEndpoint(providerId, nextProviderId);
    if (requestId) {
      if (providerId === selectedProviderId) {
        setPendingRename({ providerId, nextProviderId, requestId });
      }
      setRenameTarget(null);
    }
  };

  const deleteProvider = (
    provider: ProviderEndpointDraft,
    options?: Parameters<SettingsConfigCommands["deleteProviderEndpoint"]>[1],
  ): boolean => {
    const requestId = onDeleteProviderEndpoint(provider.Id, options);
    if (!requestId) return false;

    const nextProvider = state.providers.find((entry) => entry.Id !== provider.Id) ?? null;
    setSelectedProviderId(nextProvider?.Id ?? null);
    setDraftProvider(nextProvider);
    draftQueue.remove(provider.Id);
    if (pendingProviderDraftId === provider.Id) {
      setPendingProviderDraft(null);
      setPendingProviderDraftConfirmation(null);
    }
    return true;
  };

  const fetchSelectedProvider = (force?: boolean): void => {
    if (!connectionDraft?.Id) return;
    const mutation = buildProviderEndpointMutationInput(connectionDraft);
    if (!mutation.ok) {
      if (acceptedProvider) draftQueue.setError(acceptedProvider, mutation.message);
      return;
    }
    onFetchProviderModels(mutation.providerId, force, mutation.endpoint);
  };

  return {
    acceptedProvider,
    selectedProviderIndex,
    selectedProviderModelCount,
    providerOperation: providerSaveOperation,
    selectedProviderCatalog,
    selectedProviderError,
    selectedProviderLoading,
    connectionDraft,
    dirty,
    saving,
    localError,
    showAddDialog,
    setShowAddDialog,
    dismissAddDialog,
    addPending,
    addError,
    renameTarget,
    setRenameTarget,
    renameError,
    selectProvider,
    commitAndSelectProvider,
    discardAndSelectProvider,
    updateDraftProvider,
    resetDraft,
    confirmDraft,
    addProvider,
    renameProvider,
    deleteProvider,
    fetchSelectedProvider,
  };
}

function noop(): void {}
