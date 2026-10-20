import assert from "node:assert/strict";
import {
  resolveActionPlannerConfig,
  resolveModelProviderConfig,
  resolveModelProviderCatalog,
} from "../Source/AgentSystem/AgentDefaults.js";
import { resolveModelProviderEndpointCatalog } from "../Source/AgentSystem/Defaults/AgentModelProviderDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { projectEffectiveConfig } from "../Source/AgentSystem/Config/AgentConfigEffectiveProjector.js";
import { projectAgentConfigForm } from "../Source/AgentSystem/Config/AgentConfigFormProjector.js";

const config: AgentSystemConfig = {
  DefaultModelProviderId: "chat-main",
  ModelProviderEndpoints: [
    {
      Id: "shared-provider",
      BaseUrl: "https://provider.test/v1",
      ApiKey: "provider-key",
      Headers: {
        "x-provider": "shared",
      },
    },
  ],
  ModelProviders: [
    {
      Id: "chat-main",
      ProviderId: "shared-provider",
      Endpoint: "ChatCompletions",
      Model: "mistral-large-latest",
      MaxOutputTokens: -1,
    },
  ],
  ActionPlanner: {
    PlanningClient: {
      ModelProviderId: "chat-main",
      Temperature: 0.1,
      MaxTokens: 2048,
    },
  },
};

const provider = resolveModelProviderConfig(config);
assert.equal(provider.ProviderId, "shared-provider");
assert.equal(provider.BaseUrl, "https://provider.test/v1");
assert.equal(provider.ApiKey, "provider-key");
assert.equal(provider.Model, "mistral-large-latest");

const planner = resolveActionPlannerConfig(config);
assert.equal(planner.Client.ModelProvider.Endpoint, "ChatCompletions");
assert.equal(planner.Client.BaseUrl, "https://provider.test/v1");
assert.equal(planner.Client.ApiKey, "provider-key");
assert.equal(planner.PlanningClient.ModelProvider.Endpoint, "ChatCompletions");
assert.equal(planner.PlanningClient.Model, "mistral-large-latest");
assert.equal(planner.PlanningClient.MaxTokens, 2048);

assert.throws(
  () =>
    resolveModelProviderConfig({
      ...config,
      ModelProviders: [
        {
          Id: "broken",
          ProviderId: "missing-provider",
          Endpoint: "ChatCompletions",
          Model: "broken",
        },
      ],
    }),
  /ProviderId=missing-provider/,
);

const overriddenDefaultEndpoint = resolveModelProviderEndpointCatalog({
  ...config,
  ModelProviderEndpoints: [
    {
      Id: "default",
      BaseUrl: "https://default-override.test/v1",
      ApiKey: "override-key",
    },
  ],
  ModelProviders: [
    {
      Id: "main",
      ProviderId: "default",
      Endpoint: "ChatCompletions",
      Model: "mistral-large-latest",
    },
  ],
}).resolve("default");
assert.equal(overriddenDefaultEndpoint.BaseUrl, "https://default-override.test/v1");
assert.equal(overriddenDefaultEndpoint.ApiKey, "override-key");

const sparseDeepSeekConfig: AgentSystemConfig = {
  DefaultModelProviderId: "deepseek-chat",
  ModelProviderEndpoints: [{ Id: "deepseek", Enabled: true, ApiKey: "deepseek-key" }],
  ModelProviders: [
    {
      Id: "deepseek-chat",
      ProviderId: "deepseek",
      Endpoint: "ChatCompletions",
      Model: "deepseek-chat",
    },
  ],
};
const sparseDeepSeekEndpoint = resolveModelProviderEndpointCatalog(sparseDeepSeekConfig).resolve("deepseek");
assert.equal(sparseDeepSeekEndpoint.BaseUrl, "https://api.deepseek.com/v1");
assert.equal(sparseDeepSeekEndpoint.ApiKey, "deepseek-key");
assert.deepEqual(
  projectEffectiveConfig(sparseDeepSeekConfig).ModelProviderEndpoints?.find((endpoint) => endpoint.Id === "deepseek"),
  sparseDeepSeekEndpoint,
);

assert.throws(
  () =>
    resolveModelProviderEndpointCatalog({
      ...config,
      ModelProviderEndpoints: [
        {
          Id: "dup",
          BaseUrl: "https://one.test/v1",
        },
        {
          Id: "dup",
          BaseUrl: "https://two.test/v1",
        },
      ],
    }),
  /ModelProviderEndpoints\[\]\.Id=dup/,
);

const disabledProviderConfig: AgentSystemConfig = {
  ...config,
  DefaultModelProviderId: "enabled-model",
  ModelProviderEndpoints: [
    {
      Id: "disabled-provider",
      Enabled: false,
      BaseUrl: "https://disabled.example.test/v1",
    },
    {
      Id: "enabled-provider",
      Enabled: true,
      BaseUrl: "https://enabled.example.test/v1",
    },
  ],
  ModelProviders: [
    {
      Id: "disabled-model",
      ProviderId: "disabled-provider",
      Endpoint: "ChatCompletions",
      Model: "disabled-model",
    },
    {
      Id: "enabled-model",
      ProviderId: "enabled-provider",
      Endpoint: "Responses",
      Model: "enabled-model",
    },
  ],
  ActionPlanner: {
    Client: { ModelProviderId: "openai-generic" },
  },
};

const activeCatalog = resolveModelProviderCatalog(disabledProviderConfig);
assert.equal(activeCatalog.defaultId, "enabled-model");
assert.deepEqual(
  activeCatalog.providers.map((provider) => provider.Id),
  ["enabled-model"],
);
assert.throws(() => activeCatalog.resolve("disabled-model"), /模型配置不存在/);
assert.throws(
  () =>
    resolveModelProviderCatalog({
      ...disabledProviderConfig,
      DefaultModelProviderId: "disabled-model",
    }),
  /默认模型当前不可用：DefaultModelProviderId=disabled-model/,
);

const allDisabledProviderConfig: AgentSystemConfig = {
  ...disabledProviderConfig,
  ModelProviderEndpoints: disabledProviderConfig.ModelProviderEndpoints?.filter((endpoint) => !endpoint.Enabled),
  ModelProviders: disabledProviderConfig.ModelProviders.filter((model) => model.ProviderId === "disabled-provider"),
  DefaultModelProviderId: "disabled-model",
};
assert.doesNotThrow(() => projectAgentConfigForm(allDisabledProviderConfig));

console.log("Model provider endpoint config verification passed.");
