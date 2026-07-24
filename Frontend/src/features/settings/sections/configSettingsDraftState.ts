import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigMutationState, ConfigSnapshotData } from "../../../api/eventTypes";
import type { SocketStatus } from "../../../api/useAgentSocket";
import { isConfigConflict } from "../../../app/configMutationFailure";
import { validateJsonConfigDraft, type JsonConfigObject } from "../../../shared/config/JsonConfigForm";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";

export type ConfigDraftSaveMode = "debounced" | "immediate";

export interface ConfigSettingsDraftState {
  draft: JsonConfigObject;
  diagnostics: ConfigSnapshotData["diagnostics"];
  dirty: boolean;
  localError: string | null;
  saving: boolean;
  savedRecently: boolean;
  conflict: boolean;
  validationErrors: string[];
  flushSave: () => void;
  refreshOrRestore: () => void;
  save: () => void;
  updateDraft: (value: JsonConfigObject, mode?: ConfigDraftSaveMode) => void;
}

export interface UseConfigSettingsDraftStateOptions {
  active?: boolean;
  operation: ConfigMutationState | null;
  snapshot: ConfigSnapshotData | null;
  socketStatus?: SocketStatus;
  onRefresh: () => void;
  onSave: (config: Record<string, unknown>) => string | null;
}

const AUTO_SAVE_DELAY_MS = 500;

