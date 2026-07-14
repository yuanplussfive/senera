import assert from "node:assert/strict";
import { AgentSystemConfigSchema } from "../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import {
  resolveActionPlannerConfig,
  resolveAgentLoopConfig,
  resolveAgentDefaults,
  resolveFrontendConfig,
  resolveModelProviderConfig,
  resolvePersistenceConfig,
  resolvePluginDiscoveryConfig,
  resolvePluginRootsConfig,
  resolveToolExecutionConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const baseConfig = {
  ModelProviderEndpoints: [
    {
      Id: "test-endpoint",
      BaseUrl: "https://example.test/v1",
      ApiKey: "test",
    },
  ],
  ModelProviders: [
    {
      Id: "test",
      ProviderId: "test-endpoint",
      Endpoint: "Responses",
      Model: "test-model",
    },
  ],
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
assert.equal(resolveAgentLoopConfig(parsedBase).PiSessionCreateTimeoutMs, 20000);
assert.equal(resolveAgentDefaults(parsedBase).Server.Port, 8787);

const configuredDefaults = parseConfig({
  ...baseConfig,
  Defaults: {
    PluginRoots: {
      System: ["./SystemTools"],
      User: ["./ExternalTools"],
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
  ModelProviders: [
    {
      ...baseConfig.ModelProviders[0],
      Temperature: 0.7,
    },
  ],
  Frontend: {
    PreviewServer: {
      Port: 4174,
    },
  },
  AgentLoop: {
    PiSessionCreateTimeoutSeconds: 7,
  },
});
assert.deepEqual(resolvePluginRootsConfig(configuredDefaults), {
  System: ["./SystemTools"],
  User: ["./ExternalTools"],
});
assert.equal(resolveToolExecutionConfig(configuredDefaults).TimeoutMs, 90000);
assert.equal(resolveAgentLoopConfig(configuredDefaults).PiSessionCreateTimeoutMs, 7000);
assert.equal(resolveAgentDefaults(configuredDefaults).Server.Port, 8787);
assert.equal(resolveModelProviderConfig(configuredDefaults).Temperature, 0.7);
assert.equal(resolveActionPlannerConfig(configuredDefaults).Client.Model, "test-model");
assert.equal(resolveActionPlannerConfig(configuredDefaults).Client.Provider, "openai-generic");
assert.equal(resolveActionPlannerConfig(configuredDefaults).Client.Temperature, 0.3);
assert.equal(resolveActionPlannerConfig(configuredDefaults).PlanningClient.Model, "test-model");
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
assert.equal(defaulted.RetryBaseDelayMs, 250);
assert.equal(defaulted.RetryMaxDelayMs, 10000);
assert.equal(defaulted.RetryAfterMaxDelayMs, 60000);

const configured = resolveModelProviderConfig(
  parseConfig({
    ...baseConfig,
    ModelProviders: [
      {
        ...baseConfig.ModelProviders[0],
        TimeoutSeconds: 30,
        FirstTokenTimeoutSeconds: 5,
        MaxRequestSeconds: 180,
        RetryBaseDelaySeconds: 0.5,
        RetryMaxDelaySeconds: 12,
        RetryAfterMaxDelaySeconds: 45,
      },
    ],
  }),
);
assert.equal(configured.TimeoutMs, 30000);
assert.equal(configured.FirstTokenTimeoutMs, 5000);
assert.equal(configured.MaxRequestMs, 180000);
assert.equal(configured.RetryBaseDelayMs, 500);
assert.equal(configured.RetryMaxDelayMs, 12000);
assert.equal(configured.RetryAfterMaxDelayMs, 45000);

const splitPlanner = resolveActionPlannerConfig(
  parseConfig({
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
      PlanningClient: {
        ModelProviderId: "gpt-planner",
        Provider: "openai-responses",
        Temperature: 0.1,
        MaxTokens: 4096,
      },
    },
  }),
);
assert.equal(splitPlanner.PlanningClient.Provider, "openai-responses");
assert.equal(splitPlanner.PlanningClient.Model, "gpt-planner-model");
assert.equal(splitPlanner.PlanningClient.MaxTokens, 4096);

assert.throws(() =>
  parseConfig({
    ...baseConfig,
    ModelProviders: [
      {
        ...baseConfig.ModelProviders[0],
        FirstTokenTimeoutSeconds: 0,
      },
    ],
  }),
);

assert.throws(
  () =>
    resolveModelProviderConfig(
      parseConfig({
        ...baseConfig,
        ModelProviders: [
          {
            ...baseConfig.ModelProviders[0],
            RetryBaseDelaySeconds: 5,
            RetryMaxDelaySeconds: 1,
          },
        ],
      }),
    ),
  /基础等待时间不能大于最大等待时间/,
);

assert.throws(() =>
  parseConfig({
    ...baseConfig,
    ModelProviders: [
      {
        ...baseConfig.ModelProviders[0],
        MaxRequestSeconds: 0,
      },
    ],
  }),
);

console.log("Model timeout config verification passed.");
