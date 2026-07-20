import React, { useEffect, useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { useConfigMutationController } from "../../../Frontend/src/app/useConfigMutationController.ts";
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

test("useConfigMutationController tracks plugin config requests through success snapshots", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };

  render(
    React.createElement(ConfigMutationHarness, {
      send,
      status: "open",
      handleRef,
    }),
  );

  let requestId = null;
  await act(async () => {
    requestId = handleRef.current.savePluginConfig("WeatherToolPlugin", "Enabled = true");
  });

  expect(requestId).toEqual(expect.any(String));
  expect(send).toHaveBeenLastCalledWith({
    type: "plugin.config.update",
    requestId,
    pluginName: "WeatherToolPlugin",
    toml: "Enabled = true",
  });
  expect(handleRef.current.pluginConfigOperations[requestId]).toEqual(
    expect.objectContaining({
      pluginName: "WeatherToolPlugin",
      kind: "update",
      status: "pending",
    }),
  );

  await act(async () => {
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.PluginConfigSnapshot, "config", {
          plugins: [],
          operation: {
            requestId,
            kind: "update",
            pluginName: "WeatherToolPlugin",
          },
        }),
      ),
    ).toBe(true);
  });

  expect(handleRef.current.pluginConfigOperations[requestId]).toEqual(
    expect.objectContaining({
      kind: "update",
      status: "success",
    }),
  );
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "success",
      title: "插件配置已保存",
    }),
  );
});

test("useConfigMutationController routes preset and main config acknowledgements to their owning domains", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(
    React.createElement(ConfigMutationHarness, {
      send,
      status: "open",
      handleRef,
    }),
  );

  let presetRequestId = null;
  let configRequestId = null;
  await act(async () => {
    presetRequestId = handleRef.current.savePreset({
      name: "Release notes",
      format: "markdown",
      content: "# Notes",
      activate: true,
    });
    configRequestId = handleRef.current.saveConfig({ AgentLoop: { Mode: "automatic" } });
  });

  expect(presetRequestId).toEqual(expect.any(String));
  expect(configRequestId).toEqual(expect.any(String));
  expect(handleRef.current.presetOperations[presetRequestId]).toMatchObject({ status: "pending", kind: "save" });
  expect(handleRef.current.configOperation).toMatchObject({ status: "pending", kind: "config_update" });

  await act(async () => {
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.PresetSnapshot, "config", {
          presets: [],
          operation: { requestId: presetRequestId, kind: "save", name: "Release notes" },
        }),
      ),
    ).toBe(true);
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.ConfigSnapshot, "config", {
          config: {},
          operation: { requestId: configRequestId, kind: "config_update" },
        }),
      ),
    ).toBe(true);
  });

  expect(handleRef.current.presetOperations[presetRequestId]).toMatchObject({ status: "success", kind: "save" });
  expect(handleRef.current.configOperation).toMatchObject({ status: "success", kind: "config_update" });
  expect(readTestToastCalls()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ variant: "success", title: frontendMessage("preset.saved") }),
      expect.objectContaining({ variant: "success", title: frontendMessage("config.mainSaved") }),
    ]),
  );
});

test("useConfigMutationController rolls back disconnected sends and records provider failures", async () => {
  const send = vi.fn(() => false);
  const handleRef = { current: null };

  render(
    React.createElement(ConfigMutationHarness, {
      send,
      status: "open",
      handleRef,
    }),
  );

  let requestId = "not-run";
  await act(async () => {
    requestId = handleRef.current.saveConfig({ AgentLoop: {} });
  });

  expect(requestId).toBe(null);
  expect(handleRef.current.configOperation).toBe(null);
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "error",
      title: "主配置保存失败，连接可能已断开",
    }),
  );

  send.mockReturnValue(true);
  await act(async () => {
    handleRef.current.fetchProviderModels("openai", true);
  });
  expect(handleRef.current.providerModelLoadingIds.openai).toBe(true);

  await act(async () => {
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.ProviderModelsFailed, "config", {
          providerId: "openai",
          message: "bad endpoint",
          models: [],
        }),
      ),
    ).toBe(true);
  });

  expect(handleRef.current.providerModelLoadingIds.openai).toBeUndefined();
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "error",
      title: "模型列表检测失败",
      options: { description: "bad endpoint" },
    }),
  );
});