export function useConfigSettingsDraftState({
  active = true,
  operation,
  snapshot,
  socketStatus = "open",
  onRefresh,
  onSave,
}: UseConfigSettingsDraftStateOptions): ConfigSettingsDraftState {
  const [draft, setDraft] = useState<JsonConfigObject>({});
  const [dirty, setDirty] = useState(false);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [autoSaveBlocked, setAutoSaveBlocked] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveDelay, setSaveDelay] = useState(AUTO_SAVE_DELAY_MS);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(dirty);
  const saveRequestIdRef = useRef<string | null>(null);
  const saveRequestDraftRef = useRef<JsonConfigObject | null>(null);
  const baseSnapshotRef = useRef<JsonConfigObject | null>(null);
  const savedStatusTimerRef = useRef<number | null>(null);
  const snapshotKey = snapshot ? `${snapshot.version}:${snapshot.revision ?? "json"}` : "";
  const diagnostics = snapshot?.diagnostics ?? [];
  const validationErrors = useMemo(
    () => (snapshot ? validateJsonConfigDraft(snapshot.form.sections, draft) : []),
    [draft, snapshot],
  );
  const saveOperation = saveRequestId && operation?.commandId === saveRequestId ? operation : null;
  const saving = saveRequestId !== null && saveOperation?.status !== "success" && saveOperation?.status !== "error";

  useEffect(() => {
    draftRef.current = draft;
    dirtyRef.current = dirty;
  }, [draft, dirty]);

  useEffect(() => {
    return () => {
      if (savedStatusTimerRef.current !== null) window.clearTimeout(savedStatusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!active || !snapshot || saveRequestIdRef.current) return;
    const latest = snapshot.value;
    const base = baseSnapshotRef.current;
    const nextDraft = dirtyRef.current && base ? rebaseJson(base, draftRef.current, latest) : latest;
    baseSnapshotRef.current = latest;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    const nextDirty = !sameJson(nextDraft, latest);
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
    if (!nextDirty && !conflict) {
      setLocalError(null);
      setAutoSaveBlocked(false);
    }
  }, [active, conflict, snapshotKey, snapshot]);

  useEffect(() => {
    if (!saveOperation) return;
    if (saveOperation.status === "success") {
      setSaveRequestId(null);
      saveRequestIdRef.current = null;
      saveRequestDraftRef.current = null;
      setLocalError(null);
      setAutoSaveBlocked(false);
      setSavedRecently(true);
      if (savedStatusTimerRef.current !== null) window.clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = window.setTimeout(() => {
        setSavedRecently(false);
        savedStatusTimerRef.current = null;
      }, 1800);
      if (snapshot) {
        baseSnapshotRef.current = snapshot.value;
        const nextDirty = !sameJson(draftRef.current, snapshot.value);
        dirtyRef.current = nextDirty;
        setDirty(nextDirty);
        if (!nextDirty) {
          draftRef.current = snapshot.value;
          setDraft(snapshot.value);
        }
      }
      return;
    }
    if (saveOperation.status === "error") {
      setSaveRequestId(null);
      saveRequestIdRef.current = null;
      saveRequestDraftRef.current = null;
      const stale = isConfigConflict(saveOperation);
      setConflict(stale);
      setLocalError(
        stale
          ? frontendMessage("settings.draft.conflict")
          : (saveOperation.message ?? frontendMessage("config.mainFailed")),
      );
      setAutoSaveBlocked(true);
      if (stale) onRefresh();
    }
  }, [onRefresh, saveOperation, snapshot]);

  const saveDraft = useCallback(
    (manual: boolean): void => {
      const candidate = draftRef.current;
      const currentSnapshot = snapshot;
      const candidateDirty = currentSnapshot ? !sameJson(candidate, currentSnapshot.value) : dirtyRef.current;
      if (!candidateDirty || saveRequestIdRef.current) return;
      if (!manual && (autoSaveBlocked || conflict)) return;
      const errors = currentSnapshot ? validateJsonConfigDraft(currentSnapshot.form.sections, candidate) : [];
      if (errors.length > 0) {
        setLocalError(errors[0] ?? frontendMessage("config.mainInvalid"));
        setAutoSaveBlocked(true);
        return;
      }
      if (socketStatus !== "open") {
        setLocalError(frontendMessage("settings.draft.connectionInterrupted"));
        setAutoSaveBlocked(true);
        return;
      }
      if (manual) {
        setConflict(false);
        setAutoSaveBlocked(false);
      }
      const requestId = onSave(candidate);
      if (requestId) {
        saveRequestDraftRef.current = candidate;
        saveRequestIdRef.current = requestId;
        setSaveRequestId(requestId);
      } else {
        setLocalError(frontendMessage("settings.draft.connectionInterrupted"));
        setAutoSaveBlocked(true);
      }
    },
    [autoSaveBlocked, conflict, onSave, snapshot, socketStatus],
  );

  useEffect(() => {
    if (!dirty || saving || validationErrors.length > 0 || autoSaveBlocked || conflict) return;
    const timer = window.setTimeout(() => saveDraft(false), saveDelay);
    return () => window.clearTimeout(timer);
  }, [autoSaveBlocked, conflict, dirty, saveDelay, saveDraft, saving, validationErrors.length]);

  const updateDraft = (value: JsonConfigObject, mode: ConfigDraftSaveMode = "debounced"): void => {
    draftRef.current = value;
    const currentSnapshot = snapshot;
    const nextDirty = currentSnapshot ? !sameJson(value, currentSnapshot.value) : false;
    dirtyRef.current = nextDirty;
    setDraft(value);
    setDirty(nextDirty);
    setLocalError(null);
    setAutoSaveBlocked(false);
    setSavedRecently(false);
    if (savedStatusTimerRef.current !== null) {
      window.clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
    setSaveDelay(mode === "immediate" ? 0 : AUTO_SAVE_DELAY_MS);
  };

  const flushSave = useCallback((): void => saveDraft(false), [saveDraft]);
  const save = useCallback((): void => saveDraft(true), [saveDraft]);

  const refreshOrRestore = (): void => {
    if (!snapshot || saving) return;
    if (dirtyRef.current) {
      baseSnapshotRef.current = snapshot.value;
      draftRef.current = snapshot.value;
      dirtyRef.current = false;
      setDraft(snapshot.value);
      setDirty(false);
      setSaveRequestId(null);
      saveRequestIdRef.current = null;
      saveRequestDraftRef.current = null;
      setLocalError(null);
      setAutoSaveBlocked(false);
      setConflict(false);
      return;
    }
    onRefresh();
  };

  return {
    draft,
    diagnostics,
    dirty,
    localError,
    saving,
    savedRecently,
    conflict,
    validationErrors,
    flushSave,
    refreshOrRestore,
    save,
    updateDraft,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function rebaseJson(base: unknown, local: unknown, remote: unknown): JsonConfigObject {
  if (sameJson(local, base)) return isObject(remote) ? cloneObject(remote) : {};
  if (!isObject(base) || !isObject(local) || !isObject(remote)) {
    return isObject(local) ? cloneObject(local) : {};
  }
  const result: JsonConfigObject = cloneObject(remote);
  const keys = new Set([...Object.keys(base), ...Object.keys(local)]);
  for (const key of keys) {
    const baseValue = base[key];
    const localHas = Object.prototype.hasOwnProperty.call(local, key);
    const baseHas = Object.prototype.hasOwnProperty.call(base, key);
    if (!localHas && baseHas) {
      delete result[key];
      continue;
    }
    if (localHas && (!baseHas || !sameJson(local[key], baseValue))) {
      result[key] = mergeJsonValue(baseValue, local[key], remote[key]);
    }
  }
  return result;
}

function mergeJsonValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (isObject(base) && isObject(local) && isObject(remote)) return rebaseJson(base, local, remote);
  return cloneJsonValue(local);
}

function isObject(value: unknown): value is JsonConfigObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneObject(value: JsonConfigObject): JsonConfigObject {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isObject(value)) return cloneObject(value);
  return value;
}
