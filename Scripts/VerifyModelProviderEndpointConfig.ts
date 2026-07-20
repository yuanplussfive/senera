import assert from "node:assert/strict";
import {
  resolveActionPlannerConfig,
  resolveModelProviderConfig,
  resolveModelProviderCatalog,
  resolveVectorModelsConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import { resolveModelProviderEndpointCatalog } from "../Source/AgentSystem/Defaults/AgentModelProviderDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
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
  VectorModels: {
    Embedding: {
      ProviderId: "shared-provider",
      Model: "qwen3-embedding-0.6b",
    },
    Rerank: {
      ProviderId: "shared-provider",
      Model: "qwen3-reranker-0.6b",
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

const vector = resolveVectorModelsConfig(config);
assert.equal(vector.Embedding.BaseUrl, "https://provider.test/v1");
assert.equal(vector.Embedding.ApiKey, "provider-key");
assert.equal(vector.Embedding.Model, "qwen3-embedding-0.6b");
assert.deepEqual(vector.Embedding.Headers, { "x-provider": "shared" });
assert.equal(vector.Rerank.BaseUrl, "https://provider.test/v1");
assert.equal(vector.Rerank.ApiKey, "provider-key");
assert.equal(vector.Rerank.Model, "qwen3-reranker-0.6b");

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
  DefaultModelProviderId: "disabled-model",
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
  VectorModels: {
    Embedding: { ProviderId: "disabled-provider", Model: "disabled-embedding" },
    Rerank: { ProviderId: "disabled-provider", Model: "disabled-rerank" },
  },
};

const activeCatalog = resolveModelProviderCatalog(disabledProviderConfig);
assert.equal(activeCatalog.defaultId, "enabled-model");
assert.deepEqual(
  activeCatalog.providers.map((provider) => provider.Id),
  ["enabled-model"],
);
assert.throws(() => activeCatalog.resolve("disabled-model"), /模型配置不存在/);

const disabledVector = resolveVectorModelsConfig(disabledProviderConfig);
assert.equal(disabledVector.Embedding.Enabled, false);
assert.equal(disabledVector.Rerank.Enabled, false);
assert.equal(disabledVector.Embedding.BaseUrl, "https://disabled.example.test/v1");

const allDisabledProviderConfig: AgentSystemConfig = {
  ...disabledProviderConfig,
  ModelProviderEndpoints: disabledProviderConfig.ModelProviderEndpoints?.filter((endpoint) => !endpoint.Enabled),
  ModelProviders: disabledProviderConfig.ModelProviders.filter((model) => model.ProviderId === "disabled-provider"),
  DefaultModelProviderId: "disabled-model",
};
assert.doesNotThrow(() => projectAgentConfigForm(allDisabledProviderConfig));

console.log("Model provider endpoint config verification passed.");
