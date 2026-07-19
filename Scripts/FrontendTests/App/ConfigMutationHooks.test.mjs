import React, { useEffect, useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { useConfigMutationController } from "../../../Frontend/src/app/useConfigMutationController.ts";
import { resolveConfigSettingsEvent } from "../../../Frontend/src/app/useConfigSettingsCommands.ts";
import { useConfigMutationTransport } from "../../../Frontend/src/app/useConfigMutationTransport.ts";
import { resolvePluginSettingsEvent } from "../../../Frontend/src/app/usePluginSettingsCommands.ts";
import { resolvePresetEvent } from "../../../Frontend/src/app/usePresetCommands.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { clearTestToastCalls, readTestToastCalls } from "../mocks/sonner.mjs";
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
  expect(readTestToastCalls()).not.toContainEqual(expect.objectContaining({ variant: "success" }));
});

test("useConfigMutationController handles offline commands and unmatched events without claiming them", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };

  render(
    React.createElement(ConfigMutationHarness, {
      send,
      status: "idle",
      handleRef,
    }),
  );

  await act(async () => {
    expect(handleRef.current.saveConfig({ AgentLoop: {} })).toBe(null);
    expect(handleRef.current.fetchProviderModels("openai")).toBeUndefined();
    expect(handleRef.current.savePluginConfig("demo", "enabled = true")).toBe(null);
    expect(handleRef.current.savePreset({ name: "default", format: "toml", content: "x = 1" })).toBe(null);
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.ConfigSnapshot, "config", { operation: { requestId: "unknown", kind: "config_update" } }),
      ),
    ).toBe(false);
  });

  expect(send).not.toHaveBeenCalled();
  expect(readTestToastCalls()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: frontendMessage("config.mainOffline") }),
      expect.objectContaining({ title: frontendMessage("config.providerModelsOffline") }),
      expect.objectContaining({ title: frontendMessage("pluginConfig.saveOffline") }),
      expect.objectContaining({ title: frontendMessage("preset.updateOffline") }),
    ]),
  );
});

test("useConfigMutationController sends refresh commands and cleans up failed sends", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(React.createElement(ConfigMutationHarness, { send, status: "open", handleRef }));

  await act(async () => {
    handleRef.current.refreshConfig();
    handleRef.current.refreshPluginConfigs();
    handleRef.current.refreshPresets();
  });
  expect(send.mock.calls.map(([request]) => request)).toEqual([
    { type: "config.get" },
    { type: "plugin.config.list" },
    { type: "preset.list" },
  ]);

  send.mockImplementation(() => false);
  await act(async () => {
    expect(handleRef.current.savePluginConfig("demo", "enabled = true")).toBe(null);
    expect(handleRef.current.savePreset({ name: "default", format: "toml", content: "x = 1" })).toBe(null);
  });
  expect(handleRef.current.pluginConfigOperations).toEqual({});
  expect(handleRef.current.presetOperations).toEqual({});
});

test("useConfigMutationController covers enabled plugins, preset mutations, and failed catalog sends", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(React.createElement(ConfigMutationHarness, { send, status: "open", handleRef }));

  let enabledRequest;
  let deletePresetRequest;
  let activePresetRequest;
  await act(async () => {
    enabledRequest = handleRef.current.setPluginEnabled("demo", true, "tool");
    deletePresetRequest = handleRef.current.deletePreset("old");
    activePresetRequest = handleRef.current.setActivePreset(null);
  });
  expect(enabledRequest).toBeTypeOf("string");
  expect(deletePresetRequest).toBeTypeOf("string");
  expect(activePresetRequest).toBeTypeOf("string");

  await act(async () => {
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.ConfigFailed, "config", {
          message: "plugin rejected",
          operation: { requestId: enabledRequest, kind: "set_enabled" },
        }),
      ),
    ).toBe(true);
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.PresetSnapshot, "config", {
          operation: { requestId: deletePresetRequest, name: "old" },
        }),
      ),
    ).toBe(true);
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.PresetFailed, "config", {
          message: "cannot activate",
          operation: { requestId: activePresetRequest, name: null },
        }),
      ),
    ).toBe(true);
  });
  expect(handleRef.current.pluginConfigOperations[enabledRequest]).toMatchObject({
    status: "error",
    kind: "set_enabled",
  });
  expect(handleRef.current.presetOperations[deletePresetRequest]).toMatchObject({ status: "success", kind: "delete" });
  expect(handleRef.current.presetOperations[activePresetRequest]).toMatchObject({
    status: "error",
    kind: "set_active",
  });

  send.mockReturnValue(false);
  await act(async () => {
    handleRef.current.fetchProviderModels("openai", true);
  });
  expect(handleRef.current.providerModelLoadingIds).toEqual({});
});

