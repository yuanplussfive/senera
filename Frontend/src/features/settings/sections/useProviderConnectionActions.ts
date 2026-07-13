import { useEffect, useRef, useState } from "react";
import type { SettingsConfigCommands } from "../SettingsContracts";
import { normalizeProviderEndpointDraft } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import type { ModelServiceState } from "./modelServiceState";
import {
  applyProviderConnectionDraftPatch,
  buildProviderEndpointMutationInput,
  readProviderConnectionDraftState,
  resetProviderConnectionDraft,
  providerIdentitySnapshot,
  sameProviderEndpoint,
} from "./providerConnectionState";

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
  renameTarget: ProviderEndpointDraft | null;
  setRenameTarget: (provider: ProviderEndpointDraft | null) => void;
  selectProvider: (provider: ProviderEndpointDraft) => boolean;
  updateDraftProvider: (patch: Partial<ProviderEndpointDraft>) => void;
  resetDraft: () => void;
  confirmDraft: () => void;
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
  state,
  selectedProviderId,
  setSelectedProviderId,
}: UseProviderConnectionActionsInput): ProviderConnectionActions {
  const [draftProvider, setDraftProvider] = useState<ProviderEndpointDraft | null>(state.providers[0] ?? null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProviderEndpointDraft | null>(null);
  const [pendingProviderDraft, setPendingProviderDraft] = useState<PendingProviderDraft | null>(null);
  const [pendingProviderDraftConfirmation, setPendingProviderDraftConfirmation] = useState<PendingProviderDraftConfirmation | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingProviderRename | null>(null);

  // `readModelServiceState` intentionally materializes fresh provider objects. Depend on
  // their normalized values rather than object identity so effects do not reset a local
  // draft on every render.
  const providerListKey = JSON.stringify(state.providers.map(normalizeProviderEndpointDraft));
  const pendingRenameProviderId = pendingRename?.providerId;
  const pendingRenameNextProviderId = pendingRename?.nextProviderId;
  const pendingRenameOperation = pendingRenameProviderId
    ? operations[pendingRenameProviderId]
    : undefined;
  const pendingRenameStatus = pendingRenameOperation && pendingRenameOperation.requestId === pendingRename?.requestId
    ? pendingRenameOperation.status
    : undefined;
  const pendingProviderDraftId = pendingProviderDraft?.draft.Id;
  const pendingAddOperation = pendingProviderDraftId
    ? operations[pendingProviderDraftId]
    : undefined;
  const pendingAddStatus = pendingAddOperation && pendingAddOperation.requestId === pendingProviderDraft?.requestId
    ? pendingAddOperation.status
    : undefined;
  const pendingProviderDraftConfirmationStatus = pendingProviderDraftConfirmation
    && operations[pendingProviderDraftConfirmation.providerId]?.requestId === pendingProviderDraftConfirmation.requestId
    ? operations[pendingProviderDraftConfirmation.providerId]?.status
    : undefined;
  const providersRef = useRef(state.providers);
  providersRef.current = state.providers;

  useEffect(() => {
    const providers = providersRef.current;
    if (pendingRenameProviderId && pendingRenameNextProviderId) {
      const renamedProvider = providers.find((provider) => provider.Id === pendingRenameNextProviderId);
      if (renamedProvider) {
        setSelectedProviderId(renamedProvider.Id);
        setPendingRename(null);
        return;
      }

      if (pendingRenameStatus === "error") {
        setPendingRename(null);
        return;
      }

      // Keep the old selection while a rename request is pending. A snapshot that
      // replaces the old ID with the new one is handled above on the next render.
      if (providers.some((provider) => provider.Id === pendingRenameProviderId)) {
        if (selectedProviderId !== pendingRenameProviderId) {
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
      : providers[0]?.Id ?? null;
    if (nextProviderId !== selectedProviderId) {
      setSelectedProviderId(nextProviderId);
    }
  }, [pendingAddStatus, pendingProviderDraftId, pendingRenameNextProviderId, pendingRenameProviderId, pendingRenameStatus, providerListKey, selectedProviderId, setSelectedProviderId]);

  const acceptedProvider = selectedProviderId
    ? state.providers.find((provider) => provider.Id === selectedProviderId)
      ?? (pendingRenameProviderId === selectedProviderId ? draftProvider : null)
    : state.providers[0] ?? null;
  const acceptedProviderKey = acceptedProvider
    ? JSON.stringify(normalizeProviderEndpointDraft(acceptedProvider))
    : "";
  const acceptedProviderRef = useRef(acceptedProvider);
  acceptedProviderRef.current = acceptedProvider;
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
  const { connectionDraft, dirty } = readProviderConnectionDraftState({
    acceptedProvider,
    draftProvider,
  });
  const saving = providerOperation?.status === "pending" || pendingProviderDraftConfirmation !== null;

  useEffect(() => {
    if (pendingRenameProviderId) {
      return;
    }

    const currentAcceptedProvider = acceptedProviderRef.current;
    if (pendingProviderDraftId === selectedProviderId) {
      if (!currentAcceptedProvider || currentAcceptedProvider.Id !== selectedProviderId) {
        if (pendingAddStatus === "error") {
          setPendingProviderDraft(null);
          setPendingProviderDraftConfirmation(null);
        }
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

    const nextProvider = acceptedProviderKey ? normalizeProviderEndpointDraft(currentAcceptedProvider!) : null;
    setDraftProvider((current) => sameNullableProvider(current, nextProvider) ? current : nextProvider);
    setLocalError((current) => current ? null : current);
  }, [acceptedProviderKey, pendingAddStatus, pendingProviderDraftConfirmation, pendingProviderDraftConfirmationStatus, pendingProviderDraftId, pendingRenameProviderId, selectedProviderId]);

  const selectProvider = (provider: ProviderEndpointDraft): boolean => {
    if (dirty) {
      setLocalError("当前连接表单有未确认修改，请先确认或取消。");
      return false;
    }
    setSelectedProviderId(provider.Id);
    return true;
  };

  const updateDraftProvider = (patch: Partial<ProviderEndpointDraft>): void => {
    setDraftProvider((current) => applyProviderConnectionDraftPatch({
      acceptedProvider,
      currentDraft: current,
      patch,
    }));
    setLocalError(null);
  };

  const resetDraft = (): void => {
    setDraftProvider(resetProviderConnectionDraft(acceptedProvider));
    setPendingProviderDraft(null);
    setPendingProviderDraftConfirmation(null);
    setLocalError(null);
  };

  const confirmDraft = (): void => {
    const mutation = buildProviderEndpointMutationInput(connectionDraft);
    if (!mutation.ok) {
      setLocalError(mutation.message);
      return;
    }
    const requestId = onUpsertProviderEndpoint(mutation.endpoint);
    if (requestId && pendingProviderDraftId === mutation.providerId) {
      setPendingProviderDraftConfirmation({ providerId: mutation.providerId, requestId });
    }
  };

  const addProvider = (provider: ProviderEndpointDraft): void => {
    const mutation = buildProviderEndpointMutationInput(providerIdentitySnapshot(provider));
    if (!mutation.ok) {
      setLocalError(mutation.message);
      return;
    }
    const requestId = onUpsertProviderEndpoint(mutation.endpoint);
    if (requestId) {
      const nextDraft = normalizeProviderEndpointDraft({
        ...provider,
        ...providerIdentitySnapshot(provider),
        Id: mutation.providerId,
      });
      setSelectedProviderId(mutation.providerId);
      setDraftProvider(nextDraft);
      setPendingProviderDraft({ draft: nextDraft, requestId });
      setShowAddDialog(false);
      setLocalError(null);
    }
  };

  const renameProvider = (providerId: string, nextProviderId: string): void => {
    if (providerId === selectedProviderId && dirty) {
      setLocalError("当前连接表单有未确认修改，请先确认或取消。");
      return;
    }
    const requestId = onRenameProviderEndpoint(providerId, nextProviderId);
    if (requestId) {
      if (providerId === selectedProviderId) {
        setPendingRename({ providerId, nextProviderId, requestId });
      }
      setRenameTarget(null);
      setLocalError(null);
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
    if (pendingProviderDraftId === provider.Id) {
      setPendingProviderDraft(null);
      setPendingProviderDraftConfirmation(null);
    }
    setLocalError(null);
    return true;
  };

  const fetchSelectedProvider = (force?: boolean): void => {
    if (!connectionDraft?.Id) return;
    const mutation = buildProviderEndpointMutationInput(connectionDraft);
    if (!mutation.ok) {
      setLocalError(mutation.message);
      return;
    }
    onFetchProviderModels(
      mutation.providerId,
      force,
      mutation.endpoint,
    );
  };

  return {
    acceptedProvider,
    selectedProviderIndex,
    selectedProviderModelCount,
    providerOperation,
    selectedProviderCatalog,
    selectedProviderError,
    selectedProviderLoading,
    connectionDraft,
    dirty,
    saving,
    localError,
    showAddDialog,
    setShowAddDialog,
    renameTarget,
    setRenameTarget,
    selectProvider,
    updateDraftProvider,
    resetDraft,
    confirmDraft,
    addProvider,
    renameProvider,
    deleteProvider,
    fetchSelectedProvider,
  };
}

function sameNullableProvider(
  left: ProviderEndpointDraft | null,
  right: ProviderEndpointDraft | null,
): boolean {
  if (left === null || right === null) return left === right;
  return sameProviderEndpoint(left, right);
}
