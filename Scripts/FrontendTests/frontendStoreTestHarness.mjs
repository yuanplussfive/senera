import { clearPersistedStore, DEFAULT_USER_PROFILE, useStore } from "../../Frontend/src/store/sessionStore.ts";
import { DEFAULT_WORKFLOW_DOCK_WIDTH_RATIO } from "../../Frontend/src/shared/responsive/workflowDock.ts";
import { DEFAULT_TERMINAL_PANEL_HEIGHT_RATIO } from "../../Frontend/src/shared/responsive/terminalPanel.ts";

export function installMemoryLocalStorage() {
  const values = new Map();
  globalThis.localStorage = {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
  return values;
}

export function resetFrontendStore(overrides = {}) {
  clearPersistedStore();
  useStore.setState({
    sessions: {},
    runtimeSnapshotsBySession: {},
    sessionOrder: [],
    activeSessionId: null,
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    workflowDockWidthRatio: DEFAULT_WORKFLOW_DOCK_WIDTH_RATIO,
    terminalPanelOpen: false,
    terminalPanelMaximized: false,
    terminalPanelHeightRatio: DEFAULT_TERMINAL_PANEL_HEIGHT_RATIO,
    motionLevel: "full",
    viewedRunIdBySession: {},
    historyLoadedIds: {},
    historyLoadingIds: {},
    historyFailedIds: {},
    historyReplayBuffers: {},
    historyStepBuffers: {},
    historyEventRunIds: {},
    historyActiveRequestIds: {},
    historyRunEventBuffers: {},
    historyPreviewedIds: {},
    historyHydration: {},
    runHistoryDetailStates: {},
    processedEventIds: {},
    processedEventRequestIds: {},
    processedEventIdOrder: [],
    missingOnServerIds: {},
    pendingCreatedSessionIds: {},
    pendingDeletedSessionIds: {},
    childSessionParentIds: {},
    modelProviders: [],
    providerModelCatalogs: {},
    providerModelErrors: {},
    selectedModelProviderId: null,
    defaultModelProviderId: null,
    selectedModelProviderIdsBySession: {},
    selectedThinkingLevel: null,
    selectedThinkingLevelsBySession: {},
    executionApprovalMode: "agent",
    configSnapshot: null,
    userProfile: DEFAULT_USER_PROFILE,
    catalogSynced: { sessions: false },
    ...overrides,
  });
}

export function registerTestSession(sessionId, title = "Test session") {
  useStore.getState().registerCreatingSession(sessionId, title);
  return useStore.getState().sessions[sessionId];
}