test("useConfigMutationController rejects provider model mutations without config and ignores unmatched model events", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(React.createElement(ConfigMutationHarness, { send, status: "open", handleRef }));

  await act(async () => {
    expect(
      handleRef.current.upsertProviderModel({
        model: { Id: "gpt-test", ProviderId: "openai", Name: "GPT Test" },
      }),
    ).toBe(null);
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.ConfigSnapshot, "config", {
          operation: { requestId: "unknown-model", kind: "provider.model.upsert" },
        }),
      ),
    ).toBe(false);
  });
  expect(send).not.toHaveBeenCalled();
  expect(readTestToastCalls()).toContainEqual(expect.objectContaining({ title: frontendMessage("config.mainFailed") }));
});

test("useConfigMutationController emits one offline toast when provider model config is unavailable", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(React.createElement(ConfigMutationHarness, { send, status: "idle", handleRef }));

  await act(async () => {
    expect(handleRef.current.setDefaultProviderModel("gpt-test")).toBe(null);
  });

  expect(readTestToastCalls()).toHaveLength(1);
  expect(readTestToastCalls()[0]).toEqual(expect.objectContaining({ title: frontendMessage("config.mainOffline") }));
});

test("useConfigMutationController covers provider model commands and acknowledgements", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  const configSnapshot = {
    path: "Config.toml",
    version: 1,
    revision: 4,
    value: {},
    source: "sqlite",
    diagnostics: [],
    form: { version: 1, sections: [] },
  };
  render(React.createElement(ConfigMutationHarness, { configSnapshot, send, status: "open", handleRef }));

  let upsertId;
  let deleteId;
  let defaultId;
  await act(async () => {
    upsertId = handleRef.current.upsertProviderModel({
      model: { Id: "gpt", ProviderId: "openai", Name: "GPT" },
      group: "chat",
    });
    deleteId = handleRef.current.deleteProviderModel({ modelId: "old", providerId: "openai" });
    defaultId = handleRef.current.setDefaultProviderModel("gpt");
  });
  expect(send).toHaveBeenCalledTimes(3);
  await act(async () => {
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigSnapshot, "config", { operation: { requestId: upsertId, kind: "provider.model.upsert" } }),
    );
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigFailed, "config", {
        message: "delete failed",
        operation: { requestId: deleteId, kind: "provider.model.delete" },
      }),
    );
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigSnapshot, "config", {
        operation: { requestId: defaultId, kind: "provider.defaultModel.set" },
      }),
    );
  });
  expect(handleRef.current.providerModelOperations.gpt.status).toBe("success");
  expect(handleRef.current.providerModelOperations.old.status).toBe("error");
});

test("useConfigMutationController confirms enabled-plugin and active-preset successes", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(React.createElement(ConfigMutationHarness, { send, status: "open", handleRef }));
  let pluginId;
  let presetId;
  await act(async () => {
    pluginId = handleRef.current.setPluginEnabled("demo", false);
    presetId = handleRef.current.setActivePreset("default");
  });
  await act(async () => {
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.PluginConfigSnapshot, "config", { operation: { requestId: pluginId } }),
    );
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.PresetSnapshot, "config", { operation: { requestId: presetId, name: "default" } }),
    );
  });
  expect(handleRef.current.pluginConfigOperations[pluginId]).toMatchObject({ status: "success", kind: "set_enabled" });
  expect(handleRef.current.presetOperations[presetId]).toMatchObject({ status: "success", kind: "set_active" });
});

