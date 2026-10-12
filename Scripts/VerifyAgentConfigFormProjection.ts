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
      Capabilities: {
        DeveloperRole: true,
      },
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
assert.equal(models.itemFields?.find((field) => field.key === "Chat")?.required, false);
assert.equal(models.itemFields?.find((field) => field.key === "Chat")?.essential, true);
assert.equal((models.effectiveValue as Array<{ Capabilities?: { Chat?: boolean } }>)[0]?.Capabilities?.Chat, true);

assert.equal(findOptionalField(form, ["AgentLoop", "LoadedTools"]), undefined);

assert.equal(
  findField(form, ["ActionPlanner", "Enabled"]).description,
  "在复杂任务中先生成结构化行动计划，并根据执行证据修正后续步骤。",
);
assert.equal(
  findField(form, ["StateCard", "Enabled"]).description,
  "从会话历史投影结构化状态卡，并解析追问的独立请求。",
);
assert.equal(
  findField(form, ["ContinuityLearning", "Enabled"]).description,
  "为每个成功回合生成 MemOS 语义片段，并按上海时区归并日/月摘要。",
);

const plannerModel = findField(form, ["ActionPlanner", "Client", "ModelProviderId"]);
assert.equal(plannerModel.type, "string");
assert.equal(plannerModel.valueSource, "missing");
assert.equal(plannerModel.missing, true);
assert.deepEqual(plannerModel.modelSelection, {
  id: "planner-base",
  capability: "Chat",
  valueKind: "model-id",
  mutation: "config",
  required: true,
});
const modelSelections = form.sections.flatMap((section) =>
  section.fields.flatMap((field) => (field.modelSelection ? [field.modelSelection] : [])),
);
assert.deepEqual(
  modelSelections.map((selection) => selection.id),
  ["assistant", "planner-base", "action-planner", "final-answer", "state-card", "continuity-learning"],
);
assert.equal(findField(form, ["StateCard", "HistoryBudgetCharacters"]).effectiveValue, 4_000);
assert.deepEqual(findField(form, ["StateCard", "Client", "ModelProviderId"]).modelSelection, {
  id: "state-card",
  capability: "Chat",
  valueKind: "model-id",
  mutation: "config",
  inheritance: { source: "default-model" },
  required: false,
});
assert.deepEqual(findField(form, ["ContinuityLearning", "Client", "ModelProviderId"]).modelSelection, {
  id: "continuity-learning",
  capability: "Chat",
  valueKind: "model-id",
  mutation: "config",
  inheritance: { source: "default-model" },
  required: false,
});
assert.equal(findField(form, ["ContinuityLearning", "MemOS", "AutoLinkThreshold"]).effectiveValue, 0.75);
assert.equal(findOptionalField(form, ["VectorModels", "Embedding", "Model"]), undefined);
assert.equal(findOptionalField(form, ["ActionPlanner", "Client", "Provider"]), undefined);
assert.equal(findOptionalField(form, ["ActionPlanner", "FinalAnswerClient", "Provider"]), undefined);

const toolSearchFuzzy = findField(form, ["ToolSearch", "Fuzzy", "Enabled"]);
assert.equal(toolSearchFuzzy.type, "boolean");
assert.equal(toolSearchFuzzy.effectiveValue, true);
assert.equal(findField(form, ["ToolSearch", "Fuzzy", "MinScore"]).effectiveValue, 0.25);
assert.equal(findOptionalField(form, ["ToolSearch", "Fuzzy", "CandidateLimit"]), undefined);
assert.equal(findOptionalField(form, ["ToolSearch", "Embedding", "Provider"]), undefined);
assert.equal(findOptionalField(form, ["ToolSearch", "Embedding", "Languages"]), undefined);
assert.equal(findField(form, ["ToolSearch", "Disclosure", "TokenBudget"]).effectiveValue, 640);

assert.deepEqual(findField(form, ["ToolExecution", "Environment", "Inherit"]).options, ["all", "allowlist", "none"]);

assert.equal(findOptionalField(form, ["ToolSearch", "Memory", "Kind"]), undefined);
assert.equal(findField(form, ["AgentLoop", "PiSessions", "Compaction", "Enabled"]).required, false);
assert.equal(findField(form, ["Server", "HotReload"]).required, false);
assert.equal(findField(form, ["ConfigStore", "Enabled"]).required, false);
assert.equal(findField(form, ["ConfigStore", "MirrorJson"]).required, false);
assert.equal(findField(form, ["AgentLoop", "PiSessions", "Compaction", "Enabled"]).essential, true);

const inferenceBudgetEnabled = findField(form, ["InferenceBudget", "Enabled"]);
assert.equal(inferenceBudgetEnabled.type, "boolean");
assert.equal(inferenceBudgetEnabled.effectiveValue, true);
assert.equal(findField(form, ["InferenceBudget", "WindowSeconds"]).effectiveValue, 60);
assert.equal(findField(form, ["InferenceBudget", "ForegroundReserveFraction"]).effectiveValue, 0.5);
assert.equal(findField(form, ["InferenceBudget", "LaneWeights"]).type, "record");

for (const section of form.sections) {
  for (const field of section.fields) {
    assertExplicitFieldMetadata(field);
  }
}

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

interface ConfigFormFieldMetadata {
  required: boolean;
  essential: boolean;
  itemFields?: readonly ConfigFormFieldMetadata[];
}

function assertExplicitFieldMetadata(field: ConfigFormFieldMetadata) {
  assert.equal(typeof field.required, "boolean");
  assert.equal(typeof field.essential, "boolean");
  for (const itemField of field.itemFields ?? []) {
    assertExplicitFieldMetadata(itemField);
  }
}
