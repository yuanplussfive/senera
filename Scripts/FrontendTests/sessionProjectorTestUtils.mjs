import { DEFAULT_USER_PROFILE } from "../../Frontend/src/store/session/userProfile.ts";

export const TestSessionId = "session_test";
export const TestRequestId = "request_test";
export const TestTimestamp = "2026-07-09T00:00:00.000Z";

export function createTestState() {
  return {
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    motionLevel: "reduced",
    viewedRunIdBySession: {},
    historyLoadedIds: {},
    historyLoadingIds: {},
    historyFailedIds: {},
    historyReplayBuffers: {},
    historyStepBuffers: {},
    historyEventRunIds: {},
    missingOnServerIds: {},
    pendingCreatedSessionIds: {},
    pendingDeletedSessionIds: {},
    modelProviders: [],
    providerModelCatalogs: {},
    providerModelErrors: {},
    selectedModelProviderId: null,
    pluginConfigs: [],
    presets: [],
    activePresetName: null,
    presetsEnabled: true,
    presetRootDir: "",
    configSnapshot: null,
    userProfile: DEFAULT_USER_PROFILE,
    selectSession: () => undefined,
    toggleSidebar: () => undefined,
    toggleRightPanel: () => undefined,
    setSidebarCollapsed: () => undefined,
    setRightPanelCollapsed: () => undefined,
    setMotionLevel: () => undefined,
    setViewedRun: () => undefined,
    registerCreatingSession: () => undefined,
    renameSession: () => undefined,
    appendUserMessage: () => undefined,
    advanceStreamingDisplay: () => false,
    ingest: () => undefined,
    removeSession: () => undefined,
    clearAllSessions: () => undefined,
    markHistoryLoading: () => undefined,
    markHistoryLoadFailed: () => undefined,
    selectModelProvider: () => undefined,
    setUserProfile: () => undefined,
    markUserProfileSynced: () => undefined,
    replaceWithDevMockData: () => undefined,
  };
}

export function createEvent(kind, data, overrides = {}) {
  return {
    channel: "agent.event",
    kind,
    layer: overrides.layer ?? "progress",
    phase: overrides.phase ?? "run",
    sequence: overrides.sequence ?? 1,
    timestamp: overrides.timestamp ?? TestTimestamp,
    sessionId: overrides.sessionId ?? TestSessionId,
    requestId: overrides.requestId ?? TestRequestId,
    step: overrides.step,
    scope: overrides.scope,
    detailId: overrides.detailId,
    data,
  };
}
