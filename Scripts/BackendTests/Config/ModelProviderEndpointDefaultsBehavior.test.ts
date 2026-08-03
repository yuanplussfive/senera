import { describe, expect, it, vi } from "vitest";
import { projectEffectiveConfig } from "../../../Source/AgentSystem/Config/AgentConfigEffectiveProjector.js";
import {
  AgentProviderModelConfigCommandError,
  setDefaultProviderModel,
} from "../../../Source/AgentSystem/Config/AgentProviderModelConfigCommands.js";
import { AgentProviderModelDiscovery } from "../../../Source/AgentSystem/Config/AgentProviderModelDiscovery.js";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";
import {
  resolveModelProviderConfig,
  resolveModelProviderEndpointCatalog,
  resolveModelProviderEndpointConfigs,
} from "../../../Source/AgentSystem/Defaults/AgentModelProviderDefaults.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("model provider endpoint defaults", () => {
  it("keeps built-in endpoints disabled until they are explicitly configured", () => {
    expect(resolveModelProviderEndpointConfigs({ ModelProviders: [] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Id: "openai", Enabled: false }),
        expect.objectContaining({ Id: "deepseek", Enabled: false }),
        expect.objectContaining({ Id: "anthropic", Enabled: false }),
        expect.objectContaining({ Id: "gemini", Enabled: false }),
      ]),
    );
  });

  it("preserves v5 endpoint availability while keeping explicit disables", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 5,
      ModelProviderEndpoints: [
        { Id: "configured", BaseUrl: "https://configured.example.test/v1" },
        { Id: "disabled", Enabled: false },
      ],
      ModelProviders: [
        { Id: "configured/chat", ProviderId: "configured", Endpoint: "ChatCompletions", Model: "chat" },
        { Id: "built-in/chat", ProviderId: "openai", Endpoint: "ChatCompletions", Model: "chat" },
      ],
    });

    expect(migrated?.targetVersion).toBe(CurrentAgentConfigVersion);
    expect(migrated?.config).toMatchObject({
      ConfigVersion: CurrentAgentConfigVersion,
      ModelProviderEndpoints: [
        { Id: "configured", Enabled: true },
        { Id: "disabled", Enabled: false },
        { Id: "openai", Enabled: true },
      ],
    });
  });

  it("uses the same effective built-in endpoint for UI projection and model runtime", () => {
    const config = deepSeekConfig();
    const endpoint = resolveModelProviderEndpointCatalog(config).resolve("deepseek");

    expect(endpoint).toMatchObject({
      Id: "deepseek",
      BaseUrl: "https://api.deepseek.com/v1",
      ApiKey: "secret",
    });
    expect(projectEffectiveConfig(config).ModelProviderEndpoints?.find((item) => item.Id === "deepseek")).toEqual(
      endpoint,
    );
    expect(resolveModelProviderConfig(config)).toMatchObject({
      ProviderId: "deepseek",
      BaseUrl: "https://api.deepseek.com/v1",
      ApiKey: "secret",
    });
  });

  it("inherits omitted headers but respects explicit empty headers and base URLs", () => {
    const inherited = resolveModelProviderEndpointCatalog({
      ...deepSeekConfig(),
      ModelProviderEndpoints: [{ Id: "anthropic", Enabled: true, ApiKey: "secret" }],
      ModelProviders: [
        {
          Id: "anthropic-chat",
          ProviderId: "anthropic",
          Endpoint: "ChatCompletions",
          Model: "claude",
        },
      ],
      DefaultModelProviderId: "anthropic-chat",
    }).resolve("anthropic");
    expect(inherited.Headers).toEqual({ "anthropic-version": "2023-06-01" });

    const explicit = resolveModelProviderEndpointCatalog({
      ...deepSeekConfig(),
      ModelProviderEndpoints: [{ Id: "anthropic", Enabled: true, BaseUrl: "", Headers: {} }],
    }).resolve("anthropic");
    expect(explicit.BaseUrl).toBe("");
    expect(explicit.Headers).toEqual({});
  });

  it("discovers models through the effective persisted endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const discovery = new AgentProviderModelDiscovery({ configSnapshot: deepSeekConfig, fetchImpl });

    await expect(discovery.listProviderModels({ providerId: "deepseek" })).resolves.toMatchObject({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      models: [{ id: "deepseek-chat" }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.deepseek.com/v1/models"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer secret");
  });

  it("does not cache ad hoc endpoint credentials", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ data: [{ id: "secured-model" }] }));
    const discovery = new AgentProviderModelDiscovery({ configSnapshot: deepSeekConfig, fetchImpl });
    const endpoint = {
      Id: "custom",
      Enabled: true,
      BaseUrl: "https://models.example.test/v1",
      ApiKey: "first-secret",
    };

    await expect(discovery.listProviderModels({ providerId: "custom", endpoint })).resolves.toMatchObject({
      source: "network",
    });
    await expect(discovery.listProviderModels({ providerId: "custom", endpoint })).resolves.toMatchObject({
      source: "network",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("invalidates persisted endpoint discovery when its config revision changes", async () => {
    let revision = 1;
    let apiKey = "first-secret";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ data: [{ id: "secured-model" }] }));
    const discovery = new AgentProviderModelDiscovery({
      configSnapshot: () => ({
        ModelProviderEndpoints: [
          {
            Id: "custom",
            Enabled: true,
            BaseUrl: "https://models.example.test/v1",
            ApiKey: apiKey,
          },
        ],
        ModelProviders: [],
      }),
      configRevision: () => revision,
      fetchImpl,
    });

    await expect(discovery.listProviderModels({ providerId: "custom" })).resolves.toMatchObject({ source: "network" });
    await expect(discovery.listProviderModels({ providerId: "custom" })).resolves.toMatchObject({ source: "cache" });
    apiKey = "second-secret";
    revision = 2;
    await expect(discovery.listProviderModels({ providerId: "custom" })).resolves.toMatchObject({ source: "network" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("expires and evicts provider discovery snapshots under an explicit cache policy", async () => {
    let now = 0;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ data: [{ id: "model-a" }] }));
    const discovery = new AgentProviderModelDiscovery({
      configSnapshot: deepSeekConfig,
      fetchImpl,
      cache: { maxEntries: 1, ttlMs: 100 },
      now: () => now,
    });
    const endpoint = (id: string) => ({
      Id: id,
      Enabled: true,
      BaseUrl: `https://${id}.example.test/v1`,
    });

    await discovery.listProviderModels({ providerId: "provider-a", endpoint: endpoint("provider-a") });
    await expect(
      discovery.listProviderModels({ providerId: "provider-a", endpoint: endpoint("provider-a") }),
    ).resolves.toMatchObject({ source: "cache" });
    await discovery.listProviderModels({ providerId: "provider-b", endpoint: endpoint("provider-b") });
    await discovery.listProviderModels({ providerId: "provider-a", endpoint: endpoint("provider-a") });
    now = 101;
    await discovery.listProviderModels({ providerId: "provider-a", endpoint: endpoint("provider-a") });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("discovers models through a header-only endpoint without an API key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: "header-auth-model" }] }));
    const discovery = new AgentProviderModelDiscovery({
      configSnapshot: () => ({
        ModelProviderEndpoints: [
          {
            Id: "custom",
            Enabled: true,
            BaseUrl: "https://models.example.test/v1",
            Headers: { "X-API-Key": "header-secret" },
          },
        ],
        ModelProviders: [],
      }),
      fetchImpl,
    });

    await expect(discovery.listProviderModels({ providerId: "custom" })).resolves.toMatchObject({
      models: [{ id: "header-auth-model" }],
    });
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-api-key")).toBe("header-secret");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("accept")).toBe("application/json");
  });

  it("preserves an explicit authorization header when an API key is also configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
    const discovery = new AgentProviderModelDiscovery({
      configSnapshot: () => ({
        ModelProviderEndpoints: [
          {
            Id: "custom",
            Enabled: true,
            BaseUrl: "https://models.example.test/v1",
            ApiKey: "fallback-key",
            Headers: { Authorization: "Basic custom-authorization" },
          },
        ],
        ModelProviders: [],
      }),
      fetchImpl,
    });

    await discovery.listProviderModels({ providerId: "custom" });
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Basic custom-authorization");
  });

  it("rejects a default model whose custom endpoint has no effective base URL", () => {
    const config: AgentSystemConfig = {
      ModelProviderEndpoints: [{ Id: "custom", ApiKey: "secret" }],
      ModelProviders: [
        {
          Id: "custom-chat",
          ProviderId: "custom",
          Endpoint: "ChatCompletions",
          Model: "custom-model",
        },
      ],
    };

    expect(() => setDefaultProviderModel(config, { commandId: "command-1", modelId: "custom-chat" })).toThrowError(
      expect.objectContaining<Partial<AgentProviderModelConfigCommandError>>({
        code: "default_model_provider_base_url_empty",
      }),
    );
  });

  it.each([
    {
      name: "disabled endpoint",
      config: {
        ModelProviderEndpoints: [{ Id: "deepseek", Enabled: false }],
        ModelProviders: [
          {
            Id: "deepseek-chat",
            ProviderId: "deepseek",
            Endpoint: "ChatCompletions" as const,
            Model: "deepseek-chat",
          },
        ],
      },
      code: "default_model_provider_disabled",
    },
    {
      name: "empty model name",
      config: {
        ModelProviderEndpoints: [{ Id: "custom", BaseUrl: "https://models.example.test/v1" }],
        ModelProviders: [
          {
            Id: "custom-chat",
            ProviderId: "custom",
            Endpoint: "ChatCompletions" as const,
            Model: "   ",
          },
        ],
      },
      code: "default_model_name_empty",
    },
  ])("rejects a default model with $name", ({ config, code }) => {
    expect(() =>
      setDefaultProviderModel(config, {
        commandId: `command-${code}`,
        modelId: config.ModelProviders[0].Id,
      }),
    ).toThrowError(expect.objectContaining<Partial<AgentProviderModelConfigCommandError>>({ code }));
  });
});

function deepSeekConfig(): AgentSystemConfig {
  return {
    DefaultModelProviderId: "deepseek-chat",
    ModelProviderEndpoints: [{ Id: "deepseek", Enabled: true, ApiKey: "secret" }],
    ModelProviders: [
      {
        Id: "deepseek-chat",
        ProviderId: "deepseek",
        Endpoint: "ChatCompletions",
        Model: "deepseek-chat",
      },
    ],
  };
}
