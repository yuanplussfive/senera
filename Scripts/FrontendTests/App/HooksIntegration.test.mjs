import React, { useEffect, useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { useSandboxRuntimeStatus } from "../../../Frontend/src/app/useSandboxRuntimeStatus.ts";
import { useSessionCatalogSync } from "../../../Frontend/src/app/useSessionCatalogSync.ts";
import { useSettingsRuntime } from "../../../Frontend/src/app/useSettingsRuntime.ts";
import { useSocketPostIngestEffects } from "../../../Frontend/src/app/useSocketPostIngestEffects.ts";
import { clearTestToastCalls, readTestToastCalls } from "../mocks/sonner.mjs";
import { resolveSocketErrorToast, useSocketErrorToasts } from "../../../Frontend/src/app/useSocketErrorToasts.ts";
import { clearPersistedStore, DEFAULT_USER_PROFILE, useStore } from "../../../Frontend/src/store/sessionStore.ts";

beforeEach(() => {
  installLocalStorage();
  clearTestToastCalls();
  resetStore();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("useSandboxRuntimeStatus ingests only sandbox status snapshots", async () => {
  const handleRef = { current: null };
  render(React.createElement(SandboxHarness, { handleRef }));

  let ignored = true;
  act(() => {
    ignored = handleRef.current.ingestSandboxEvent(event(EventKinds.RunStarted, "run", { input: "x" }));
  });
  expect(ignored).toBe(false);
  expect(handleRef.current.sandboxStatus).toBe(null);

  await act(async () => {
    expect(
      handleRef.current.ingestSandboxEvent(
        event(EventKinds.SandboxStatusSnapshot, "sandbox", {
          provider: "docker-engine",
          platform: "win32",
          state: "ready",
          supported: true,
          effectiveMode: "sandbox",
          dependencies: { errors: [], warnings: [] },
          diagnostics: [],
          message: "ready",
          updatedAt: "2026-07-09T00:00:00.000Z",
        }),
      ),
    ).toBe(true);
  });

  expect(handleRef.current.sandboxStatus.state).toBe("ready");
  expect(handleRef.current.sandboxStatus.effectiveMode).toBe("sandbox");

  const acceptedStatus = handleRef.current.sandboxStatus;
  act(() => {
    expect(
      handleRef.current.ingestSandboxEvent(
        event(EventKinds.SandboxStatusSnapshot, "sandbox", { state: "future-state" }),
      ),
    ).toBe(true);
  });
  expect(handleRef.current.sandboxStatus).toBe(acceptedStatus);
});

test("useSessionCatalogSync sends open-connection and manual refresh requests", async () => {
  const send = vi.fn(() => true);
  const onServerSessionsReset = vi.fn();
  useStore.setState({
    userProfile: {
      ...DEFAULT_USER_PROFILE,
      name: "Alice",
      avatarDataUrl: null,
      updatedAt: "2026-07-09T00:00:00.000Z",
      syncState: "pending",
    },
    sessionOrder: ["session_a", "session_b"],
  });
  const handleRef = { current: null };

  render(
    React.createElement(CatalogSyncHarness, {
      status: "open",
      send,
      onServerSessionsReset,
      handleRef,
    }),
  );

  expect(onServerSessionsReset).toHaveBeenCalledTimes(1);
  expect(send.mock.calls.map(([request]) => request.type)).toEqual([
    "session.list",
    "config.get",
    "workspace.get",
    "model.list",
    "sandbox.status",
    "systemTool.list",
    "mcpServer.list",
    "runtimeDependency.list",
    "profile.update",
  ]);
  expect(send.mock.calls.at(-1)?.[0].profile.name).toBe("Alice");
  expect(readTestToastCalls()).toEqual([]);

  send.mockClear();
  act(() => handleRef.current.refreshSessionCatalog());
  expect(send.mock.calls.map(([request]) => request.type)).toEqual([
    "session.list",
    "config.get",
    "workspace.get",
    "model.list",
    "profile.get",
    "sandbox.status",
    "systemTool.list",
    "mcpServer.list",
    "runtimeDependency.list",
  ]);
});

test("useSettingsRuntime sends isolated typed MCP commands without storing Secret values", () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  useStore.setState({
    systemTools: [{ name: "ShellCommandTool", title: "Shell", description: "", extension: "core", loading: "always" }],
    systemExtensions: [],
    mcpServers: [
      {
        id: "web-research",
        packageName: "web-research",
        source: "bundled",
        descriptorKind: "mcpb",
        transport: "stdio",
        status: "needs_input",
        inputs: [],
      },
    ],
    toolSettingsSynced: { systemTools: true, mcpServers: true },
  });

  render(React.createElement(SettingsRuntimeHarness, { send, status: "open", handleRef }));

  expect(handleRef.current.systemConfig.systemTools).toHaveLength(1);
  expect(handleRef.current.systemConfig.mcpServers).toHaveLength(1);
  act(() => {
    expect(handleRef.current.systemConfig.refreshToolSettings()).toBe(true);
    expect(
      handleRef.current.systemConfig.updateMcpInputs("web-research", { TAVILY_API_KEY: "transient-secret" }, [
        "REGION",
      ]),
    ).toEqual(expect.any(String));
    expect(handleRef.current.systemConfig.restartMcpServer("web-research")).toBe(true);
  });

  expect(send.mock.calls.map(([request]) => request.type)).toEqual([
    "systemTool.list",
    "mcpServer.list",
    "mcpInput.update",
    "mcpServer.restart",
  ]);
  expect(JSON.stringify(useStore.getState())).not.toContain("transient-secret");
});

test("useSettingsRuntime settles MCP mutations from the dedicated settings event path", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  useStore.setState({
    systemTools: [],
    systemExtensions: [],
    mcpServers: [],
    toolSettingsSynced: { systemTools: true, mcpServers: true },
  });

  render(React.createElement(SettingsRuntimeHarness, { send, status: "open", handleRef }));
  let requestId;
  await act(async () => {
    requestId = handleRef.current.systemConfig.updateMcpInputs("web-research", { API_KEY: "value" });
  });

  await act(async () => {
    expect(
      handleRef.current.ingestSettingsEvent(
        event(EventKinds.McpServerSnapshot, "config", {
          servers: [],
          activation: { revision: "test-mcp", entries: [] },
          operation: { requestId, kind: "mcp_input_update" },
        }),
      ),
    ).toBe(true);
  });

  expect(handleRef.current.systemConfig.mcpInputOperation).toMatchObject({ requestId, status: "success" });
});

test("useSocketPostIngestEffects runs config reload requests and profile sync", () => {
  const send = vi.fn(() => true);
  const markUserProfileSynced = vi.fn();
  const handleRef = { current: null };

  render(
    React.createElement(PostIngestHarness, {
      send,
      markUserProfileSynced,
      handleRef,
    }),
  );

  act(() => {
    expect(handleRef.current.runSocketPostIngestEffects(event(EventKinds.ConfigReloaded, "config", {}))).toBe(true);
  });
  expect(send.mock.calls.map(([request]) => request.type)).toEqual([
    "config.get",
    "workspace.get",
    "model.list",
    "sandbox.status",
    "systemTool.list",
    "mcpServer.list",
    "runtimeDependency.list",
  ]);

  const profile = {
    name: "Senera",
    avatarDataUrl: null,
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
  act(() => {
    expect(handleRef.current.runSocketPostIngestEffects(event(EventKinds.ProfileSnapshot, "config", profile))).toBe(
      true,
    );
  });
  expect(markUserProfileSynced).toHaveBeenCalledWith(profile);
});

test("refreshes runtime usage as a run becomes observable and after it settles", () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };

  render(
    React.createElement(PostIngestHarness, {
      send,
      markUserProfileSynced: vi.fn(),
      handleRef,
    }),
  );

  act(() => {
    expect(
      handleRef.current.runSocketPostIngestEffects(
        event(EventKinds.RunStarted, "run", { input: "检查上下文" }, { sessionId: "session-1" }),
      ),
    ).toBe(true);
  });
  expect(send).toHaveBeenCalledWith({ type: "session.runtime_status", sessionId: "session-1" });

  send.mockClear();
  act(() => {
    expect(
      handleRef.current.runSocketPostIngestEffects(
        event(EventKinds.ModelStarted, "model", { model: "test-model" }, { sessionId: "session-1" }),
      ),
    ).toBe(true);
  });
  expect(send).not.toHaveBeenCalled();

  send.mockClear();
  act(() => {
    expect(
      handleRef.current.runSocketPostIngestEffects(
        event(EventKinds.SessionRuntimeStatus, "session", {
          sessionId: "session-1",
          available: true,
          runtime: { stats: { totalMessages: 2, toolCalls: 0, tokens: { total: 100 } } },
        }),
      ),
    ).toBe(true);
  });
  expect(readTestToastCalls()).toEqual([]);
  expect(send).toHaveBeenCalledWith({ type: "session.runtime_status", sessionId: "session-1" });

  send.mockClear();
  act(() => {
    expect(
      handleRef.current.runSocketPostIngestEffects(
        event(EventKinds.RunCompleted, "run", {}, { sessionId: "session-1" }),
      ),
    ).toBe(true);
  });
  expect(send).not.toHaveBeenCalled();

  act(() => {
    expect(
      handleRef.current.runSocketPostIngestEffects(
        event(EventKinds.SessionRuntimeStatus, "session", {
          sessionId: "session-1",
          available: true,
          runtime: { stats: { totalMessages: 3, toolCalls: 1, tokens: { total: 120 } } },
        }),
      ),
    ).toBe(true);
  });
  expect(send).toHaveBeenCalledWith({ type: "session.runtime_status", sessionId: "session-1" });
});

