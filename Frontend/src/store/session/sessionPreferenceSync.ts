import { PERSIST_KEY, readPersistedSessionPreferences } from "./persistence";
import { normalizeUserProfile, type UserProfile } from "./userProfile";
import type { StoreState } from "./types";

interface SessionPreferenceSyncPort {
  readonly read: () => SessionPreferenceSnapshot;
  readonly update: (state: SessionPreferenceUpdate) => void;
}

type SessionPreferenceSnapshot = Pick<
  StoreState,
  | "defaultSidebarCollapsed"
  | "defaultRightPanelCollapsed"
  | "motionLevel"
  | "executionApprovalMode"
  | "userProfile"
  | "workflowDockWidth"
>;

type SessionPreferenceUpdate = Partial<SessionPreferenceSnapshot & Pick<StoreState, "sidebarCollapsed">>;

/** Cross-window synchronization only publishes application preferences. */
export function installSessionPreferenceSynchronization(port: SessionPreferenceSyncPort): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (event) => {
    if (event.key !== PERSIST_KEY) return;
    const preferences = readPersistedSessionPreferences(event.newValue);
    if (!preferences) return;
    const current = port.read();
    const changes: SessionPreferenceUpdate = {};

    if (
      preferences.defaultSidebarCollapsed !== undefined &&
      preferences.defaultSidebarCollapsed !== current.defaultSidebarCollapsed
    ) {
      changes.defaultSidebarCollapsed = preferences.defaultSidebarCollapsed;
      changes.sidebarCollapsed = preferences.defaultSidebarCollapsed;
    }
    if (
      preferences.defaultRightPanelCollapsed !== undefined &&
      preferences.defaultRightPanelCollapsed !== current.defaultRightPanelCollapsed
    ) {
      changes.defaultRightPanelCollapsed = preferences.defaultRightPanelCollapsed;
    }
    if (preferences.motionLevel !== undefined && preferences.motionLevel !== current.motionLevel) {
      changes.motionLevel = preferences.motionLevel;
    }
    if (
      preferences.executionApprovalMode !== undefined &&
      preferences.executionApprovalMode !== current.executionApprovalMode
    ) {
      changes.executionApprovalMode = preferences.executionApprovalMode;
    }
    if (preferences.workflowDockWidth !== undefined && preferences.workflowDockWidth !== current.workflowDockWidth) {
      changes.workflowDockWidth = preferences.workflowDockWidth;
    }
    if (preferences.userProfile !== undefined) {
      const profile = normalizeUserProfile(preferences.userProfile);
      if (!sameUserProfile(profile, current.userProfile)) changes.userProfile = profile;
    }
    if (Object.keys(changes).length > 0) port.update(changes);
  });
}

function sameUserProfile(left: UserProfile, right: UserProfile): boolean {
  return (
    left.name === right.name &&
    left.avatarDataUrl === right.avatarDataUrl &&
    left.avatarPath === right.avatarPath &&
    left.assistant.name === right.assistant.name &&
    left.assistant.avatarDataUrl === right.assistant.avatarDataUrl &&
    left.assistant.avatarPath === right.assistant.avatarPath &&
    left.updatedAt === right.updatedAt &&
    left.syncState === right.syncState
  );
}
