import { useCallback, useEffect, useRef } from "react";
import type { ModelProviderDraft } from "../../chat/modelConfigTypes";
import type { SettingsConfigCommands } from "../SettingsContracts";

interface ModelSaveQueueEntry {
  draft: ModelProviderDraft;
  requestId: string | null;
  requestDraft: ModelProviderDraft | null;
  timer: number | null;
  closeRequested: boolean;
}

export interface ProviderModelSaveQueue {
  discard: (modelId: string) => void;
  flush: (modelId?: string, closeRequested?: boolean) => boolean;
  readDraft: (modelId: string) => ModelProviderDraft | undefined;
  requestClose: (modelId: string) => boolean;
  schedule: (model: ModelProviderDraft, immediate: boolean) => void;
  submitNew: (model: ModelProviderDraft) => boolean;
}

export function useProviderModelSaveQueue({
  operations,
  onCloseSaved,
  onSubmit,
}: {
  operations: SettingsConfigCommands["providerModelOperations"];
  onCloseSaved: (modelId: string) => void;
  onSubmit: (model: ModelProviderDraft) => string | null;
}): ProviderModelSaveQueue {
  const entriesRef = useRef<Map<string, ModelSaveQueueEntry>>(new Map());
  const operationsRef = useRef(operations);
  const onCloseSavedRef = useRef(onCloseSaved);
  const onSubmitRef = useRef(onSubmit);
  const flushRef = useRef<(modelId?: string, closeRequested?: boolean) => boolean>(() => true);
  operationsRef.current = operations;
  onCloseSavedRef.current = onCloseSaved;
  onSubmitRef.current = onSubmit;

  const requestSave = useCallback((model: ModelProviderDraft, closeRequested: boolean): boolean => {
    const current = entriesRef.current.get(model.Id) ?? createQueueEntry(model);
    if (current.requestId && operationsRef.current[model.Id]?.status === "pending") {
      entriesRef.current.set(model.Id, {
        ...current,
        draft: model,
        closeRequested: current.closeRequested || closeRequested,
      });
      return false;
    }
    const requestId = onSubmitRef.current(model);
    if (!requestId) return false;
    entriesRef.current.set(model.Id, {
      ...current,
      draft: model,
      requestId,
      requestDraft: model,
      timer: null,
      closeRequested: current.closeRequested || closeRequested,
    });
    return true;
  }, []);

  const flush = useCallback(
    (modelId?: string, closeRequested = false): boolean => {
      if (!modelId) return true;
      const current = entriesRef.current.get(modelId);
      if (!current) return true;
      if (current.timer !== null) window.clearTimeout(current.timer);
      entriesRef.current.set(modelId, {
        ...current,
        timer: null,
        closeRequested: current.closeRequested || closeRequested,
      });
      if (current.requestId) return false;
      return requestSave(current.draft, closeRequested || current.closeRequested);
    },
    [requestSave],
  );
  flushRef.current = flush;

  useEffect(() => {
    for (const [modelId, current] of entriesRef.current) {
      if (!current.requestId) continue;
      const operation = operations[modelId];
      if (!operation || operation.commandId !== current.requestId || operation.status === "pending") continue;
      if (operation.status === "error") {
        entriesRef.current.set(modelId, {
          ...current,
          requestId: null,
          requestDraft: null,
          closeRequested: false,
        });
        continue;
      }
      const hasNewerDraft = !sameModelDraft(current.draft, current.requestDraft ?? current.draft);
      entriesRef.current.set(modelId, {
        ...current,
        requestId: null,
        requestDraft: null,
        closeRequested: hasNewerDraft ? current.closeRequested : false,
      });
      if (hasNewerDraft) {
        flushRef.current(modelId, false);
        continue;
      }
      if (current.closeRequested) {
        entriesRef.current.delete(modelId);
        onCloseSavedRef.current(modelId);
      }
    }
  }, [operations]);

  useEffect(
    () => () => {
      for (const entry of entriesRef.current.values()) {
        if (entry.timer !== null) window.clearTimeout(entry.timer);
      }
    },
    [],
  );

  const schedule = useCallback(
    (model: ModelProviderDraft, immediate: boolean): void => {
      const current = entriesRef.current.get(model.Id) ?? createQueueEntry(model);
      if (current.timer !== null) window.clearTimeout(current.timer);
      const timer = window.setTimeout(
        () => {
          const entry = entriesRef.current.get(model.Id);
          if (!entry) return;
          entriesRef.current.set(model.Id, { ...entry, timer: null, draft: model });
          requestSave(model, false);
        },
        immediate ? 0 : 500,
      );
      entriesRef.current.set(model.Id, { ...current, draft: model, timer });
    },
    [requestSave],
  );

  const requestClose = useCallback((modelId: string): boolean => {
    const current = entriesRef.current.get(modelId);
    if (!current?.requestId) return true;
    entriesRef.current.set(modelId, { ...current, closeRequested: true });
    return false;
  }, []);

  // Drops the local draft and any scheduled save. An in-flight request cannot
  // be cancelled, but its completion is ignored once the entry is gone. Used
  // when the user discards changes or removes the model, so stale drafts never
  // resurface on the next open or resurrect a deleted model.
  const discard = useCallback((modelId: string): void => {
    const current = entriesRef.current.get(modelId);
    if (!current) return;
    if (current.timer !== null) window.clearTimeout(current.timer);
    entriesRef.current.delete(modelId);
  }, []);

  const submitNew = useCallback(
    (model: ModelProviderDraft): boolean => {
      if (!requestClose(model.Id)) return false;
      const requestId = onSubmitRef.current(model);
      if (!requestId) return false;
      entriesRef.current.set(model.Id, {
        ...createQueueEntry(model),
        requestId,
        requestDraft: model,
        closeRequested: true,
      });
      return true;
    },
    [requestClose],
  );

  return {
    discard,
    flush,
    readDraft: (modelId) => entriesRef.current.get(modelId)?.draft,
    requestClose,
    schedule,
    submitNew,
  };
}

function createQueueEntry(draft: ModelProviderDraft): ModelSaveQueueEntry {
  return {
    draft,
    requestId: null,
    requestDraft: null,
    timer: null,
    closeRequested: false,
  };
}

function sameModelDraft(left: ModelProviderDraft, right: ModelProviderDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
