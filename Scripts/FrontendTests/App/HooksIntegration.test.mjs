import React, { useEffect, useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { useConfigMutationController } from "../../../Frontend/src/app/useConfigMutationController.ts";
import { resolvePluginSettingsEvent } from "../../../Frontend/src/app/usePluginSettingsCommands.ts";
import { resolvePresetEvent } from "../../../Frontend/src/app/usePresetCommands.ts";
import { resolveConfigSettingsEvent } from "../../../Frontend/src/app/useConfigSettingsCommands.ts";
import { useConfigMutationTransport } from "../../../Frontend/src/app/useConfigMutationTransport.ts";
import { useSandboxRuntimeStatus } from "../../../Frontend/src/app/useSandboxRuntimeStatus.ts";
import { useSessionCatalogSync } from "../../../Frontend/src/app/useSessionCatalogSync.ts";
import { useSocketPostIngestEffects } from "../../../Frontend/src/app/useSocketPostIngestEffects.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
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
          provider: "microsandbox",
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
    "model.list",
    "plugin.config.list",
    "preset.list",
    "sandbox.status",
    "profile.update",
  ]);
  expect(send.mock.calls.at(-1)?.[0].profile.name).toBe("Alice");
  expect(readTestToastCalls()).toEqual([
    expect.objectContaining({
      variant: "success",
      title: "恢复 2 个会话",
    }),
  ]);

  send.mockClear();
  act(() => handleRef.current.refreshSessionCatalog());
  expect(send.mock.calls.map(([request]) => request.type)).toEqual([
    "session.list",
    "config.get",
    "model.list",
    "plugin.config.list",
    "preset.list",
    "profile.get",
    "sandbox.status",
  ]);
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
    "model.list",
    "plugin.config.list",
    "preset.list",
    "sandbox.status",
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

test("useSocketErrorToasts resolves history failures and tool failures from store state", () => {
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
  expect(resolveSocketErrorToast(failure, useStore.getState()).title).toBe("历史同步失败");
  act(() => {
    expect(handleRef.current.notifySocketError(failure)).toBe(true);
  });
  act(() => {
    expect(
      handleRef.current.notifySocketError(
        event(EventKinds.ToolCallFailed, "tool", {
          toolName: "ShellCommandTool",
          message: "exit 1",
        }),
      ),
    ).toBe(true);
  });

  expect(readTestToastCalls()).toEqual([
    expect.objectContaining({
      variant: "error",
      title: "历史同步失败",
    }),
    expect.objectContaining({
      variant: "error",
      title: "工具调用失败: ShellCommandTool",
    }),
  ]);
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
