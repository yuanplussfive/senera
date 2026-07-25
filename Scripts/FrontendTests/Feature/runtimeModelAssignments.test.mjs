import { describe, expect, it } from "vitest";
import {
  projectSectionConfigFields,
  readRuntimeModelAssignmentCandidates,
  readRuntimeModelAssignmentFields,
  readRuntimeModelAssignmentSelection,
  writeRuntimeModelAssignment,
} from "../../../Frontend/src/features/settings/sections/runtimeModelAssignments.ts";

describe("runtime model assignments", () => {
  it("projects contract-owned model fields out of their original settings sections", () => {
    const sections = createSections();
    const planning = projectSectionConfigFields(sections[0], sections);
    const retrieval = projectSectionConfigFields(sections[1], sections);

    expect(planning.fields.map((field) => field.key)).toEqual(["Enabled"]);
    expect(retrieval.fields.map((field) => field.key)).toEqual(["Dimensions"]);
    expect(readRuntimeModelAssignmentFields(sections).map((field) => field.modelSelection.id)).toEqual([
      "planner",
      "embedding",
    ]);
  });

  it("filters candidates by declared capability and enabled provider", () => {
    const field = readRuntimeModelAssignmentFields(createSections())[1];
    const candidates = readRuntimeModelAssignmentCandidates({
      field,
      models: [
        createModel("embed-a", "enabled", "embed-a", { Embedding: true }),
        createModel("chat-a", "enabled", "chat-a", { Chat: true }),
        createModel("embed-disabled", "disabled", "embed-disabled", { Embedding: true }),
      ],
      providers: [
        { Id: "enabled", Enabled: true },
        { Id: "disabled", Enabled: false },
      ],
      modelTemplate: { Capabilities: { Chat: true, Embedding: false, Rerank: false } },
    });

    expect(candidates.map((candidate) => candidate.model.Id)).toEqual(["embed-a"]);
  });

  it("writes provider and model values together for vector assignments", () => {
    const sections = createSections();
    const field = readRuntimeModelAssignmentFields(sections)[1];
    const candidate = {
      model: createModel("embed-a", "provider-a", "text-embedding-v3", { Embedding: true }),
      provider: { Id: "provider-a", Enabled: true },
    };
    const next = writeRuntimeModelAssignment({}, field, candidate);

    expect(next).toEqual({
      VectorModels: {
        Embedding: {
          Model: "text-embedding-v3",
          ProviderId: "provider-a",
        },
      },
    });
    expect(
      readRuntimeModelAssignmentSelection({
        field,
        allFields: sections.flatMap((section) => section.fields),
        candidates: [candidate],
        defaultModelId: "default-chat",
        draft: next,
      }),
    ).toEqual({ value: "embed-a" });
  });

  it("uses the default assistant model for inherited chat assignments", () => {
    const field = readRuntimeModelAssignmentFields(createSections())[0];
    expect(
      readRuntimeModelAssignmentSelection({
        field,
        allFields: [],
        candidates: [],
        defaultModelId: "default-chat",
        draft: {},
      }),
    ).toEqual({ value: "missing:planner:default-chat", unavailableLabel: "default-chat" });
  });
});

function createSections() {
  return [
    createSection("planning", [
      createField(["ActionPlanner", "Enabled"], "Enabled"),
      createField(["ActionPlanner", "Client", "ModelProviderId"], "ModelProviderId", {
        id: "planner",
        capability: "Chat",
        valueKind: "model-id",
        mutation: "config",
        required: true,
      }),
    ]),
    createSection("retrieval", [
      createField(["VectorModels", "Embedding", "ProviderId"], "ProviderId"),
      createField(["VectorModels", "Embedding", "Model"], "Model", {
        id: "embedding",
        capability: "Embedding",
        valueKind: "provider-model",
        mutation: "config",
        providerPath: ["VectorModels", "Embedding", "ProviderId"],
        required: true,
      }),
      createField(["VectorModels", "Embedding", "Dimensions"], "Dimensions"),
    ]),
  ];
}

function createSection(name, fields) {
  return { name, label: name, keyCount: fields.length, fields };
}

function createField(path, key, modelSelection) {
  return {
    label: key,
    section: path[0] === "ActionPlanner" ? "planning" : "retrieval",
    key,
    path,
    type: key === "Enabled" ? "boolean" : key === "Dimensions" ? "number" : "string",
    value: undefined,
    effectiveValue: undefined,
    configured: false,
    missing: true,
    valueSource: "missing",
    required: false,
    essential: false,
    ...(modelSelection ? { modelSelection } : {}),
  };
}

function createModel(Id, ProviderId, Model, Capabilities) {
  return { Id, ProviderId, Model, Endpoint: "ChatCompletions", Capabilities };
}
