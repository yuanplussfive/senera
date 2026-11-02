import { beforeEach, expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";

installLocalStorage();
const { clearPersistedStore, DEFAULT_SESSION_TITLE, useStore } =
  await import("../../../Frontend/src/store/sessionStore.ts");
const { PERSIST_KEY } = await import("../../../Frontend/src/store/session/persistence.ts");
const { selectConversationAgent } = await import("../../../Frontend/src/store/session/sessionAgentSelection.ts");
const { syncActiveSessionModelSelection } =
  await import("../../../Frontend/src/store/session/sessionModelSelection.ts");
const { activateWorkspaceSessionProjection } =
  await import("../../../Frontend/src/store/workspaceSessionProjection.ts");

beforeEach(() => {
  clearPersistedStore();
  useStore.setState({
    sessions: {},
    runtimeSnapshotsBySession: {},
    sessionOrder: [],
    activeSessionId: null,
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    workflowDockWidthRatio: 0.42,
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
    selectedModelProviderId: null,
    defaultModelProviderId: null,
    selectedModelProviderIdsBySession: {},
    agentDirectory: null,
    selectedAgentId: null,
    executionApprovalMode: "agent",
    systemTools: [],
    systemExtensions: [],
    mcpServers: [],
    toolSettingsSynced: { systemTools: false, mcpServers: false },
  });
});

test("switching Agents selects their default while conversation overrides stay isolated", () => {
  const agents = [
    { id: "agent-a", name: "A", enabled: true, modelProviderId: "provider_a" },
    { id: "agent-b", name: "B", enabled: true, modelProviderId: "provider_b" },
  ];
  useStore.setState({
    agentDirectory: { revision: 1, defaultAgentId: "agent-a", agents, deletingAgentIds: [] },
    modelProviders: ["provider_a", "provider_b"].map((id) => ({
      id,
      capabilities: { Chat: true },
      toolPlanningMode: "baml",
      stream: true,
    })),
    defaultModelProviderId: "provider_a",
    selectedAgentId: "agent-a",
    selectedModelProviderId: "provider_a",
    sessions: { old: { sessionId: "old", agentId: "agent-a" } },
    activeSessionId: "old",
  });
  useStore.setState((state) => selectConversationAgent(state, "agent-b"));
  expect(useStore.getState()).toMatchObject({
    activeSessionId: null,
    selectedAgentId: "agent-b",
    selectedModelProviderId: "provider_b",
  });
  const store = useStore.getState();
  store.selectModelProvider("provider_a");
  store.registerCreatingSession("new", undefined, "provider_a");
  expect(useStore.getState().sessions.new.agentId).toBe("agent-b");
  expect(useStore.getState().agentDirectory.agents[1].modelProviderId).toBe("provider_b");
  store.selectSession("old");
  expect(useStore.getState().selectedModelProviderId).toBe("provider_a");
  expect(useStore.getState().selectedModelProviderIdsBySession.old).toBeUndefined();
  store.selectSession("new");
  expect(useStore.getState().selectedModelProviderId).toBe("provider_a");
});

test("model snapshots keep defaults derived and acknowledge local overrides without masking future preferences", () => {
  useStore.setState({
    modelProviders: ["provider_a", "provider_b"].map((id) => ({
      id,
      capabilities: { Chat: true },
      toolPlanningMode: "baml",
      stream: true,
    })),
    defaultModelProviderId: "provider_a",
    sessions: { a: { sessionId: "a" }, b: { sessionId: "b", modelPreference: { modelProviderId: "provider_b" } } },
    selectedModelProviderId: "provider_b",
    activeSessionId: "a",
  });
  useStore.setState(syncActiveSessionModelSelection);
  expect(useStore.getState().selectedModelProviderId).toBe("provider_a");
  expect(useStore.getState().selectedModelProviderIdsBySession).toEqual({});
  useStore.getState().selectSession("b");
  expect(useStore.getState().selectedModelProviderId).toBe("provider_b");
  useStore.getState().selectModelProvider("provider_a");
  useStore.setState((state) => {
    state.sessions.b.modelPreference = { modelProviderId: "provider_a" };
    syncActiveSessionModelSelection(state);
  });
  expect(useStore.getState().selectedModelProviderIdsBySession.b).toBeUndefined();
  useStore.setState((state) => {
    state.sessions.b.modelPreference = { modelProviderId: "provider_b" };
    syncActiveSessionModelSelection(state);
  });
  expect(useStore.getState().selectedModelProviderId).toBe("provider_b");
});

test("ingest projects tool settings snapshots without credential values", () => {
  const store = useStore.getState();
  store.ingest({
    channel: "agent.event",
    kind: EventKinds.SystemToolSnapshot,
    layer: "snapshot",
    phase: "config",
    sequence: 1,
    timestamp: "2026-08-01T00:00:00.000Z",
    data: {
      extensions: [],
      tools: [{ name: "ShellCommandTool", title: "Shell", description: "", extension: "core", loading: "always" }],
      activation: { revision: "test-system", entries: [] },
    },
  });
  store.ingest({
    channel: "agent.event",
    kind: EventKinds.McpServerSnapshot,
    layer: "snapshot",
    phase: "config",
    sequence: 2,
    timestamp: "2026-08-01T00:00:01.000Z",
    data: {
      servers: [
        {
          id: "web-research",
          packageName: "web-research",
          source: "bundled",
          transport: "stdio",
          status: "configured",
          credentials: [
            { name: "TAVILY_API_KEY", required: true, configured: true, source: "vault", updatedAt: "2026-08-01" },
          ],
        },
      ],
      activation: { revision: "test-mcp", entries: [] },
    },
  });

  expect(useStore.getState()).toMatchObject({
    toolSettingsSynced: { systemTools: true, mcpServers: true, activation: true },
    systemTools: [{ name: "ShellCommandTool" }],
    mcpServers: [
      {
        id: "web-research",
        credentials: [{ name: "TAVILY_API_KEY", configured: true, source: "vault" }],
      },
    ],
  });
  expect(useStore.getState().activationCatalog).toEqual({ revision: "test-mcp", entries: [] });
});

test("cross-window preference refresh preserves manually toggled panels when their defaults are unchanged", () => {
  useStore.setState({
    defaultSidebarCollapsed: false,
    sidebarCollapsed: true,
    rightPanelCollapsed: true,
    workflowDockWidthRatio: 0.512,
    motionLevel: "full",
    selectedModelProviderId: "provider_a",
    selectedModelProviderIdsBySession: { session_a: "provider_a" },
  });

  dispatchPersistedStorage({
    state: {
      defaultSidebarCollapsed: false,
      workflowDockWidthRatio: 0.512,
      motionLevel: "full",
      selectedModelProviderId: "provider_a",
      selectedModelProviderIdsBySession: { session_a: "provider_a" },
    },
    version: 5,
  });

  expect(useStore.getState()).toMatchObject({
    sidebarCollapsed: true,
    rightPanelCollapsed: true,
    workflowDockWidthRatio: 0.512,
  });
});

test("cross-window layout and dock-width preferences do not reopen the right panel", () => {
  useStore.setState({
    defaultSidebarCollapsed: false,
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    workflowDockWidthRatio: 0.42,
  });

  dispatchPersistedStorage({
    state: {
      defaultSidebarCollapsed: true,
      defaultRightPanelCollapsed: true,
      workflowDockWidthRatio: 0.58,
      motionLevel: useStore.getState().motionLevel,
      selectedModelProviderId: useStore.getState().selectedModelProviderId,
      selectedModelProviderIdsBySession: useStore.getState().selectedModelProviderIdsBySession,
    },
    version: 6,
  });

  expect(useStore.getState()).toMatchObject({
    defaultSidebarCollapsed: true,
    sidebarCollapsed: true,
    rightPanelCollapsed: false,
    workflowDockWidthRatio: 0.58,
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

test("moves sessions by placement and persists the custom sidebar order", async () => {
  activateWorkspaceSessionProjection("sidebar-order-workspace");
  useStore.setState({
    sessions: {
      first: { sessionId: "first" },
      second: { sessionId: "second" },
      third: { sessionId: "third" },
    },
    sessionOrder: ["first", "second", "third"],
  });

  useStore.getState().moveSession("third", "first", "before");
  expect(useStore.getState().sessionOrder).toEqual(["third", "first", "second"]);

  useStore.getState().moveSession("third", "second", "after");
  expect(useStore.getState().sessionOrder).toEqual(["first", "second", "third"]);
  await expect
    .poll(() => JSON.parse(localStorage.getItem("senera-workspace:sidebar-order-workspace"))?.sessionOrder)
    .toEqual(["first", "second", "third"]);
  expect(JSON.parse(localStorage.getItem(PERSIST_KEY)).state).not.toHaveProperty("sessionOrder");
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
          toolPlanningMode: "baml",
          stream: true,
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
          toolPlanningMode: "baml",
          stream: true,
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
  });
  expect(useStore.getState().selectedModelProviderIdsBySession.session_b).toBeUndefined();
  store.ingest(snapshot("provider_b"));
  expect(useStore.getState().selectedModelProviderId).toBe("provider_b");
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
          toolPlanningMode: "baml",
          stream: true,
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
          toolPlanningMode: "baml",
          stream: true,
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
