import { describe, expect, it } from "vitest";
import {
  readModelsDevCapabilities,
  readModelsDevCapabilityKeys,
} from "../../../Frontend/src/features/chat/modelsDevCapabilities.ts";
import { createModelDraft, defaultModelCapabilities } from "../../../Frontend/src/features/chat/modelConfigData.ts";

const template = {
  Capabilities: {
    Chat: true,
    Embedding: false,
    Rerank: false,
    Vision: false,
    ImageOutput: false,
    Reasoning: false,
    DeveloperRole: false,
    StreamingUsage: true,
    ToolCalling: true,
  },
  ContextWindowTokens: 128000,
  MaxModelOutputTokens: -1,
};

function metadata(overrides) {
  return {
    id: "gpt-4o",
    sourceModelId: "gpt-4o",
    inputModalities: [],
    outputModalities: [],
    ...overrides,
  };
}

describe("models.dev capability mapping", () => {
  it("maps capability flags to display keys in order", () => {
    expect(
      readModelsDevCapabilityKeys(
        metadata({
          toolCall: true,
          reasoning: true,
          structuredOutput: true,
          attachment: true,
          inputModalities: ["text", "image"],
          outputModalities: ["text", "image", "audio"],
        }),
      ),
    ).toEqual(["toolCalling", "reasoning", "structuredOutput", "attachment", "vision", "imageOutput", "audio"]);
  });

  it("returns no keys for empty metadata and treats audio synonyms as audio", () => {
    expect(readModelsDevCapabilityKeys(undefined)).toEqual([]);
    expect(readModelsDevCapabilityKeys(metadata({ inputModalities: ["text", "voice"] }))).toEqual(["audio"]);
    expect(readModelsDevCapabilityKeys(metadata({ outputModalities: ["speech"] }))).toEqual(["audio"]);
  });

  it("projects models.dev facts onto local capability flags", () => {
    expect(
      readModelsDevCapabilities(
        metadata({
          toolCall: true,
          reasoning: true,
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
        }),
      ),
    ).toEqual({
      ToolCalling: true,
      Reasoning: true,
      Vision: true,
      Chat: true,
      ImageOutput: false,
      Embedding: false,
    });
  });

  it("ignores modality arrays while empty so local defaults survive", () => {
    expect(readModelsDevCapabilities(metadata({ toolCall: false }))).toEqual({ ToolCalling: false });
    expect(readModelsDevCapabilities(undefined)).toEqual({});
  });
});

describe("createModelDraft with models.dev metadata", () => {
  const modelField = { defaultItem: template };

  it("prefers API limits over template defaults and maps capabilities", () => {
    const draft = createModelDraft({
      provider: { Id: "openai" },
      modelInfo: { id: "gpt-4o" },
      modelField,
      endpointOptions: [{ value: "ChatCompletions", label: "ChatCompletions" }],
      modelsDev: metadata({
        contextLimit: 200000,
        outputLimit: 16384,
        toolCall: true,
        reasoning: true,
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
      }),
    });
    expect(draft.ContextWindowTokens).toBe(200000);
    expect(draft.MaxModelOutputTokens).toBe(16384);
    expect(draft.Capabilities).toMatchObject({
      Chat: true,
      ToolCalling: true,
      Reasoning: true,
      Vision: true,
    });
    expect(draft.Model).toBe("gpt-4o");
    expect(draft.ProviderId).toBe("openai");
  });

  it("falls back to template defaults when API values are absent", () => {
    const draft = createModelDraft({
      provider: { Id: "local" },
      modelInfo: { id: "local-model" },
      modelField,
      endpointOptions: [{ value: "ChatCompletions", label: "ChatCompletions" }],
    });
    expect(draft.ContextWindowTokens).toBe(128000);
    expect(draft.MaxModelOutputTokens).toBe(-1);
    expect(draft.Capabilities).toMatchObject({ Chat: true, ToolCalling: true });
  });

  it("applies explicit API capability negatives over template defaults", () => {
    const draft = createModelDraft({
      provider: { Id: "embed" },
      modelInfo: { id: "text-embedding-3" },
      modelField,
      endpointOptions: [{ value: "ChatCompletions", label: "ChatCompletions" }],
      modelsDev: metadata({
        toolCall: false,
        outputModalities: ["embedding"],
      }),
    });
    expect(draft.Capabilities).toMatchObject({
      ToolCalling: false,
      Chat: false,
      Embedding: true,
    });
  });
});

describe("defaultModelCapabilities with models.dev metadata", () => {
  it("gives models.dev priority over template and heuristics", () => {
    expect(
      defaultModelCapabilities(template, "gpt-4o", "openai", metadata({ toolCall: false, reasoning: true })),
    ).toMatchObject({
      ToolCalling: false,
      Reasoning: true,
    });
    expect(defaultModelCapabilities(template, "gpt-4o", "openai")).toMatchObject({
      ToolCalling: true,
      Reasoning: false,
    });
  });
});
