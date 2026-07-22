import { beforeEach, expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";

installLocalStorage();
const { clearPersistedStore, DEFAULT_SESSION_TITLE, useStore } =
  await import("../../../Frontend/src/store/sessionStore.ts");
const { PERSIST_KEY } = await import("../../../Frontend/src/store/session/persistence.ts");

beforeEach(() => {
  clearPersistedStore();
  useStore.setState({
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    viewedRunIdBySession: {},
    historyLoadedIds: {},
    historyLoadingIds: {},
    historyFailedIds: {},
    historyReplayBuffers: {},
    historyStepBuffers: {},
    historyEventRunIds: {},
    historyActiveRequestIds: {},
    missingOnServerIds: {},
    pendingCreatedSessionIds: {},
    pendingDeletedSessionIds: {},
    modelProviders: [],
    selectedModelProviderId: null,
    defaultModelProviderId: null,
    selectedModelProviderIdsBySession: {},
  });
});

test("cross-window preference refresh preserves manually toggled panels when their defaults are unchanged", () => {
  useStore.setState({
    defaultSidebarCollapsed: false,
    defaultRightPanelCollapsed: false,
    sidebarCollapsed: true,
    rightPanelCollapsed: true,
    motionLevel: "full",
    selectedModelProviderId: "provider_a",
    selectedModelProviderIdsBySession: { session_a: "provider_a" },
  });

  dispatchPersistedStorage({
    state: {
      defaultSidebarCollapsed: false,
      defaultRightPanelCollapsed: false,
      motionLevel: "full",
      selectedModelProviderId: "provider_a",
      selectedModelProviderIdsBySession: { session_a: "provider_a" },
    },
    version: 5,
  });

  expect(useStore.getState()).toMatchObject({
    sidebarCollapsed: true,
    rightPanelCollapsed: true,
  });
});

test("cross-window layout default changes still apply to the live panels", () => {
  useStore.setState({
    defaultSidebarCollapsed: false,
    defaultRightPanelCollapsed: false,
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
  });

  dispatchPersistedStorage({
    state: {
      defaultSidebarCollapsed: true,
      defaultRightPanelCollapsed: true,
      motionLevel: useStore.getState().motionLevel,
      selectedModelProviderId: useStore.getState().selectedModelProviderId,
      selectedModelProviderIdsBySession: useStore.getState().selectedModelProviderIdsBySession,
    },
    version: 5,
  });

  expect(useStore.getState()).toMatchObject({
    defaultSidebarCollapsed: true,
    defaultRightPanelCollapsed: true,
    sidebarCollapsed: true,
    rightPanelCollapsed: true,
  });
});

test("register and append user message create a local run without persisting backend-owned history", () => {
  const store = useStore.getState();

  store.registerCreatingSession("session_a");
  store.appendUserMessage("session_a", "request_a", "整理一下今天的工作事项");

  const state = useStore.getState();
  const session = state.sessions.session_a;
  expect(session).toBeTruthy();
  expect(session.title).toBe("整理一下今天的工作事项");
  expect(session.status).toBe("creating");
  expect(state.activeSessionId).toBe("session_a");
  expect(session.messages.map((message) => [message.role, message.content])).toEqual([
    ["user", "整理一下今天的工作事项"],
  ]);
  expect(session.runs.length).toBe(1);
  expect(session.runs[0].requestId).toBe("request_a");
  expect(session.activeRequestId).toBe("request_a");
});

test("history loading gates local message appends and failure state is explicit", () => {
  const store = useStore.getState();

  store.registerCreatingSession("session_history", DEFAULT_SESSION_TITLE);
  store.markHistoryLoading("session_history");
  store.appendUserMessage("session_history", "request_ignored", "这条不应该插入");
  store.markHistoryLoadFailed("session_history");

  const state = useStore.getState();
  const session = state.sessions.session_history;
  expect(session).toBeTruthy();
  expect(session.messages.length).toBe(0);
  expect(state.historyLoadingIds.session_history).toBe(false);
  expect(state.historyFailedIds.session_history).toBe(true);
  expect(state.historyReplayBuffers.session_history).toBe(undefined);
});

test("keeps the active conversation model independent from a later default-model change", () => {
  const store = useStore.getState();
  const snapshot = (defaultModelProviderId) => ({
    channel: "agent.event",
    kind: EventKinds.ModelListSnapshot,
    layer: "snapshot",
    phase: "config",
    sequence: 1,
    timestamp: "2026-07-13T00:00:00.000Z",
    data: {
      defaultModelProviderId,
      models: [
        {
          id: "provider_a",
          icon: "mistral",
          capabilities: { Chat: true },
          kind: "OpenAICompatible",
          endpoint: "ChatCompletions",
          baseUrl: "https://example.invalid/v1",
          model: "mistral-large-latest",
          isDefault: defaultModelProviderId === "provider_a",
        },
        {
          id: "provider_b",
          icon: "openai",
          capabilities: { Chat: true },
          kind: "OpenAICompatible",
          endpoint: "ChatCompletions",
          baseUrl: "https://example.invalid/v1",
          model: "gpt-4.1",
          isDefault: defaultModelProviderId === "provider_b",
        },
      ],
    },
  });

  store.ingest(snapshot("provider_b"));
  store.registerCreatingSession("session_a", undefined, "provider_a");
  store.registerCreatingSession("session_b", undefined, "provider_b");
  store.selectSession("session_a");
  expect(useStore.getState().selectedModelProviderId).toBe("provider_a");

  store.ingest(snapshot("provider_a"));
  expect(useStore.getState().defaultModelProviderId).toBe("provider_a");
  expect(useStore.getState().selectedModelProviderId).toBe("provider_a");

  store.selectSession("session_b");
  expect(useStore.getState().selectedModelProviderId).toBe("provider_b");
  store.applyDefaultModelToActiveSession();
  expect(useStore.getState().selectedModelProviderId).toBe("provider_a");
  expect(useStore.getState().selectedModelProviderIdsBySession).toMatchObject({
    session_a: "provider_a",
    session_b: "provider_a",
  });
});

test("ingest applies model snapshots and keeps selected provider stable", () => {
  const store = useStore.getState();

  store.selectModelProvider("provider_a");
  store.ingest({
    channel: "agent.event",
    kind: EventKinds.ModelListSnapshot,
    layer: "snapshot",
    phase: "config",
    sequence: 1,
    timestamp: "2026-07-09T00:00:00.000Z",
    data: {
      defaultModelProviderId: "provider_b",
      models: [
        {
          id: "provider_a",
          icon: "mistral",
          capabilities: { Chat: true },
          kind: "OpenAICompatible",
          endpoint: "ChatCompletions",
          baseUrl: "https://example.invalid/v1",
          model: "mistral-large-latest",
          isDefault: false,
        },
      ],
    },
  });

  const state = useStore.getState();
  expect(state.selectedModelProviderId).toBe("provider_a");
  expect(state.modelProviders.length).toBe(1);
  expect(state.modelProviders[0].model).toBe("mistral-large-latest");
});

test("ingestMany preserves sequential projection semantics with one store notification", () => {
  const events = [modelSnapshot("provider_a", "mistral-large-latest", 1), modelSnapshot("provider_b", "gpt-4.1", 2)];

  for (const event of events) useStore.getState().ingest(event);
  const sequential = readModelSelection();

  useStore.setState({
    modelProviders: [],
    selectedModelProviderId: null,
    defaultModelProviderId: null,
    selectedModelProviderIdsBySession: {},
  });
  let notifications = 0;
  const unsubscribe = useStore.subscribe(() => {
    notifications += 1;
  });
  useStore.getState().ingestMany(events);
  unsubscribe();

  expect(readModelSelection()).toEqual(sequential);
  expect(notifications).toBe(1);
});

function installLocalStorage() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, String(value));
    },
    removeItem: (key) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  };
}

function dispatchPersistedStorage(value) {
  const event = new Event("storage");
  Object.defineProperties(event, {
    key: { value: PERSIST_KEY },
    newValue: { value: JSON.stringify(value) },
  });
  window.dispatchEvent(event);
}

function modelSnapshot(providerId, model, sequence) {
  return {
    channel: "agent.event",
    kind: EventKinds.ModelListSnapshot,
    layer: "snapshot",
    phase: "config",
    sequence,
    timestamp: `2026-07-22T00:00:0${sequence}.000Z`,
    data: {
      defaultModelProviderId: providerId,
      models: [
        {
          id: providerId,
          icon: providerId === "provider_a" ? "mistral" : "openai",
          capabilities: { Chat: true },
          kind: "OpenAICompatible",
          endpoint: "ChatCompletions",
          baseUrl: "https://example.invalid/v1",
          model,
          isDefault: true,
        },
      ],
    },
  };
}

function readModelSelection() {
  const state = useStore.getState();
  return {
    modelProviders: state.modelProviders,
    selectedModelProviderId: state.selectedModelProviderId,
    defaultModelProviderId: state.defaultModelProviderId,
    selectedModelProviderIdsBySession: state.selectedModelProviderIdsBySession,
  };
}
