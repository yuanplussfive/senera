import { useStore } from "./sessionStore";
import type { StoreState } from "./session/types";
import { readWorkspacePreferences, type WorkspacePreferences } from "./session/persistence";
import { scheduleIdleTask } from "../shared/scheduling/scheduleIdleTask";

const workspaceFields = [
  "sessions",
  "runtimeSnapshotsBySession",
  "sessionOrder",
  "activeSessionId",
  "viewedRunIdBySession",
  "historyLoadedIds",
  "historyLoadingIds",
  "historyFailedIds",
  "historyReplayBuffers",
  "historySuppressedRequestIds",
  "historyStepBuffers",
  "historyEventRunIds",
  "historyActiveRequestIds",
  "historyRunEventBuffers",
  "historyPreviewedIds",
  "historyHydration",
  "runHistoryDetailStates",
  "processedEventIds",
  "processedEventRequestIds",
  "processedEventIdOrder",
  "missingOnServerIds",
  "pendingCreatedSessionIds",
  "pendingDeletedSessionIds",
  "childSessionParentIds",
  "selectedModelProviderIdsBySession",
  "selectedModelProviderId",
  "selectedThinkingLevelsBySession",
  "selectedThinkingLevel",
  "catalogSynced",
] as const satisfies readonly (keyof StoreState)[];
type WorkspaceProjection = Pick<StoreState, (typeof workspaceFields)[number]>;
let activeWorkspace: string | undefined;
const preferenceFields = [
  "activeSessionId",
  "runtimeSnapshotsBySession",
  "sessionOrder",
  "selectedModelProviderId",
  "selectedModelProviderIdsBySession",
  "selectedThinkingLevel",
  "selectedThinkingLevelsBySession",
] as const satisfies readonly (keyof WorkspacePreferences)[];

function storageKey(workspaceId: string): string {
  const mobileServer = window.__SENERA_RUNTIME_CONFIG__?.httpBaseUrl;
  return window.location.pathname.startsWith("/mobile/") && mobileServer
    ? `senera-workspace:${new URL(mobileServer).origin}:${workspaceId}`
    : `senera-workspace:${workspaceId}`;
}

let pendingPreferences: { workspaceId: string; preferences: WorkspacePreferences } | undefined;
let cancelPreferenceWrite: (() => void) | undefined;

function flushWorkspacePreferences(): void {
  cancelPreferenceWrite?.();
  cancelPreferenceWrite = undefined;
  const pending = pendingPreferences;
  pendingPreferences = undefined;
  if (pending) localStorage.setItem(storageKey(pending.workspaceId), JSON.stringify(pending.preferences));
}

const unsubscribe = useStore.subscribe((state, previous) => {
  if (!activeWorkspace || !preferenceFields.some((key) => state[key] !== previous[key])) return;
  pendingPreferences = {
    workspaceId: activeWorkspace,
    preferences: Object.fromEntries(preferenceFields.map((key) => [key, state[key]])) as WorkspacePreferences,
  };
  // Coalesce rapid selections and runtime snapshots without serializing the
  // workspace on the input path. Lifecycle boundaries flush the latest state.
  cancelPreferenceWrite ??= scheduleIdleTask(flushWorkspacePreferences);
});

const flushWhenHidden = (): void => {
  if (document.visibilityState === "hidden") flushWorkspacePreferences();
};
window.addEventListener("pagehide", flushWorkspacePreferences);
document.addEventListener("visibilitychange", flushWhenHidden);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    flushWorkspacePreferences();
    unsubscribe();
    window.removeEventListener("pagehide", flushWorkspacePreferences);
    document.removeEventListener("visibilitychange", flushWhenHidden);
  });
}

function project(state: StoreState): WorkspaceProjection {
  return Object.fromEntries(workspaceFields.map((key) => [key, state[key]])) as WorkspaceProjection;
}

export function activateWorkspaceSessionProjection(workspaceId: string): void {
  if (activeWorkspace === workspaceId) return;
  flushWorkspacePreferences();
  const next = {
    ...project(useStore.getInitialState()),
    ...readWorkspacePreferences(localStorage.getItem(storageKey(workspaceId))),
  };
  // Change ownership before publishing, so subscribers never write the target into the previous workspace.
  activeWorkspace = workspaceId;
  useStore.setState(next);
}
