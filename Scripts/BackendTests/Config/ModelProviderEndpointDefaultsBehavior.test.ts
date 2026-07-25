import { describe, expect, it, vi } from "vitest";
import { projectEffectiveConfig } from "../../../Source/AgentSystem/Config/AgentConfigEffectiveProjector.js";
import {
  AgentProviderModelConfigCommandError,
  setDefaultProviderModel,
} from "../../../Source/AgentSystem/Config/AgentProviderModelConfigCommands.js";
import { AgentProviderModelDiscovery } from "../../../Source/AgentSystem/Config/AgentProviderModelDiscovery.js";
import {
  resolveModelProviderConfig,
  resolveModelProviderEndpointCatalog,
} from "../../../Source/AgentSystem/Defaults/AgentModelProviderDefaults.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("model provider endpoint defaults", () => {
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
      ModelProviderEndpoints: [{ Id: "anthropic", ApiKey: "secret" }],
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
      ModelProviderEndpoints: [{ Id: "anthropic", BaseUrl: "", Headers: {} }],
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
    ModelProviderEndpoints: [{ Id: "deepseek", ApiKey: "secret" }],
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
