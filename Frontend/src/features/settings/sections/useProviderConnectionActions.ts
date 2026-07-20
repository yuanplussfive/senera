import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsConfigCommands } from "../SettingsContracts";
import type { SocketStatus } from "../../../api/useAgentSocket";
import { isConfigConflict } from "../../../app/configMutationFailure";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { normalizeProviderEndpointDraft } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import type { ModelServiceState } from "./modelServiceState";
import {
  applyProviderConnectionDraftPatch,
  buildProviderEndpointMutationInput,
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

interface ActiveProviderSave {
  draft: ProviderEndpointDraft;
  providerId: string;
  requestId: string;
}

interface ProviderDraftEntry {
  synced: ProviderEndpointDraft;
  draft: ProviderEndpointDraft;
  active?: ActiveProviderSave;
  queuedDraft?: ProviderEndpointDraft;
  awaitingSnapshot?: ProviderEndpointDraft;
  error?: string;
  autoSaveBlocked: boolean;
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
  renameTarget: ProviderEndpointDraft | null;
  setRenameTarget: (provider: ProviderEndpointDraft | null) => void;
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
  onRefreshConfig = () => undefined,
  socketStatus = "open",
  state,
  selectedProviderId,
  setSelectedProviderId,
}: UseProviderConnectionActionsInput): ProviderConnectionActions {
  const [, bumpDraftVersion] = useState(0);
  const [draftProvider, setDraftProvider] = useState<ProviderEndpointDraft | null>(state.providers[0] ?? null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProviderEndpointDraft | null>(null);
  const [pendingProviderDraft, setPendingProviderDraft] = useState<PendingProviderDraft | null>(null);
  const [pendingProviderDraftConfirmation, setPendingProviderDraftConfirmation] =
    useState<PendingProviderDraftConfirmation | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingProviderRename | null>(null);
  const providerEntriesRef = useRef<Map<string, ProviderDraftEntry>>(new Map());
  const providerSaveTimersRef = useRef<Map<string, number>>(new Map());

  // `readModelServiceState` intentionally materializes fresh provider objects. Depend on
  // their normalized values rather than object identity so effects do not reset a local
  // draft on every render.
  const providerListKey = JSON.stringify(state.providers.map(normalizeProviderEndpointDraft));
  const pendingRenameProviderId = pendingRename?.providerId;
  const pendingRenameNextProviderId = pendingRename?.nextProviderId;
  const pendingRenameOperation = pendingRenameProviderId ? operations[pendingRenameProviderId] : undefined;
  const pendingRenameStatus =
    pendingRenameOperation && pendingRenameOperation.requestId === pendingRename?.requestId
      ? pendingRenameOperation.status
      : undefined;
  const pendingProviderDraftId = pendingProviderDraft?.draft.Id;
  const pendingAddOperation = pendingProviderDraftId ? operations[pendingProviderDraftId] : undefined;
  const pendingAddStatus =
    pendingAddOperation && pendingAddOperation.requestId === pendingProviderDraft?.requestId
      ? pendingAddOperation.status
      : undefined;
  const pendingProviderDraftConfirmationStatus =
    pendingProviderDraftConfirmation &&
    operations[pendingProviderDraftConfirmation.providerId]?.requestId === pendingProviderDraftConfirmation.requestId
      ? operations[pendingProviderDraftConfirmation.providerId]?.status
      : undefined;
  const providersRef = useRef(state.providers);
  providersRef.current = state.providers;

  const ensureProviderEntry = (provider: ProviderEndpointDraft): ProviderDraftEntry => {
    const normalized = normalizeProviderEndpointDraft(provider);
    const current = providerEntriesRef.current.get(normalized.Id);
    if (current) return current;
    const entry: ProviderDraftEntry = {
      synced: normalized,
      draft: normalized,
      autoSaveBlocked: false,
    };
    providerEntriesRef.current.set(normalized.Id, entry);
    return entry;
  };

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

  useEffect(() => {
    let changed = false;
    const providers = providersRef.current;
    for (const provider of providers) {
      const normalized = normalizeProviderEndpointDraft(provider);
      const current = providerEntriesRef.current.get(provider.Id);
      if (!current) {
        providerEntriesRef.current.set(provider.Id, {
          synced: normalized,
          draft: normalized,
          autoSaveBlocked: false,
        });
        changed = true;
        continue;
      }
      if (sameProviderEndpoint(current.synced, normalized)) continue;
      if (current.awaitingSnapshot && sameProviderEndpoint(current.awaitingSnapshot, normalized)) {
        providerEntriesRef.current.set(provider.Id, {
          ...current,
          synced: normalized,
          awaitingSnapshot: undefined,
          draft: sameProviderEndpoint(current.draft, current.synced) ? normalized : current.draft,
        });
        changed = true;
        continue;
      }
      if (current.awaitingSnapshot) continue;
      if (current.active) continue;
      if (!current.active && !current.queuedDraft && sameProviderEndpoint(current.synced, current.draft)) {
        providerEntriesRef.current.set(provider.Id, {
          ...current,
          synced: normalized,
          draft: normalized,
          error: undefined,
          autoSaveBlocked: false,
        });
        changed = true;
        continue;
      }
      providerEntriesRef.current.set(provider.Id, {
        ...current,
        synced: normalized,
        draft: rebaseProviderEndpoint(current.synced, current.draft, normalized),
      });
      changed = true;
    }
    const providerIds = new Set(providers.map((provider) => provider.Id));
    for (const [providerId, entry] of providerEntriesRef.current) {
      if (providerIds.has(providerId) || entry.active || entry.queuedDraft) continue;
      providerEntriesRef.current.delete(providerId);
      const timer = providerSaveTimersRef.current.get(providerId);
      if (timer !== undefined) window.clearTimeout(timer);
      providerSaveTimersRef.current.delete(providerId);
      changed = true;
    }
    if (changed) bumpDraftVersion((version) => version + 1);
  }, [providerListKey]);

  const acceptedProvider = selectedProviderId
    ? (state.providers.find((provider) => provider.Id === selectedProviderId) ??
      (pendingRenameProviderId === selectedProviderId ? draftProvider : null))
    : (state.providers[0] ?? null);
  const selectedEntry = acceptedProvider ? ensureProviderEntry(acceptedProvider) : undefined;
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
  const saving = providerOperation?.status === "pending" || pendingProviderDraftConfirmation !== null;

  const sendProviderDraft = useCallback(
    (nextDraft: ProviderEndpointDraft, manual = false): void => {
      const providerId = nextDraft.Id;
      const entry = providerEntriesRef.current.get(providerId) ?? ensureProviderEntry(nextDraft);
      if (entry.active) {
        providerEntriesRef.current.set(providerId, { ...entry, queuedDraft: nextDraft });
        bumpDraftVersion((version) => version + 1);
        return;
      }
      if (!manual && (entry.autoSaveBlocked || entry.awaitingSnapshot)) return;
      if (socketStatus !== "open") {
        providerEntriesRef.current.set(providerId, {
          ...entry,
          error: frontendMessage("settings.draft.connectionInterrupted"),
          autoSaveBlocked: true,
        });
        bumpDraftVersion((version) => version + 1);
        return;
      }
      const mutation = buildProviderEndpointMutationInput(nextDraft);
      if (!mutation.ok) {
        providerEntriesRef.current.set(providerId, { ...entry, error: mutation.message });
        bumpDraftVersion((version) => version + 1);
        return;
      }
      const requestId = onUpsertProviderEndpoint(mutation.endpoint);
      if (!requestId) {
        providerEntriesRef.current.set(providerId, {
          ...entry,
          error: frontendMessage("settings.draft.connectionInterrupted"),
          autoSaveBlocked: true,
        });
        bumpDraftVersion((version) => version + 1);
        return;
      }
      providerEntriesRef.current.set(providerId, {
        ...entry,
        active: {
          draft: nextDraft,
          providerId: mutation.providerId,
          requestId,
        },
        error: undefined,
        autoSaveBlocked: false,
        awaitingSnapshot: undefined,
      });
      bumpDraftVersion((version) => version + 1);
      if (pendingProviderDraftId === mutation.providerId) {
        setPendingProviderDraftConfirmation({ providerId: mutation.providerId, requestId });
      }
    },
    [onUpsertProviderEndpoint, pendingProviderDraftId, socketStatus],
  );

  useEffect(() => {
    let changed = false;
    const followUps: ProviderEndpointDraft[] = [];
    for (const [providerId, current] of providerEntriesRef.current) {
      const activeSave = current.active;
      if (!activeSave) continue;
      const operation = operations[providerId];
      if (!operation || operation.requestId !== activeSave.requestId || operation.status === "pending") continue;
      if (operation.status === "error") {
        providerEntriesRef.current.set(providerId, {
          ...current,
          active: undefined,
          queuedDraft: undefined,
          error: isConfigConflict(operation)
            ? frontendMessage("settings.draft.conflict")
            : (operation.message ?? frontendMessage("settings.draft.connectionInterrupted")),
          autoSaveBlocked: true,
        });
        if (isConfigConflict(operation)) onRefreshConfig();
        changed = true;
        continue;
      }
      const queuedDraft = current.queuedDraft;
      const latestProvider = providersRef.current.find((provider) => provider.Id === providerId);
      const latestSnapshot = latestProvider ? normalizeProviderEndpointDraft(latestProvider) : undefined;
      const snapshotMatchesRequest = Boolean(latestSnapshot && sameProviderEndpoint(latestSnapshot, activeSave.draft));
      const hasDistinctQueuedDraft = Boolean(queuedDraft && !sameProviderEndpoint(activeSave.draft, queuedDraft));
      providerEntriesRef.current.set(providerId, {
        ...current,
        synced: snapshotMatchesRequest && latestSnapshot ? latestSnapshot : current.synced,
        draft:
          hasDistinctQueuedDraft && queuedDraft
            ? queuedDraft
            : snapshotMatchesRequest && latestSnapshot
              ? latestSnapshot
              : current.draft,
        active: undefined,
        queuedDraft: undefined,
        awaitingSnapshot: hasDistinctQueuedDraft || snapshotMatchesRequest ? undefined : activeSave.draft,
        error: undefined,
        autoSaveBlocked: false,
      });
      if (hasDistinctQueuedDraft && queuedDraft) followUps.push(queuedDraft);
      changed = true;
    }
    if (changed) bumpDraftVersion((version) => version + 1);
    for (const draft of followUps) sendProviderDraft(draft, true);
  }, [onRefreshConfig, operations, sendProviderDraft]);

  useEffect(() => {
    if (pendingRenameProviderId) {
      return;
    }

    if (pendingProviderDraftId === selectedProviderId) {
      if (!acceptedProvider || acceptedProvider.Id !== selectedProviderId) {
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
  }, [
    acceptedProvider,
    pendingAddStatus,
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
    const currentEntry = acceptedProvider ? providerEntriesRef.current.get(acceptedProvider.Id) : undefined;
    const currentDirty = Boolean(currentEntry && !sameProviderEndpoint(currentEntry.synced, currentEntry.draft));
    if (currentDirty && currentEntry && !currentEntry.error && !currentEntry.autoSaveBlocked) confirmDraft();
    setSelectedProviderId(provider.Id);
    setDraftProvider(provider);
    return true;
  };

  const discardAndSelectProvider = (provider: ProviderEndpointDraft): void => {
    if (acceptedProvider) {
      const current = ensureProviderEntry(acceptedProvider);
      providerEntriesRef.current.set(acceptedProvider.Id, {
        ...current,
        draft: current.synced,
        queuedDraft: undefined,
        error: undefined,
        autoSaveBlocked: false,
      });
      const timer = providerSaveTimersRef.current.get(acceptedProvider.Id);
      if (timer !== undefined) window.clearTimeout(timer);
      providerSaveTimersRef.current.delete(acceptedProvider.Id);
      bumpDraftVersion((version) => version + 1);
    }
    setSelectedProviderId(provider.Id);
    setDraftProvider(provider);
    setPendingProviderDraft(null);
    setPendingProviderDraftConfirmation(null);
  };

  const updateDraftProvider = (patch: Partial<ProviderEndpointDraft>): void => {
    if (!acceptedProvider || !connectionDraft) return;
    const nextDraft = applyProviderConnectionDraftPatch({
      acceptedProvider,
      currentDraft: connectionDraft,
      patch,
    });
    const current = ensureProviderEntry(acceptedProvider);
    providerEntriesRef.current.set(acceptedProvider.Id, {
      ...current,
      draft: nextDraft,
      queuedDraft: current.active ? nextDraft : current.queuedDraft,
      error: undefined,
      autoSaveBlocked: false,
    });
    bumpDraftVersion((version) => version + 1);
    scheduleProviderSave(acceptedProvider.Id, 500);
  };

  const resetDraft = (): void => {
    if (!acceptedProvider) return;
    const current = ensureProviderEntry(acceptedProvider);
    providerEntriesRef.current.set(acceptedProvider.Id, {
      ...current,
      draft: current.synced,
      queuedDraft: undefined,
      error: undefined,
      autoSaveBlocked: false,
    });
    const timer = providerSaveTimersRef.current.get(acceptedProvider.Id);
    if (timer !== undefined) window.clearTimeout(timer);
    providerSaveTimersRef.current.delete(acceptedProvider.Id);
    bumpDraftVersion((version) => version + 1);
    setPendingProviderDraft(null);
    setPendingProviderDraftConfirmation(null);
  };

  const confirmDraft = (patch?: Partial<ProviderEndpointDraft>): void => {
    const currentEntry = acceptedProvider ? providerEntriesRef.current.get(acceptedProvider.Id) : selectedEntry;
    const currentConnectionDraft = currentEntry?.draft ?? connectionDraft;
    const nextDraft = patch
      ? applyProviderConnectionDraftPatch({
          acceptedProvider,
          currentDraft: currentConnectionDraft,
          patch,
        })
      : currentConnectionDraft;
    const currentDirty = Boolean(currentEntry && !sameProviderEndpoint(currentEntry.synced, currentEntry.draft));
    if (!nextDraft || (!patch && !currentDirty && !currentEntry?.active && !currentEntry?.queuedDraft)) return;
    const current = ensureProviderEntry(nextDraft);
    if (current.active) {
      providerEntriesRef.current.set(nextDraft.Id, {
        ...current,
        draft: nextDraft,
        queuedDraft: sameProviderEndpoint(current.active.draft, nextDraft) ? undefined : nextDraft,
        error: undefined,
      });
      bumpDraftVersion((version) => version + 1);
      return;
    }
    sendProviderDraft(nextDraft, true);
  };

  const scheduleProviderSave = (providerId: string, delay: number): void => {
    const previous = providerSaveTimersRef.current.get(providerId);
    if (previous !== undefined) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      providerSaveTimersRef.current.delete(providerId);
      const entry = providerEntriesRef.current.get(providerId);
      if (entry?.draft && !entry.active && !entry.awaitingSnapshot) sendProviderDraft(entry.draft);
    }, delay);
    providerSaveTimersRef.current.set(providerId, timer);
  };

  const addProvider = (provider: ProviderEndpointDraft): void => {
    const mutation = buildProviderEndpointMutationInput(providerIdentitySnapshot(provider));
    if (!mutation.ok) {
      if (acceptedProvider) {
        const current = ensureProviderEntry(acceptedProvider);
        providerEntriesRef.current.set(acceptedProvider.Id, { ...current, error: mutation.message });
        bumpDraftVersion((version) => version + 1);
      }
      return;
    }
    const requestId = onUpsertProviderEndpoint(mutation.endpoint);
    if (requestId) {
      const nextDraft = normalizeProviderEndpointDraft({
        ...provider,
        ...providerIdentitySnapshot(provider),
        Id: mutation.providerId,
      });
      providerEntriesRef.current.set(mutation.providerId, {
        synced: nextDraft,
        draft: nextDraft,
        active: { draft: nextDraft, providerId: mutation.providerId, requestId },
        autoSaveBlocked: false,
      });
      bumpDraftVersion((version) => version + 1);
      setSelectedProviderId(mutation.providerId);
      setDraftProvider(nextDraft);
      setPendingProviderDraft({ draft: nextDraft, requestId });
      setShowAddDialog(false);
    }
  };

  const renameProvider = (providerId: string, nextProviderId: string): void => {
    if (providerId === selectedProviderId && dirty) {
      const current = acceptedProvider ? ensureProviderEntry(acceptedProvider) : undefined;
      if (acceptedProvider && current) {
        providerEntriesRef.current.set(acceptedProvider.Id, {
          ...current,
          error: frontendMessage("settings.provider.pendingDraftError"),
        });
        bumpDraftVersion((version) => version + 1);
      }
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
    providerEntriesRef.current.delete(provider.Id);
    const timer = providerSaveTimersRef.current.get(provider.Id);
    if (timer !== undefined) window.clearTimeout(timer);
    providerSaveTimersRef.current.delete(provider.Id);
    bumpDraftVersion((version) => version + 1);
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
      if (acceptedProvider) {
        const current = ensureProviderEntry(acceptedProvider);
        providerEntriesRef.current.set(acceptedProvider.Id, { ...current, error: mutation.message });
        bumpDraftVersion((version) => version + 1);
      }
      return;
    }
    onFetchProviderModels(mutation.providerId, force, mutation.endpoint);
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

function rebaseProviderEndpoint(
  base: ProviderEndpointDraft,
  local: ProviderEndpointDraft | null,
  remote: ProviderEndpointDraft,
): ProviderEndpointDraft {
  if (!local) return normalizeProviderEndpointDraft(remote);
  const result: Record<string, unknown> = { ...normalizeProviderEndpointDraft(remote) };
  const baseRecord = normalizeProviderEndpointDraft(base) as unknown as Record<string, unknown>;
  const localRecord = normalizeProviderEndpointDraft(local) as unknown as Record<string, unknown>;
  const remoteRecord = result;
  for (const key of new Set([...Object.keys(baseRecord), ...Object.keys(localRecord)])) {
    const baseHas = Object.prototype.hasOwnProperty.call(baseRecord, key);
    const localHas = Object.prototype.hasOwnProperty.call(localRecord, key);
    if (!localHas && baseHas) {
      delete remoteRecord[key];
      continue;
    }
    if (localHas && (!baseHas || JSON.stringify(localRecord[key]) !== JSON.stringify(baseRecord[key]))) {
      remoteRecord[key] = localRecord[key];
    }
  }
  return normalizeProviderEndpointDraft(remoteRecord as unknown as ProviderEndpointDraft);
}