test("useConfigMutationController rolls back provider model sends that disconnect", async () => {
  const send = vi.fn(() => false);
  const handleRef = { current: null };
  const configSnapshot = {
    path: "Config.toml",
    version: 1,
    revision: 4,
    value: {},
    source: "sqlite",
    diagnostics: [],
    form: { version: 1, sections: [] },
  };
  render(React.createElement(ConfigMutationHarness, { configSnapshot, send, status: "open", handleRef }));
  await act(async () => {
    expect(handleRef.current.deleteProviderModel({ modelId: "old", providerId: "openai" })).toBe(null);
  });
  expect(handleRef.current.providerModelOperations).toEqual({});
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({ title: frontendMessage("config.mainDisconnected") }),
  );
});

test("plugin event resolver ignores unrelated events", () => {
  expect(resolvePluginSettingsEvent(event(EventKinds.RunStarted, "run", { input: "x" }), new Set())).toBe(null);
});

test("app mutation event resolvers cover success and failure projections", () => {
  const pending = new Set(["request-1"]);
  expect(
    resolvePluginSettingsEvent(
      event(EventKinds.PluginConfigSnapshot, "config", { operation: { requestId: "request-1" } }),
      pending,
    ),
  ).toMatchObject({ kind: "plugin_config_success" });
  expect(
    resolvePresetEvent(
      event(EventKinds.PresetSnapshot, "config", { operation: { requestId: "request-1", name: "default" } }),
      pending,
    ),
  ).toMatchObject({ kind: "preset_success" });
  expect(
    resolveConfigSettingsEvent(
      event(EventKinds.ConfigSnapshot, "config", { operation: { requestId: "request-1", kind: "config_update" } }),
      pending,
    ),
  ).toMatchObject({ kind: "config_update_success" });
});

test("useConfigMutationTransport exposes open and offline transport paths", () => {
  const send = vi.fn(() => true);
  const sendRef = { current: send };
  const statusRef = { current: "open" };
  const handleRef = { current: null };
  render(React.createElement(TransportHarness, { sendRef, statusRef, handleRef }));
  expect(handleRef.current.sendWhenOpen({ type: "config.get" })).toBe(true);
  expect(handleRef.current.readOpenTransport("offline")).toBe(send);
  statusRef.current = "idle";
  expect(handleRef.current.sendWhenOpen({ type: "config.get" })).toBe(false);
  expect(handleRef.current.readOpenTransport("offline")).toBe(null);
});

test("useConfigMutationController routes preset and main config acknowledgements to their owning domains", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(
    React.createElement(ConfigMutationHarness, {
      configSnapshot: createConfigSnapshot(),
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
    expect.arrayContaining([expect.objectContaining({ variant: "success", title: frontendMessage("preset.saved") })]),
  );
  expect(readTestToastCalls()).not.toContainEqual(
    expect.objectContaining({ variant: "success", title: frontendMessage("config.mainSaved") }),
  );
});

test("useConfigMutationController rolls back disconnected sends and records provider failures", async () => {
  const send = vi.fn(() => false);
  const handleRef = { current: null };

  render(
    React.createElement(ConfigMutationHarness, {
      configSnapshot: createConfigSnapshot(),
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
  expect(readTestToastCalls()).not.toContainEqual(
    expect.objectContaining({ variant: "success", title: "供应商连接已保存" }),
  );
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "error",
      title: "供应商重命名失败",
      options: { description: "stale revision" },
    }),
  );
});
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

function createConfigSnapshot(overrides = {}) {
  return {
    path: "Config.toml",
    version: 1,
    revision: 4,
    value: {},
    source: "sqlite",
    diagnostics: [],
    form: { version: 1, sections: [] },
    ...overrides,
  };
}

function TransportHarness({ sendRef, statusRef, handleRef }) {
  const handle = useConfigMutationTransport({ sendRef, statusRef });
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
