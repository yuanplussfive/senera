import { useEffect, useMemo, useState } from "react";
import type { ConfigMutationState, ConfigSnapshotData } from "../../../api/eventTypes";
import { validateJsonConfigDraft, type JsonConfigObject } from "../../../shared/config/JsonConfigForm";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";

export interface ConfigSettingsDraftState {
  draft: JsonConfigObject;
  diagnostics: ConfigSnapshotData["diagnostics"];
  dirty: boolean;
  localError: string | null;
  saving: boolean;
  validationErrors: string[];
  refreshOrRestore: () => void;
  save: () => void;
  updateDraft: (value: JsonConfigObject) => void;
}

export interface UseConfigSettingsDraftStateOptions {
  active?: boolean;
  operation: ConfigMutationState | null;
  snapshot: ConfigSnapshotData | null;
  onRefresh: () => void;
  onSave: (config: Record<string, unknown>) => string | null;
}

export function useConfigSettingsDraftState({
  active = true,
  operation,
  snapshot,
  onRefresh,
  onSave,
}: UseConfigSettingsDraftStateOptions): ConfigSettingsDraftState {
  const [draft, setDraft] = useState<JsonConfigObject>({});
  const [dirty, setDirty] = useState(false);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const currentSnapshotVersion = snapshot?.version;
  const diagnostics = snapshot?.diagnostics ?? [];
  const validationErrors = useMemo(
    () => (snapshot ? validateJsonConfigDraft(snapshot.form.sections, draft) : []),
    [draft, snapshot],
  );
  const saveOperation = saveRequestId && operation?.requestId === saveRequestId ? operation : null;
  const saving = saveOperation?.status === "pending";

  useEffect(() => {
    if (!active || !snapshot) return;
    setDraft(snapshot.value);
    setDirty(false);
    setSaveRequestId(null);
    setLocalError(null);
  }, [active, currentSnapshotVersion, snapshot]);

  useEffect(() => {
    if (!saveOperation) return;
    if (saveOperation.status === "success") {
      setSaveRequestId(null);
      setDirty(false);
      setLocalError(null);
      return;
    }
    if (saveOperation.status === "error") {
      setSaveRequestId(null);
      setLocalError(saveOperation.message ?? frontendMessage("config.mainFailed"));
    }
  }, [saveOperation]);

  const updateDraft = (value: JsonConfigObject): void => {
    const currentSnapshot = snapshot;
    setDraft(value);
    setDirty(currentSnapshot ? !sameJson(value, currentSnapshot.value) : false);
    setLocalError(null);
  };

  const save = (): void => {
    if (!dirty || saving) return;
    const errors = snapshot ? validateJsonConfigDraft(snapshot.form.sections, draft) : [];
    if (errors.length > 0) {
      setLocalError(errors[0] ?? frontendMessage("config.mainInvalid"));
      return;
    }
    const requestId = onSave(draft);
    if (requestId) {
      setSaveRequestId(requestId);
    }
  };

  const refreshOrRestore = (): void => {
    if (!snapshot || saving) return;
    if (dirty) {
      setDraft(snapshot.value);
      setDirty(false);
      setSaveRequestId(null);
      setLocalError(null);
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
    validationErrors,
    refreshOrRestore,
    save,
    updateDraft,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
