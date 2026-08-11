import { clearPersistedStore, DEFAULT_USER_PROFILE, useStore } from "../../Frontend/src/store/sessionStore.ts";

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
    sessionOrder: [],
    activeSessionId: null,
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    workflowDockWidth: 420,
    motionLevel: "full",
    viewedRunIdBySession: {},
    historyLoadedIds: {},
    historyLoadingIds: {},
    historyFailedIds: {},
    historyReplayBuffers: {},
    historyStepBuffers: {},
    historyEventRunIds: {},
    historyActiveRequestIds: {},
    processedEventIds: {},
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
    executionApprovalMode: "agent",
    presets: [],
    activePresetName: null,
    presetsEnabled: true,
    presetRootDir: "",
    configSnapshot: null,
    userProfile: DEFAULT_USER_PROFILE,
    catalogSynced: { sessions: false, presets: false },
    ...overrides,
  });
}

export function registerTestSession(sessionId, title = "Test session") {
  useStore.getState().registerCreatingSession(sessionId, title);
  return useStore.getState().sessions[sessionId];
}
