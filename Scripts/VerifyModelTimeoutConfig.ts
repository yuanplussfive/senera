import assert from "node:assert/strict";
import { AgentSystemConfigSchema } from "../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import {
  resolveActionPlannerConfig,
  resolveAgentDefaults,
  resolveCliConfig,
  resolveFrontendConfig,
  resolveModelProviderConfig,
  resolvePersistenceConfig,
  resolvePluginDiscoveryConfig,
  resolvePluginRootsConfig,
  resolveToolExecutionConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const baseConfig = {
  ModelProviderEndpoints: [{
    Id: "test-endpoint",
    BaseUrl: "https://example.test/v1",
    ApiKey: "test",
  }],
  Cli: {
    Display: {
      DetailMode: "tools",
    },
  },
  ModelProviders: [{
    Id: "test",
    ProviderId: "test-endpoint",
    Endpoint: "Responses",
    Model: "test-model",
  }],
} satisfies AgentSystemConfig;

function parseConfig(config: AgentSystemConfig): AgentSystemConfig {
  return AgentSystemConfigSchema.parse(config);
}

const parsedBase = parseConfig(baseConfig);
assert.deepEqual(resolvePluginRootsConfig(parsedBase), {
  System: ["./System/Plugins"],
  User: ["./Plugins"],
});
assert.deepEqual(resolvePluginDiscoveryConfig(parsedBase), {
  ManifestFileName: "PluginManifest.json",
  ConfigFileName: "PluginConfig.toml",
});
assert.deepEqual(resolvePersistenceConfig(parsedBase), {
  Kind: "sqlite",
  DatabasePath: ".senera/senera.db",
});
assert.equal(resolveToolExecutionConfig(parsedBase).TimeoutMs, 120000);
assert.equal(resolveCliConfig(parsedBase).Display?.DetailMode, "tools");
assert.equal(resolveCliConfig(parsedBase).Connection?.Url, "ws://127.0.0.1:8787");

const configuredDefaults = parseConfig({
  ...baseConfig,
  Defaults: {
    PluginRoots: {
      System: ["./SystemTools"],
      User: ["./ExternalTools"],
    },
    Cli: {
      Connection: {
        Url: "ws://127.0.0.1:9797",
      },
      Display: {
        PreviewTokenLimit: 80,
      },
    },
    ToolExecution: {
      TimeoutSeconds: 90,
    },
    ActionPlanner: {
      Client: {
        Temperature: 0.3,
      },
    },
    Frontend: {
      DevServer: {
        Port: 5174,
      },
      Client: {
        EmptySuggestions: ["查天气", "看代码"],
      },
    },
  },
  Cli: {
    Display: {
      DetailMode: "all",
    },
  },
  ModelProviders: [{
    ...baseConfig.ModelProviders[0],
    Temperature: 0.7,
  }],
  Frontend: {
    PreviewServer: {
      Port: 4174,
    },
  },
});
assert.deepEqual(resolvePluginRootsConfig(configuredDefaults), {
  System: ["./SystemTools"],
  User: ["./ExternalTools"],
});
assert.equal(resolveCliConfig(configuredDefaults).Connection?.Url, "ws://127.0.0.1:9797");
assert.equal(resolveCliConfig(configuredDefaults).Display?.DetailMode, "all");
assert.equal(resolveCliConfig(configuredDefaults).Display?.PreviewTokenLimit, 80);
assert.equal(resolveToolExecutionConfig(configuredDefaults).TimeoutMs, 90000);
assert.equal(resolveAgentDefaults(configuredDefaults).Cli.Display.PreviewTokenLimit, 80);
assert.equal(resolveModelProviderConfig(configuredDefaults).Temperature, 0.7);
assert.equal(resolveActionPlannerConfig(configuredDefaults).Client.Model, "test-model");
assert.equal(resolveActionPlannerConfig(configuredDefaults).Client.Provider, "openai-generic");
assert.equal(resolveActionPlannerConfig(configuredDefaults).Client.Temperature, 0.3);
assert.equal(resolveActionPlannerConfig(configuredDefaults).TaskFrameClient.Model, "test-model");
assert.equal(resolveActionPlannerConfig(configuredDefaults).EvidenceClient.Model, "test-model");
assert.equal(resolveFrontendConfig(configuredDefaults).DevServer.Port, 5174);
assert.equal(resolveFrontendConfig(configuredDefaults).PreviewServer.Port, 4174);
assert.equal(resolveFrontendConfig(configuredDefaults).Client.WebSocketUrl, "ws://127.0.0.1:8787");
assert.deepEqual(resolveFrontendConfig(configuredDefaults).Client.EmptySuggestions, ["查天气", "看代码"]);

const defaulted = resolveModelProviderConfig(parseConfig(baseConfig));
assert.equal(defaulted.ProviderId, "test-endpoint");
assert.equal(defaulted.ApiKey, "test");
assert.equal(defaulted.Kind, "OpenAICompatible");
assert.equal(defaulted.Temperature, 0);
assert.equal(defaulted.MaxOutputTokens, -1);
assert.equal(defaulted.Stream, true);
assert.equal(defaulted.TimeoutMs, 480000);
assert.equal(defaulted.FirstTokenTimeoutMs, 240000);
assert.equal(defaulted.MaxRequestMs, -1);

const configured = resolveModelProviderConfig(parseConfig({
  ...baseConfig,
  ModelProviders: [{
    ...baseConfig.ModelProviders[0],
    TimeoutSeconds: 30,
    FirstTokenTimeoutSeconds: 5,
    MaxRequestSeconds: 180,
  }],
}));
assert.equal(configured.TimeoutMs, 30000);
assert.equal(configured.FirstTokenTimeoutMs, 5000);
assert.equal(configured.MaxRequestMs, 180000);

const splitPlanner = resolveActionPlannerConfig(parseConfig({
  ...baseConfig,
  ModelProviders: [
    {
      Id: "gpt-planner",
      ProviderId: "test-endpoint",
      Endpoint: "Responses",
      Model: "gpt-planner-model",
    },
    {
      Id: "mistral-large-latest",
      ProviderId: "test-endpoint",
      Endpoint: "ChatCompletions",
      Model: "mistral-large-latest",
    },
  ],
  ActionPlanner: {
    TaskFrameClient: {
      ModelProviderId: "gpt-planner",
      Provider: "openai-responses",
      Temperature: 0.1,
      MaxTokens: 4096,
    },
    EvidenceClient: {
      ModelProviderId: "mistral-large-latest",
      Provider: "openai-generic",
      Temperature: 0,
      MaxTokens: 2048,
    },
  },
}));
assert.equal(splitPlanner.TaskFrameClient.Provider, "openai-responses");
assert.equal(splitPlanner.TaskFrameClient.Model, "gpt-planner-model");
assert.equal(splitPlanner.TaskFrameClient.MaxTokens, 4096);
assert.equal(splitPlanner.EvidenceClient.Provider, "openai-generic");
assert.equal(splitPlanner.EvidenceClient.Model, "mistral-large-latest");
assert.equal(splitPlanner.EvidenceClient.Temperature, 0);
assert.equal(splitPlanner.EvidenceClient.MaxTokens, 2048);

assert.throws(() => parseConfig({
  ...baseConfig,
  ModelProviders: [{
    ...baseConfig.ModelProviders[0],
    FirstTokenTimeoutSeconds: 0,
  }],
}));

assert.throws(() => parseConfig({
  ...baseConfig,
  ModelProviders: [{
    ...baseConfig.ModelProviders[0],
    MaxRequestSeconds: 0,
  }],
}));

console.log("Model timeout config verification passed.");
