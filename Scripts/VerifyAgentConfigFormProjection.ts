import assert from "node:assert/strict";
import { projectAgentConfigForm } from "../Source/AgentSystem/Config/AgentConfigFormProjector.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const config: AgentSystemConfig = {
  Defaults: {
    AgentLoop: {
      LoadedTools: "dynamic",
    },
    ActionPlanner: {
      Enabled: true,
      Client: {
        Provider: "openai-generic",
        Temperature: 0.1,
        MaxTokens: -1,
      },
    },
    VectorModels: {
      Embedding: {
        Enabled: true,
        ProviderId: "main-provider",
        Model: "qwen3-embedding-0.6b",
      },
    },
  },
  DefaultModelProviderId: "main",
  ModelProviderEndpoints: [{
    Id: "main-provider",
    BaseUrl: "https://provider.test/v1",
    ApiKey: "secret",
    Headers: {
      "x-provider": "test",
    },
  }],
  ModelProviders: [{
    Id: "main",
    ProviderId: "main-provider",
    Endpoint: "ChatCompletions",
    Model: "mistral-large-latest",
    MaxOutputTokens: -1,
  }],
};

const form = projectAgentConfigForm(config);
assert.equal(form.version, 1);
assert.ok(form.sections.length >= 4);

const defaultModel = findField(form, ["DefaultModelProviderId"]);
assert.equal(defaultModel.type, "string");
assert.equal(defaultModel.value, "main");

const endpoints = findField(form, ["ModelProviderEndpoints"]);
assert.equal(endpoints.type, "array");
assert.equal(endpoints.itemType, "table");
assert.ok(endpoints.itemFields?.some((field) => field.key === "ApiKey" && field.secret));
assert.deepEqual(endpoints.value, config.ModelProviderEndpoints);

const models = findField(form, ["ModelProviders"]);
assert.equal(models.type, "array");
assert.equal(models.itemType, "table");
assert.ok(models.itemFields?.some((field) =>
  field.key === "Endpoint" && field.options?.includes("ChatCompletions")
));

const loadedTools = findField(form, ["AgentLoop", "LoadedTools"]);
assert.equal(loadedTools.type, "string");
assert.equal(loadedTools.value, undefined);
assert.equal(loadedTools.effectiveValue, "dynamic");

const plannerProvider = findField(form, ["ActionPlanner", "Client", "Provider"]);
assert.equal(plannerProvider.type, "string");
assert.ok(plannerProvider.options?.includes("openai-generic"));

console.log("Agent config form projection verified.");

function findField(
  form: ReturnType<typeof projectAgentConfigForm>,
  path: readonly string[],
) {
  const field = form.sections
    .flatMap((section) => section.fields)
    .find((candidate) => candidate.path.join(".") === path.join("."));
  assert.ok(field, `Missing config form field: ${path.join(".")}`);
  return field;
}
