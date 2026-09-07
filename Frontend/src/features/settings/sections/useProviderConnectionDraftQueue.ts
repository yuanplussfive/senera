import { useCallback, useEffect, useRef, useState } from "react";
import type { SocketStatus } from "../../../api/useAgentSocket";
import { isConfigConflict } from "../../../app/configMutationFailure";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { normalizeProviderEndpointDraft } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import type { SettingsConfigCommands } from "../SettingsContracts";
import {
  applyProviderConnectionDraftPatch,
  buildProviderEndpointMutationInput,
  createProviderDraftEntry,
  providerEndpointSnapshotMatchesDraft,
  rebaseProviderEndpoint,
  sameProviderEndpoint,
  type ProviderDraftEntry,
} from "./providerConnectionState";

export interface ProviderConnectionDraftQueue {
  confirm: (
    acceptedProvider: ProviderEndpointDraft | null,
    connectionDraft: ProviderEndpointDraft | null,
    patch?: Partial<ProviderEndpointDraft>,
  ) => void;
  discard: (provider: ProviderEndpointDraft) => void;
  read: (provider: ProviderEndpointDraft) => ProviderDraftEntry;
  registerActive: (draft: ProviderEndpointDraft, providerId: string, requestId: string) => void;
  remove: (providerId: string) => void;
  reset: (provider: ProviderEndpointDraft) => void;
  setError: (provider: ProviderEndpointDraft, message: string) => void;
  update: (
    acceptedProvider: ProviderEndpointDraft,
    connectionDraft: ProviderEndpointDraft,
    patch: Partial<ProviderEndpointDraft>,
  ) => void;
}

