import { useStore } from "./sessionStore";
import type { StoreState } from "./session/types";
import { readWorkspacePreferences, type WorkspacePreferences } from "./session/persistence";

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
  "processedEventIds",
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
  return `senera-workspace:${workspaceId}`;
}

useStore.subscribe((state, previous) => {
  if (!activeWorkspace || !preferenceFields.some((key) => state[key] !== previous[key])) return;
  const preferences = Object.fromEntries(preferenceFields.map((key) => [key, state[key]]));
  localStorage.setItem(storageKey(activeWorkspace), JSON.stringify(preferences));
});

function project(state: StoreState): WorkspaceProjection {
  return Object.fromEntries(workspaceFields.map((key) => [key, state[key]])) as WorkspaceProjection;
}

export function activateWorkspaceSessionProjection(workspaceId: string): void {
  if (activeWorkspace === workspaceId) return;
  const next = {
    ...project(useStore.getInitialState()),
    ...readWorkspacePreferences(localStorage.getItem(storageKey(workspaceId))),
  };
  // Change ownership before publishing, so subscribers never write the target into the previous workspace.
  activeWorkspace = workspaceId;
  useStore.setState(next);
}
