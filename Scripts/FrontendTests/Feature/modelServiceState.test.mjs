import { describe, expect, it } from "vitest";
import {
  defaultModelSlotDefinitions,
  formatModelServiceDiagnosticReport,
  readDefaultAssistantModelCandidates,
  readDefaultModelSlotStates,
  readModelServiceDiagnosticGroups,
  readModelServiceState,
  readProviderModelListState,
} from "../../../Frontend/src/features/settings/sections/modelServiceState.ts";
describe("modelServiceState", () => {
  it("derives provider counts, selected provider model rows, and default assistant slot", () => {
    const section = createModelsSection();
    const state = readModelServiceState({
      catalogs: {
        openai: createCatalog("openai", [
          { id: "gpt-4.1", ownedBy: "openai" },
          { id: "gpt-4.1-mini", ownedBy: "openai" },
        ]),
      },
      configDiagnostics: [],
      draft: {
        ModelProviderEndpoints: [
          { Id: "openai", Enabled: true },
          { Id: "local", Enabled: false },
        ],
        ModelProviders: [{ Id: "openai/gpt-4.1", ProviderId: "openai", Endpoint: "chat", Model: "gpt-4.1" }],
        DefaultModelProviderId: "openai/gpt-4.1",
      },
      errors: {},
      loadingIds: {},
      section,
      selectedProviderId: "openai",
    });
    expect(state.providerCount).toBe(2);
    expect(state.enabledProviders).toBe(1);
    expect(state.selectedProvider?.Id).toBe("openai");
    expect(state.selectedProviderModelList?.rows.map((row) => row.id)).toEqual(["gpt-4.1"]);
    expect(state.selectedProviderModelList?.catalog?.models.map((row) => row.id)).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
    expect(
      state.defaultSlots.map((slot) => ({
        id: slot.definition.id,
        status: slot.status,
        selectedModel: slot.selectedModel?.Id ?? null,
      })),
    ).toEqual([{ id: "assistant", status: "ready", selectedModel: "openai/gpt-4.1" }]);
    expect(state.defaultModel?.provider?.Id).toBe("openai");
    expect(state.defaultModelStatus).toBe("可用");
  });
  it("exposes only the real assistant slot", () => {
    expect(
      defaultModelSlotDefinitions.map((definition) => ({
        id: definition.id,
        configKey: definition.configKey,
      })),
    ).toEqual([{ id: "assistant", configKey: "DefaultModelProviderId" }]);
  });
  it("leaves the default slot unset when no default model is configured", () => {
    const state = readModelServiceState({
      catalogs: {},
      configDiagnostics: [],
      draft: {
        ModelProviderEndpoints: [{ Id: "openai", Enabled: true }],
        ModelProviders: [{ Id: "openai/gpt", ProviderId: "openai", Endpoint: "chat", Model: "gpt" }],
      },
      errors: {},
      loadingIds: {},
      section: createModelsSection(),
    });

    expect(state.defaultModel).toBeNull();
    expect(state.defaultSlots[0]).toMatchObject({ status: "unset", selectedModelId: null });
  });
  it("reports disabled providers and missing default model references as diagnostics", () => {
    const section = createModelsSection();
    const state = readModelServiceState({
      catalogs: {},
      configDiagnostics: [],
      draft: {
        ModelProviderEndpoints: [{ Id: "disabled", Enabled: false }],
        ModelProviders: [{ Id: "disabled/model-a", ProviderId: "disabled", Endpoint: "chat", Model: "model-a" }],
        DefaultModelProviderId: "missing/model",
      },
      errors: {},
      loadingIds: {},
      section,
    });
    expect(state.defaultSlots[0]).toMatchObject({
      status: "missing",
      selectedModelId: "missing/model",
      statusLabel: "模型不存在",
      repairAction: "select_default",
    });
    expect(state.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "connection",
          severity: "warning",
          title: "供应商已关闭",
          affectedProviderId: "disabled",
          action: "open_connection",
        }),
        expect.objectContaining({
          group: "default_slots",
          severity: "error",
          title: "默认助手模型不可用",
          affectedModelId: "missing/model",
          action: "select_default",
        }),
      ]),
    );
  });
  it("reports provider model fetch errors without dropping configured local rows", () => {
    const section = createModelsSection();
    const state = readModelServiceState({
      catalogs: {},
      configDiagnostics: [],
      draft: {
        ModelProviderEndpoints: [{ Id: "openai", Enabled: true }],
        ModelProviders: [{ Id: "openai/local-only", ProviderId: "openai", Endpoint: "chat", Model: "local-only" }],
      },
      errors: {
        openai: {
          providerId: "openai",
          message: "401 Unauthorized",
          updatedAt: "2026-07-05T00:00:00.000Z",
        },
      },
      loadingIds: {},
      section,
    });
    expect(state.selectedProviderModelList?.rows.map((row) => row.id)).toEqual(["local-only"]);
    expect(state.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "model_list",
          severity: "error",
          title: "模型列表获取失败",
          affectedProviderId: "openai",
          action: "fetch_models",
        }),
      ]),
    );
  });
  it("marks saved secrets this host cannot decrypt as connection errors", () => {
    const state = readModelServiceState({
      catalogs: {},
      configDiagnostics: [
        unresolvedSecretDiagnostic({ kind: "provider_api_key", providerId: "main", reason: "unknown_key" }),
        unresolvedSecretDiagnostic({
          kind: "provider_header",
          providerId: "main",
          headerName: "X-Project",
          reason: "authentication_failed",
        }),
        unresolvedSecretDiagnostic({
          kind: "extension_secret",
          extensionId: "search",
          fieldPath: ["apiKey"],
          reason: "missing_key",
        }),
        { severity: "warning", message: "unrelated diagnostic" },
      ],
      draft: {
        ModelProviderEndpoints: [
          { Id: "main", Enabled: true },
          { Id: "other", Enabled: true },
        ],
        ModelProviders: [],
      },
      errors: {},
      loadingIds: {},
      section: createModelsSection(),
    });
    expect(state.unresolvedApiKeyProviderIds).toEqual(["main"]);
    const connectionItems = state.diagnostics.filter((item) => item.group === "connection");
    expect(connectionItems.map((item) => item.id)).toEqual([
      "unresolved-api-key:main",
      "unresolved-header:main:X-Project",
    ]);
    expect(connectionItems[0]).toMatchObject({
      severity: "error",
      title: "无法解密已保存的 API Key",
      detail: "main 的 API Key 在本机解密失败，重新填写并保存即可恢复。",
      affectedProviderId: "main",
      action: "open_connection",
    });
    expect(connectionItems[1]).toMatchObject({
      severity: "error",
      title: "无法解密已保存的请求头",
      detail: "main 的请求头 X-Project 在本机解密失败，重新填写并保存即可恢复。",
      affectedProviderId: "main",
      action: "open_connection",
    });
    expect(state.providerIssues).toEqual(
      expect.arrayContaining([
        { severity: "error", message: "main 的 API Key 在本机解密失败，重新填写并保存即可恢复。" },
      ]),
    );
  });
  it("keeps remote catalog models separate from configured rows", () => {
    const list = readProviderModelListState({
      catalogs: {
        openai: createCatalog("openai", [
          { id: "gpt-4.1", ownedBy: "openai" },
          { id: "text-embedding-3-small", ownedBy: "openai" },
        ]),
      },
      defaultModelId: "openai/gpt-4.1",
      errors: {},
      loadingIds: {},
      modelGroups: [
        {
          Id: "embedding",
          Label: "Embedding",
          Strategies: [{ Match: "includes", Values: ["embedding"] }],
        },
      ],
      models: [{ Id: "openai/gpt-4.1", ProviderId: "openai", Endpoint: "chat", Model: "gpt-4.1" }],
      provider: { Id: "openai", Enabled: true },
    });
    expect(list.rows.map((row) => row.id)).toEqual(["gpt-4.1"]);
    expect(list.catalog?.models.map((row) => row.id)).toEqual(["gpt-4.1", "text-embedding-3-small"]);
    expect(list.groups).toEqual([
      expect.objectContaining({
        id: "openai",
        label: "OpenAI",
        rows: [{ id: "gpt-4.1", ownedBy: "openai" }],
      }),
    ]);
  });
  it("marks selected default model as unavailable when its provider is disabled", () => {
    expect(
      readDefaultModelSlotStates({
        defaultModelId: "disabled/model-a",
        models: [{ Id: "disabled/model-a", ProviderId: "disabled", Endpoint: "chat", Model: "model-a" }],
        providers: [{ Id: "disabled", Enabled: false }],
      })[0],
    ).toMatchObject({
      status: "provider_disabled",
      statusLabel: "供应商已关闭",
      repairAction: "select_default",
    });
  });
  it("only exposes configured models from enabled providers with chat capability as default candidates", () => {
    const candidates = readDefaultAssistantModelCandidates({
      modelTemplate: {},
      providers: [
        { Id: "enabled", Enabled: true },
        { Id: "disabled", Enabled: false },
      ],
      models: [
        { Id: "enabled/chat", ProviderId: "enabled", Endpoint: "chat", Model: "chat", Capabilities: { Chat: true } },
        {
          Id: "enabled/embedding",
          ProviderId: "enabled",
          Endpoint: "chat",
          Model: "embedding",
          Capabilities: { Chat: false, Embedding: true },
        },
        { Id: "disabled/chat", ProviderId: "disabled", Endpoint: "chat", Model: "chat", Capabilities: { Chat: true } },
      ],
    });
    expect(candidates.map((candidate) => candidate.model.Id)).toEqual(["enabled/chat"]);
  });
  it("groups diagnostics and formats a copyable report", () => {
    const state = readModelServiceState({
      catalogs: {},
      configDiagnostics: [],
      draft: {
        ModelProviderEndpoints: [{ Id: "disabled", Enabled: false }],
        ModelProviders: [{ Id: "disabled/model-a", ProviderId: "disabled", Endpoint: "chat", Model: "model-a" }],
        DefaultModelProviderId: "missing/model",
      },
      errors: {
        disabled: {
          providerId: "disabled",
          message: "timeout",
          updatedAt: "2026-07-05T00:00:00.000Z",
        },
      },
      loadingIds: {},
      section: createModelsSection(),
    });
    expect(
      readModelServiceDiagnosticGroups(state.diagnostics).map((group) => ({
        id: group.id,
        count: group.items.length,
      })),
    ).toEqual([
      { id: "connection", count: 1 },
      { id: "model_list", count: 1 },
      { id: "default_slots", count: 1 },
      { id: "runtime", count: 1 },
    ]);
    expect(formatModelServiceDiagnosticReport(state.diagnostics)).toContain("[模型列表]");
    expect(formatModelServiceDiagnosticReport(state.diagnostics)).toContain("action=fetch_models");
    expect(formatModelServiceDiagnosticReport(state.diagnostics)).toContain("model=missing/model");
  });
});
function unresolvedSecretDiagnostic(details) {
  return {
    severity: "warning",
    code: "config.secretUnresolved",
    message: "backend copy",
    details,
  };
}
function createModelsSection() {
  return {
    name: "models",
    label: "模型",
    keyCount: 4,
    fields: [
      createField("ModelProviderEndpoints", []),
      createField("ModelProviders", []),
      createField("ModelGroups", undefined),
      createField("DefaultModelProviderId", undefined),
    ],
  };
}
function createField(key, effectiveValue) {
  return {
    label: key,
    section: "models",
    key,
    path: [key],
    type: "array",
    value: undefined,
    effectiveValue,
    configured: effectiveValue !== undefined,
  };
}
function createCatalog(providerId, models) {
  return {
    providerId,
    baseUrl: "https://example.test/v1",
    fetchedAt: "2026-07-05T00:00:00.000Z",
    source: "network",
    models,
  };
}