export function useProviderConnectionDraftQueue({
  operations,
  onPendingDraftSave,
  onRefreshConfig,
  onUpsertProviderEndpoint,
  pendingProviderDraftId,
  providers,
  socketStatus,
}: {
  operations: SettingsConfigCommands["providerEndpointOperations"];
  onPendingDraftSave: (providerId: string, requestId: string) => void;
  onRefreshConfig: () => void;
  onUpsertProviderEndpoint: SettingsConfigCommands["upsertProviderEndpoint"];
  pendingProviderDraftId?: string;
  providers: readonly ProviderEndpointDraft[];
  socketStatus: SocketStatus;
}): ProviderConnectionDraftQueue {
  const [, bumpVersion] = useState(0);
  const entriesRef = useRef<Map<string, ProviderDraftEntry>>(new Map());
  const timersRef = useRef<Map<string, number>>(new Map());
  const providersRef = useRef(providers);
  const operationsRef = useRef(operations);
  const onPendingDraftSaveRef = useRef(onPendingDraftSave);
  const sendRef = useRef<(draft: ProviderEndpointDraft, manual?: boolean) => void>(() => undefined);
  providersRef.current = providers;
  operationsRef.current = operations;
  onPendingDraftSaveRef.current = onPendingDraftSave;
  const providerListKey = JSON.stringify(providers.map(normalizeProviderEndpointDraft));

  const read = useCallback((provider: ProviderEndpointDraft): ProviderDraftEntry => {
    const normalized = normalizeProviderEndpointDraft(provider);
    const current = entriesRef.current.get(normalized.Id);
    if (current) return current;
    const entry = createProviderDraftEntry(normalized);
    entriesRef.current.set(normalized.Id, entry);
    return entry;
  }, []);

  const cancelScheduledSave = useCallback((providerId: string): void => {
    const timer = timersRef.current.get(providerId);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(providerId);
  }, []);

  useEffect(() => {
    let changed = false;
    const currentProviders = providersRef.current;
    for (const provider of currentProviders) {
      const normalized = normalizeProviderEndpointDraft(provider);
      const current = entriesRef.current.get(provider.Id);
      if (!current) {
        entriesRef.current.set(provider.Id, createProviderDraftEntry(normalized));
        changed = true;
        continue;
      }
      if (sameProviderEndpoint(current.synced, normalized)) continue;
      if (current.awaitingSnapshot && providerEndpointSnapshotMatchesDraft(normalized, current.awaitingSnapshot)) {
        entriesRef.current.set(provider.Id, {
          ...current,
          synced: normalized,
          awaitingSnapshot: undefined,
          draft: sameProviderEndpoint(current.draft, current.synced) ? normalized : current.draft,
        });
        changed = true;
        continue;
      }
      if (current.awaitingSnapshot || current.active) continue;
      if (!current.queuedDraft && sameProviderEndpoint(current.synced, current.draft)) {
        entriesRef.current.set(provider.Id, {
          ...current,
          synced: normalized,
          draft: normalized,
          error: undefined,
          autoSaveBlocked: false,
        });
        changed = true;
        continue;
      }
      entriesRef.current.set(provider.Id, {
        ...current,
        synced: normalized,
        draft: rebaseProviderEndpoint(current.synced, current.draft, normalized),
      });
      changed = true;
    }
    const providerIds = new Set(currentProviders.map((provider) => provider.Id));
    for (const [providerId, entry] of entriesRef.current) {
      if (providerIds.has(providerId) || entry.active || entry.queuedDraft) continue;
      entriesRef.current.delete(providerId);
      cancelScheduledSave(providerId);
      changed = true;
    }
    if (changed) bumpVersion((version) => version + 1);
  }, [cancelScheduledSave, providerListKey]);

  const send = useCallback(
    (nextDraft: ProviderEndpointDraft, manual = false): void => {
      const providerId = nextDraft.Id;
      // Never upsert a provider that is being deleted or renamed, or that no
      // longer exists (except the pending-add flow): the backend appends on
      // unknown ids, so a late draft save would re-create the removed provider.
      const providerOperation = operationsRef.current[providerId];
      const destructivePending =
        providerOperation?.status === "pending" &&
        (providerOperation.kind === "provider.endpoint.delete" ||
          providerOperation.kind === "provider.endpoint.rename");
      const missing =
        pendingProviderDraftId !== providerId && !providersRef.current.some((provider) => provider.Id === providerId);
      if (destructivePending || missing) return;
      const entry = entriesRef.current.get(providerId) ?? read(nextDraft);
      if (entry.active) {
        entriesRef.current.set(providerId, { ...entry, queuedDraft: nextDraft });
        bumpVersion((version) => version + 1);
        return;
      }
      if (!entry.awaitingSnapshot && sameProviderEndpoint(entry.synced, nextDraft)) {
        entriesRef.current.set(providerId, {
          ...entry,
          draft: entry.synced,
          queuedDraft: undefined,
          error: undefined,
          autoSaveBlocked: false,
        });
        bumpVersion((version) => version + 1);
        return;
      }
      if (!manual && (entry.autoSaveBlocked || entry.awaitingSnapshot)) return;
      if (socketStatus !== "open") {
        entriesRef.current.set(providerId, {
          ...entry,
          error: frontendMessage("settings.draft.connectionInterrupted"),
          autoSaveBlocked: true,
        });
        bumpVersion((version) => version + 1);
        return;
      }
      const mutation = buildProviderEndpointMutationInput(nextDraft, entry.synced);
      if (!mutation.ok) {
        entriesRef.current.set(providerId, { ...entry, error: mutation.message });
        bumpVersion((version) => version + 1);
        return;
      }
      const requestId = onUpsertProviderEndpoint(mutation.endpoint);
      if (!requestId) {
        entriesRef.current.set(providerId, {
          ...entry,
          error: frontendMessage("settings.draft.connectionInterrupted"),
          autoSaveBlocked: true,
        });
        bumpVersion((version) => version + 1);
        return;
      }
      entriesRef.current.set(providerId, {
        ...entry,
        active: { draft: nextDraft, providerId: mutation.providerId, requestId },
        error: undefined,
        autoSaveBlocked: false,
        awaitingSnapshot: undefined,
      });
      bumpVersion((version) => version + 1);
      if (pendingProviderDraftId === mutation.providerId) {
        onPendingDraftSaveRef.current(mutation.providerId, requestId);
      }
    },
    [onUpsertProviderEndpoint, pendingProviderDraftId, read, socketStatus],
  );
  sendRef.current = send;

  useEffect(() => {
    let changed = false;
    const followUps: ProviderEndpointDraft[] = [];
    for (const [providerId, current] of entriesRef.current) {
      const activeSave = current.active;
      if (!activeSave) continue;
      const operation = operations[providerId];
      if (!operation || operation.commandId !== activeSave.requestId || operation.status === "pending") continue;
      if (operation.status === "error") {
        entriesRef.current.set(providerId, {
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
      const snapshotMatchesRequest = Boolean(
        latestSnapshot && providerEndpointSnapshotMatchesDraft(latestSnapshot, activeSave.draft),
      );
      const hasDistinctQueuedDraft = Boolean(queuedDraft && !sameProviderEndpoint(activeSave.draft, queuedDraft));
      entriesRef.current.set(providerId, {
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
    if (changed) bumpVersion((version) => version + 1);
    for (const draft of followUps) send(draft, true);
  }, [onRefreshConfig, operations, send]);

  const schedule = useCallback((providerId: string, delay: number): void => {
    const previous = timersRef.current.get(providerId);
    if (previous !== undefined) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      timersRef.current.delete(providerId);
      const entry = entriesRef.current.get(providerId);
      if (
        entry?.draft &&
        !entry.active &&
        !entry.awaitingSnapshot &&
        !sameProviderEndpoint(entry.synced, entry.draft)
      ) {
        sendRef.current(entry.draft);
      }
    }, delay);
    timersRef.current.set(providerId, timer);
  }, []);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
    },
    [],
  );

  return {
    read,
    discard: (provider) => {
      const current = read(provider);
      entriesRef.current.set(provider.Id, {
        ...current,
        draft: current.synced,
        queuedDraft: undefined,
        error: undefined,
        autoSaveBlocked: false,
      });
      cancelScheduledSave(provider.Id);
      bumpVersion((version) => version + 1);
    },
    update: (acceptedProvider, connectionDraft, patch) => {
      const nextDraft = applyProviderConnectionDraftPatch({
        acceptedProvider,
        currentDraft: connectionDraft,
        patch,
      });
      const current = read(acceptedProvider);
      entriesRef.current.set(acceptedProvider.Id, {
        ...current,
        draft: nextDraft,
        queuedDraft: current.active ? nextDraft : current.queuedDraft,
        error: undefined,
        autoSaveBlocked: false,
      });
      bumpVersion((version) => version + 1);
      schedule(acceptedProvider.Id, 500);
    },
    reset: (provider) => {
      const current = read(provider);
      entriesRef.current.set(provider.Id, {
        ...current,
        draft: current.synced,
        queuedDraft: undefined,
        error: undefined,
        autoSaveBlocked: false,
      });
      cancelScheduledSave(provider.Id);
      bumpVersion((version) => version + 1);
    },
    confirm: (acceptedProvider, connectionDraft, patch) => {
      const currentEntry = acceptedProvider ? entriesRef.current.get(acceptedProvider.Id) : undefined;
      const currentConnectionDraft = currentEntry?.draft ?? connectionDraft;
      const nextDraft = patch
        ? applyProviderConnectionDraftPatch({ acceptedProvider, currentDraft: currentConnectionDraft, patch })
        : currentConnectionDraft;
      const providerId = nextDraft?.Id ?? acceptedProvider?.Id;
      if (providerId) cancelScheduledSave(providerId);
      const dirty = Boolean(currentEntry && !sameProviderEndpoint(currentEntry.synced, currentEntry.draft));
      if (!nextDraft || (!patch && !dirty && !currentEntry?.active && !currentEntry?.queuedDraft)) return;
      const current = read(nextDraft);
      if (current.active) {
        entriesRef.current.set(nextDraft.Id, {
          ...current,
          draft: nextDraft,
          queuedDraft: sameProviderEndpoint(current.active.draft, nextDraft) ? undefined : nextDraft,
          error: undefined,
        });
        bumpVersion((version) => version + 1);
        return;
      }
      sendRef.current(nextDraft, true);
    },
    registerActive: (draft, providerId, requestId) => {
      entriesRef.current.set(providerId, {
        synced: draft,
        draft,
        active: { draft, providerId, requestId },
        autoSaveBlocked: false,
      });
      bumpVersion((version) => version + 1);
    },
    setError: (provider, message) => {
      const current = read(provider);
      entriesRef.current.set(provider.Id, { ...current, error: message });
      bumpVersion((version) => version + 1);
    },
    remove: (providerId) => {
      entriesRef.current.delete(providerId);
      cancelScheduledSave(providerId);
      bumpVersion((version) => version + 1);
    },
  };
}
