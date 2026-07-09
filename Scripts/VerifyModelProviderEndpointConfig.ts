import assert from "node:assert/strict";
import {
  resolveActionPlannerConfig,
  resolveModelProviderConfig,
  resolveVectorModelsConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import { resolveModelProviderEndpointCatalog } from "../Source/AgentSystem/Defaults/AgentModelProviderDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const config: AgentSystemConfig = {
  DefaultModelProviderId: "chat-main",
  ModelProviderEndpoints: [{
    Id: "shared-provider",
    BaseUrl: "https://provider.test/v1",
    ApiKey: "provider-key",
    Headers: {
      "x-provider": "shared",
    },
  }],
  ModelProviders: [{
    Id: "chat-main",
    ProviderId: "shared-provider",
    Endpoint: "ChatCompletions",
    Model: "mistral-large-latest",
    MaxOutputTokens: -1,
  }],
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
assert.equal(planner.Client.Provider, "openai-generic");
assert.equal(planner.Client.BaseUrl, "https://provider.test/v1");
assert.equal(planner.Client.ApiKey, "provider-key");
assert.equal(planner.PlanningClient.Provider, "openai-generic");
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

assert.throws(() => resolveModelProviderConfig({
  ...config,
  ModelProviders: [{
    Id: "broken",
    ProviderId: "missing-provider",
    Endpoint: "ChatCompletions",
    Model: "broken",
  }],
}), /ProviderId=missing-provider/);

const overriddenDefaultEndpoint = resolveModelProviderEndpointCatalog({
  ...config,
  ModelProviderEndpoints: [{
    Id: "default",
    BaseUrl: "https://default-override.test/v1",
    ApiKey: "override-key",
  }],
  ModelProviders: [{
    Id: "main",
    ProviderId: "default",
    Endpoint: "ChatCompletions",
    Model: "mistral-large-latest",
  }],
}).resolve("default");
assert.equal(overriddenDefaultEndpoint.BaseUrl, "https://default-override.test/v1");
assert.equal(overriddenDefaultEndpoint.ApiKey, "override-key");

assert.throws(() => resolveModelProviderEndpointCatalog({
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
}), /ModelProviderEndpoints\[\]\.Id=dup/);

console.log("Model provider endpoint config verification passed.");
