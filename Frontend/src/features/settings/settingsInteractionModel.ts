import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export type SettingsDraftStatus = "loading" | "saving" | "invalid" | "dirty" | "synced";

export type SettingsDraftTone = "neutral" | "success" | "info" | "warning";

export interface SettingsDraftInteractionInput {
  dirty: boolean;
  localError?: string | null;
  ready?: boolean;
  saving: boolean;
  validationErrors?: readonly string[];
}

export interface SettingsDraftInteraction {
  detail: string;
  refreshDisabled: boolean;
  refreshLabel: string;
  refreshTitle: string;
  saveDisabled: boolean;
  saveTitle: string;
  status: SettingsDraftStatus;
  statusLabel: string;
  tone: SettingsDraftTone;
}

export function readSettingsDraftInteraction({
  dirty,
  localError = null,
  ready = true,
  saving,
  validationErrors = [],
}: SettingsDraftInteractionInput): SettingsDraftInteraction {
  const validationError = validationErrors[0] ?? null;
  const issue = validationError ?? localError;
  const refreshLabel = frontendMessage(dirty ? "settings.draft.restore" : "settings.draft.refresh");
  const refreshTitle = frontendMessage(dirty ? "settings.draft.restoreTitle" : "settings.draft.refreshTitle");

  if (!ready) {
    return {
      detail: frontendMessage("settings.draft.notLoaded"),
      refreshDisabled: true,
      refreshLabel,
      refreshTitle: frontendMessage("settings.draft.notLoadedTitle"),
      saveDisabled: true,
      saveTitle: frontendMessage("settings.draft.notLoadedTitle"),
      status: "loading",
      statusLabel: frontendMessage("settings.draft.waiting"),
      tone: "neutral",
    };
  }

  if (saving) {
    return {
      detail: frontendMessage("settings.draft.savingDetail"),
      refreshDisabled: true,
      refreshLabel,
      refreshTitle: frontendMessage("settings.draft.savingTitle"),
      saveDisabled: true,
      saveTitle: frontendMessage("settings.state.saving"),
      status: "saving",
      statusLabel: frontendMessage("settings.draft.savingStatus"),
      tone: "info",
    };
  }

  if (issue) {
    const blocksSave = Boolean(validationError);
    return {
      detail: issue,
      refreshDisabled: false,
      refreshLabel,
      refreshTitle,
      saveDisabled: blocksSave || !dirty,
      saveTitle: blocksSave
        ? frontendMessage("settings.draft.fixIssue", { issue })
        : dirty
          ? frontendMessage("settings.draft.retrySave")
          : frontendMessage("settings.draft.noUnsaved"),
      status: "invalid",
      statusLabel: frontendMessage("settings.draft.fixRequired"),
      tone: "warning",
    };
  }

  if (dirty) {
    return {
      detail: frontendMessage("settings.draft.unsavedDetail"),
      refreshDisabled: false,
      refreshLabel,
      refreshTitle,
      saveDisabled: false,
      saveTitle: frontendMessage("settings.draft.unsavedTitle"),
      status: "dirty",
      statusLabel: frontendMessage("settings.draft.unsaved"),
      tone: "info",
    };
  }

  return {
    detail: frontendMessage("settings.draft.syncedDetail"),
    refreshDisabled: false,
    refreshLabel,
    refreshTitle,
    saveDisabled: true,
    saveTitle: frontendMessage("settings.draft.syncedTitle"),
    status: "synced",
    statusLabel: frontendMessage("settings.state.synced"),
    tone: "success",
  };
}