test("useSocketErrorToasts keeps contextual tool failures out of global notifications", () => {
  useStore.setState({
    sessions: {
      session_history: {
        sessionId: "session_history",
        title: "History",
        status: "ready",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
        entryCount: 0,
        messageCount: 0,
        messages: [],
        runs: [],
      },
    },
    historyLoadingIds: { session_history: true },
  });
  const handleRef = { current: null };

  render(React.createElement(SocketErrorToastHarness, { handleRef }));

  const failure = event(
    EventKinds.RunFailed,
    "run",
    { message: "history failed" },
    {
      sessionId: "session_history",
      requestId: "missing_request",
    },
  );
  expect(resolveSocketErrorToast(failure, useStore.getState())).toBeNull();
  act(() => {
    expect(handleRef.current.notifySocketError(failure)).toBe(false);
  });
  act(() => {
    expect(
      handleRef.current.notifySocketError(
        event(EventKinds.ToolCallFailed, "tool", {
          toolName: "ShellCommandTool",
          message: "exit 1",
        }),
      ),
    ).toBe(false);
  });

  expect(readTestToastCalls()).toEqual([]);
});

function SandboxHarness({ handleRef }) {
  const handle = useSandboxRuntimeStatus();
  useEffect(() => {
    handleRef.current = handle;
  });
  return null;
}

