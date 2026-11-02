import { describe, expect, it } from "vitest";
import {
  bulkImportProviderModels,
  upsertProviderModel,
} from "../../../Source/AgentSystem/Config/AgentProviderModelConfigCommands.js";
import type {
  AgentModelProviderConfig,
  AgentSystemConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("provider model update semantics", () => {
  it("keeps price overrides independent and removes them when a replacement resumes automatic pricing", () => {
    const config = modelConfig();
    const replacement = { ...replacementModel(), Pricing: { input: 1.25, output: 0, cacheRead: 0.1, cacheWrite: 2 } };
    const updated = upsertProviderModel(config, { commandId: "set-prices", model: replacement });
    expect(updated.ModelProviders[0].Pricing).toEqual(replacement.Pricing);
    expect(updated.ModelProviders[0].Pricing).not.toBe(replacement.Pricing);
    expect(config.ModelProviders[0].Pricing).toBeUndefined();

    const cleared = upsertProviderModel(updated, { commandId: "clear-prices", model: replacementModel() });
    expect(cleared.ModelProviders[0].Pricing).toBeUndefined();
    expect(updated.ModelProviders[0].Pricing).toEqual(replacement.Pricing);
  });

  it("treats upsert payloads as complete replacements", () => {
    const config = modelConfig();
    const replacement: AgentModelProviderConfig = {
      Id: "custom/chat",
      ProviderId: "custom",
      Endpoint: "Responses",
      Model: "replacement-model",
      Capabilities: { Chat: true, Vision: true },
      MaxResponseBytes: 1024,
    };

    const updated = upsertProviderModel(config, {
      commandId: "replace-model",
      model: replacement,
    });
    const model = updated.ModelProviders[0];

    expect(model).toEqual(replacement);
    expect(model).not.toBe(replacement);
    expect(model.Capabilities).not.toBe(replacement.Capabilities);
    expect(model.Temperature).toBeUndefined();
    expect(model.TimeoutSeconds).toBeUndefined();
    expect(config.ModelProviders[0]).toMatchObject({ Temperature: 0.2, TimeoutSeconds: 30 });
  });

  it("replaces existing models only when bulk overwrite is enabled", () => {
    const skipped = bulkImportProviderModels(modelConfig(), {
      commandId: "skip-existing-model",
      models: [replacementModel()],
    });
    expect(skipped.ModelProviders[0]).toMatchObject({
      Endpoint: "ChatCompletions",
      Model: "original-model",
      Temperature: 0.2,
    });

    const overwritten = bulkImportProviderModels(modelConfig(), {
      commandId: "overwrite-existing-model",
      models: [replacementModel()],
      overwriteExisting: true,
    });
    expect(overwritten.ModelProviders[0]).toEqual(replacementModel());
    expect(overwritten.ModelProviders[0].Temperature).toBeUndefined();
    expect(overwritten.ModelProviders[0].TimeoutSeconds).toBeUndefined();
  });
});

function modelConfig(): AgentSystemConfig {
  return {
    DefaultModelProviderId: "custom/chat",
    ModelProviderEndpoints: [
      {
        Id: "custom",
        Enabled: true,
        BaseUrl: "https://models.example.test/v1",
      },
    ],
    ModelProviders: [
      {
        Id: "custom/chat",
        ProviderId: "custom",
        Endpoint: "ChatCompletions",
        Model: "original-model",
        Capabilities: { Chat: true, Vision: false },
        Temperature: 0.2,
        TimeoutSeconds: 30,
      },
    ],
  };
}

function replacementModel(): AgentModelProviderConfig {
  return {
    Id: "custom/chat",
    ProviderId: "custom",
    Endpoint: "Responses",
    Model: "replacement-model",
    Capabilities: { Chat: true, Reasoning: true },
    MaxResponseBytes: 2048,
  };
}