test("useConfigMutationController sends guarded provider endpoint commands and tracks provider state", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  const configSnapshot = {
    path: "Config.toml",
    version: 7,
    revision: 31,
    value: {},
    source: "sqlite",
    diagnostics: [],
    form: { version: 1, sections: [] },
  };

  render(
    React.createElement(ConfigMutationHarness, {
      configSnapshot,
      send,
      status: "open",
      handleRef,
    }),
  );

  let upsertRequestId;
  let renameRequestId;
  let deleteRequestId;
  await act(async () => {
    upsertRequestId = handleRef.current.upsertProviderEndpoint({
      Id: "custom-openai",
      Icon: "sparkles",
      Kind: "OpenAICompatible",
    });
    renameRequestId = handleRef.current.renameProviderEndpoint("custom-old", "custom-new");
    deleteRequestId = handleRef.current.deleteProviderEndpoint("custom-delete", {
      cascadeModels: true,
    });
  });

  expect(send.mock.calls.map(([request]) => request)).toEqual([
    {
      type: "provider.endpoint.upsert",
      endpoint: {
        Id: "custom-openai",
        Icon: "sparkles",
        Kind: "OpenAICompatible",
      },
      expectedRevision: 31,
      requestId: upsertRequestId,
      mirrorJson: true,
    },
    {
      type: "provider.endpoint.rename",
      providerId: "custom-old",
      nextProviderId: "custom-new",
      expectedRevision: 31,
      requestId: renameRequestId,
      mirrorJson: true,
    },
    {
      type: "provider.endpoint.delete",
      providerId: "custom-delete",
      cascadeModels: true,
      expectedRevision: 31,
      requestId: deleteRequestId,
      mirrorJson: true,
    },
  ]);
  expect(send.mock.calls.every(([request]) => request.type !== "config.update" && !("config" in request))).toBe(true);
  expect(handleRef.current.providerEndpointOperations["custom-openai"]).toEqual(
    expect.objectContaining({
      requestId: upsertRequestId,
      kind: "provider.endpoint.upsert",
      status: "pending",
    }),
  );

  await act(async () => {
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigSnapshot, "config", {
        ...configSnapshot,
        revision: 32,
        operation: {
          requestId: upsertRequestId,
          kind: "provider.endpoint.upsert",
        },
      }),
    );
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigFailed, "config", {
        configPath: "Config.toml",
        message: "stale revision",
        operation: {
          requestId: renameRequestId,
          kind: "provider.endpoint.rename",
        },
      }),
    );
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigSnapshot, "config", {
        ...configSnapshot,
        operation: {
          requestId: deleteRequestId,
          kind: "provider.model.delete",
        },
      }),
    );
  });

  expect(handleRef.current.providerEndpointOperations["custom-openai"].status).toBe("success");
  expect(handleRef.current.providerEndpointOperations["custom-old"]).toEqual(
    expect.objectContaining({
      status: "error",
      message: "stale revision",
    }),
  );
  expect(handleRef.current.providerEndpointOperations["custom-delete"].status).toBe("pending");
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "success",
      title: "供应商连接已保存",
    }),
  );
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "error",
      title: "供应商重命名失败",
      options: { description: "stale revision" },
    }),
  );
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

function ConfigMutationHarness({ configSnapshot = null, send, status, handleRef }) {
  const sendRef = useRef(send);
  const statusRef = useRef(status);
  sendRef.current = send;
  statusRef.current = status;
  const handle = useConfigMutationController({
    configSnapshot,
    sendRef,
    statusRef,
  });
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
    historyActiveRequestIds: {},
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
