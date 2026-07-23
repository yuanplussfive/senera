import assert from "node:assert/strict";
import { projectAgentConfigForm } from "../Source/AgentSystem/Config/AgentConfigFormProjector.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const config: AgentSystemConfig = {
  Defaults: {
    ActionPlanner: {
      Enabled: true,
      Client: {
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
  ModelProviderEndpoints: [
    {
      Id: "main-provider",
      BaseUrl: "https://provider.test/v1",
      ApiKey: "secret",
      Headers: {
        "x-provider": "test",
      },
    },
  ],
  ModelProviders: [
    {
      Id: "main",
      ProviderId: "main-provider",
      Endpoint: "ChatCompletions",
      Model: "mistral-large-latest",
      MaxOutputTokens: -1,
    },
  ],
};

const form = projectAgentConfigForm(config);
assert.equal(form.version, 1);
assert.ok(form.sections.length >= 4);

const defaultModel = findField(form, ["DefaultModelProviderId"]);
assert.equal(defaultModel.type, "string");
assert.equal(defaultModel.value, "main");
assert.equal(defaultModel.required, false);
assert.equal(defaultModel.valueSource, "explicit");
assert.equal(defaultModel.missing, false);

const endpoints = findField(form, ["ModelProviderEndpoints"]);
assert.equal(endpoints.type, "array");
assert.equal(endpoints.itemType, "table");
assert.ok(endpoints.itemFields?.some((field) => field.key === "ApiKey" && field.secret));
assert.deepEqual(endpoints.value, config.ModelProviderEndpoints);
assert.equal(endpoints.required, false);
assert.equal(endpoints.itemFields?.find((field) => field.key === "Id")?.required, true);
assert.equal(endpoints.itemFields?.find((field) => field.key === "ApiKey")?.required, false);

const models = findField(form, ["ModelProviders"]);
assert.equal(models.type, "array");
assert.equal(models.itemType, "table");
assert.ok(models.itemFields?.some((field) => field.key === "Endpoint" && field.options?.includes("ChatCompletions")));
assert.ok(models.itemFields?.some((field) => field.key === "RetryBaseDelaySeconds"));
assert.equal(models.required, true);
assert.equal(models.itemFields?.find((field) => field.key === "ProviderId")?.required, true);
assert.equal(models.itemFields?.find((field) => field.key === "Endpoint")?.required, true);
assert.equal(models.itemFields?.find((field) => field.key === "Model")?.required, true);

assert.equal(findOptionalField(form, ["AgentLoop", "LoadedTools"]), undefined);

const plannerModel = findField(form, ["ActionPlanner", "Client", "ModelProviderId"]);
assert.equal(plannerModel.type, "string");
assert.equal(plannerModel.valueSource, "missing");
assert.equal(plannerModel.missing, true);
assert.equal(findOptionalField(form, ["ActionPlanner", "Client", "Provider"]), undefined);
assert.equal(findOptionalField(form, ["ActionPlanner", "FinalAnswerClient", "Provider"]), undefined);

const toolSearchMaxResults = findField(form, ["ToolSearch", "Ranking", "MaxResults"]);
assert.equal(toolSearchMaxResults.type, "number");
assert.equal(toolSearchMaxResults.effectiveValue, 6);
assert.equal(toolSearchMaxResults.valueSource, "default");

const memoryExpansionMode = findField(form, ["ToolSearch", "Ranking", "MemoryExpansion", "Mode"]);
assert.deepEqual(memoryExpansionMode.options, ["disabled", "fallback", "augment"]);
assert.equal(memoryExpansionMode.effectiveValue, "fallback");

assert.equal(findField(form, ["VectorModels", "Embedding", "InputMaxChars"]).effectiveValue, -1);
assert.equal(findField(form, ["VectorModels", "Embedding", "Model"]).valueSource, "inherited");
assert.equal(findField(form, ["VectorModels", "Rerank", "CandidateLimit"]).effectiveValue, -1);
assert.equal(findField(form, ["VectorModels", "Rerank", "TopK"]).effectiveValue, -1);
assert.equal(findOptionalField(form, ["ToolSearch", "Memory", "Kind"]), undefined);
assert.equal(findField(form, ["AgentLoop", "PiSessions", "Compaction", "Enabled"]).required, true);
assert.equal(findField(form, ["Server", "HotReload"]).required, true);
assert.equal(findField(form, ["ConfigStore", "Enabled"]).required, true);
assert.equal(findField(form, ["ConfigStore", "MirrorJson"]).required, true);

console.log("Agent config form projection verified.");

function findField(form: ReturnType<typeof projectAgentConfigForm>, path: readonly string[]) {
  const field = findOptionalField(form, path);
  assert.ok(field, `Missing config form field: ${path.join(".")}`);
  return field;
}

function findOptionalField(form: ReturnType<typeof projectAgentConfigForm>, path: readonly string[]) {
  return form.sections
    .flatMap((section) => section.fields)
    .find((candidate) => candidate.path.join(".") === path.join("."));
}
