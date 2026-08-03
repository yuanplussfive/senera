import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { resolvePresetEvent } from "../../../Frontend/src/app/usePresetCommands.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import { clearTestToastCalls, readTestToastCalls } from "../mocks/sonner.mjs";
import {
  ConfigMutationHarness,
  configMutationEvent as event,
  createConfigSnapshot,
} from "./configMutationTestHarness.mjs";

beforeEach(() => {
  installMemoryLocalStorage();
  clearTestToastCalls();
  resetFrontendStore();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
    expect(
      handleRef.current.fetchProviderModels("openai", false, {
        Id: "openai",
        ApiKey: "secret",
      }),
    ).toBeUndefined();
    expect(handleRef.current.savePreset({ name: "default", format: "toml", content: "x = 1" })).toBe(null);
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.ConfigSnapshot, "config", { operation: { commandId: "unknown", kind: "config_update" } }),
      ),
    ).toBe(false);
  });

  expect(send).not.toHaveBeenCalled();
  expect(readTestToastCalls()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: frontendMessage("config.mainOffline") }),
      expect.objectContaining({ title: frontendMessage("config.providerModelsOffline") }),
      expect.objectContaining({ title: frontendMessage("preset.updateOffline") }),
    ]),
  );
});

test("useConfigMutationController starts header-only model discovery without an API key", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };

  render(React.createElement(ConfigMutationHarness, { send, status: "open", handleRef }));

  await act(async () => {
    handleRef.current.fetchProviderModels("openai", true, {
      Id: "openai",
      BaseUrl: "https://api.openai.com/v1",
      Headers: { "x-api-key": "header-secret" },
    });
  });

  expect(send).toHaveBeenCalledWith({
    type: "provider.models.fetch",
    providerId: "openai",
    force: true,
    endpoint: {
      Id: "openai",
      BaseUrl: "https://api.openai.com/v1",
      Headers: { "x-api-key": "header-secret" },
    },
  });
  expect(handleRef.current.providerModelLoadingIds.openai).toBe(true);
});

test("useConfigMutationController ignores execution resource list snapshots without treating them as config commands", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };

  render(React.createElement(ConfigMutationHarness, { send, status: "open", handleRef }));

  await act(async () => {
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(
          EventKinds.ExecutionResourceSnapshot,
          "tool",
          { operation: "list", resources: [] },
          { sessionId: "session-1" },
        ),
      ),
    ).toBe(false);
    expect(
      handleRef.current.ingestConfigMutationEvent(
        event(EventKinds.ConfigSnapshot, "config", {
          ...createConfigSnapshot(),
          operation: "list",
        }),
      ),
    ).toBe(false);
  });
});

test("useConfigMutationController sends refresh commands and cleans up failed sends", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(React.createElement(ConfigMutationHarness, { send, status: "open", handleRef }));

  await act(async () => {
    handleRef.current.refreshConfig();
    handleRef.current.refreshPresets();
  });
  expect(send.mock.calls.map(([request]) => request)).toEqual([{ type: "config.get" }, { type: "preset.list" }]);

  send.mockImplementation(() => false);
  await act(async () => {
    expect(handleRef.current.savePreset({ name: "default", format: "toml", content: "x = 1" })).toBe(null);
  });
  expect(handleRef.current.presetOperations).toEqual({});
});

test("useConfigMutationController covers preset mutations and failed catalog sends", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(React.createElement(ConfigMutationHarness, { send, status: "open", handleRef }));

  let deletePresetRequest;
  let activePresetRequest;
  await act(async () => {
    deletePresetRequest = handleRef.current.deletePreset("old");
    activePresetRequest = handleRef.current.setActivePreset(null);
  });
  expect(deletePresetRequest).toBeTypeOf("string");
  expect(activePresetRequest).toBeTypeOf("string");

  await act(async () => {
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
  expect(handleRef.current.presetOperations[deletePresetRequest]).toMatchObject({ status: "success", kind: "delete" });
  expect(handleRef.current.presetOperations[activePresetRequest]).toMatchObject({
    status: "error",
    kind: "set_active",
  });

  send.mockReturnValue(false);
  await act(async () => {
    handleRef.current.fetchProviderModels("openai", true, { Id: "openai", ApiKey: "secret" });
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
          operation: { commandId: "unknown-model", kind: "provider.model.upsert" },
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
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => {
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigSnapshot, "config", { operation: { commandId: upsertId, kind: "provider.model.upsert" } }),
    );
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigFailed, "config", {
        message: "delete failed",
        operation: { commandId: deleteId, kind: "provider.model.delete" },
      }),
    );
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigSnapshot, "config", {
        operation: { commandId: defaultId, kind: "provider.defaultModel.set" },
      }),
    );
  });
  expect(send).toHaveBeenCalledTimes(3);
  expect(handleRef.current.providerModelOperations.gpt.status).toBe("success");
  expect(handleRef.current.providerModelOperations.old.status).toBe("error");
});

test("useConfigMutationController confirms active-preset successes", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(React.createElement(ConfigMutationHarness, { send, status: "open", handleRef }));
  let presetId;
  await act(async () => {
    presetId = handleRef.current.setActivePreset("default");
  });
  await act(async () => {
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.PresetSnapshot, "config", { operation: { requestId: presetId, name: "default" } }),
    );
  });
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

test("preset event resolver covers success projections", () => {
  const pending = new Set(["request-1"]);
  expect(
    resolvePresetEvent(
      event(EventKinds.PresetSnapshot, "config", { operation: { requestId: "request-1", name: "default" } }),
      pending,
    ),
  ).toMatchObject({ kind: "preset_success" });
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
          operation: { commandId: configRequestId, kind: "config_update" },
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
    handleRef.current.fetchProviderModels("openai", true, { Id: "openai", ApiKey: "secret" });
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
      commandId: upsertRequestId,
    },
  ]);
  expect(send.mock.calls.every(([request]) => request.type !== "config.update" && !("config" in request))).toBe(true);
  expect(handleRef.current.providerEndpointOperations["custom-openai"]).toEqual(
    expect.objectContaining({
      commandId: upsertRequestId,
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
          commandId: upsertRequestId,
          kind: "provider.endpoint.upsert",
        },
      }),
    );
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigFailed, "config", {
        configPath: "Config.toml",
        message: "stale revision",
        operation: {
          commandId: renameRequestId,
          kind: "provider.endpoint.rename",
        },
      }),
    );
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigSnapshot, "config", {
        ...configSnapshot,
        operation: {
          commandId: deleteRequestId,
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