function CatalogSyncHarness({ status, send, onServerSessionsReset, handleRef }) {
  const handle = useSessionCatalogSync({
    status,
    send,
    onServerSessionsReset,
  });
  useEffect(() => {
    handleRef.current = handle;
  });
  return null;
}

function PostIngestHarness({ send, markUserProfileSynced, handleRef }) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const handle = useSocketPostIngestEffects({
    sendRef,
    markUserProfileSynced,
  });
  useEffect(() => {
    handleRef.current = handle;
  });
  return null;
}

function SocketErrorToastHarness({ handleRef }) {
  const handle = useSocketErrorToasts();
  useEffect(() => {
    handleRef.current = handle;
  });
  return null;
}

function SettingsRuntimeHarness({ send, status, handleRef }) {
  const sendRef = useRef(send);
  const statusRef = useRef(status);
  sendRef.current = send;
  statusRef.current = status;
  const handle = useSettingsRuntime({ sendRef, statusRef });
  useEffect(() => {
    handleRef.current = handle;
  });
  return null;
}

function event(kind, phase, data, overrides = {}) {
  return {
    channel: "agent.event",
    kind,
    layer: phase === "session" || phase === "config" || phase === "sandbox" ? "snapshot" : "progress",
    phase,
    sequence: 1,
    timestamp: "2026-07-09T00:00:00.000Z",
    data,
    ...overrides,
  };
}

function resetStore() {
  clearPersistedStore();
  useStore.setState({
    sessions: {},
    runtimeSnapshotsBySession: {},
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
    configSnapshot: null,
    systemTools: [],
    systemExtensions: [],
    mcpServers: [],
    toolSettingsSynced: { systemTools: false, mcpServers: false },
    userProfile: DEFAULT_USER_PROFILE,
  });
}

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
