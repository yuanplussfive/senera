import { describe, expect, test } from "vitest";
import { AgentDelegationConfigurationSchema } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationConfig.js";
import {
  resolveAgentSubagentConfiguredModelPool,
  resolveAgentSubagentModelPool,
  resolveAgentSubagentRequestedModel,
} from "../../../Source/AgentSystem/Orchestration/AgentSubagentModelPool.js";
import { AgentChildRunModelSelectionSources } from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("subagent model pool", () => {
  test("orders the inherited parent before the explicit model candidates", () => {
    const config = modelConfiguration({ inheritParent: true, modelProviderIds: ["child-b", "child-a"] });
    const configured = resolveAgentSubagentConfiguredModelPool(config);
    const resolved = resolveAgentSubagentModelPool(config, "main");

    expect(configured.explicitModelProviderIds).toEqual(["child-b", "child-a"]);
    expect(resolved.modelProviderIds).toEqual(["main", "child-b", "child-a"]);
    expect(resolved.fallbackModelProviderId).toBe("main");
    expect(resolved.inheritedSelectionSource).toBe(AgentChildRunModelSelectionSources.Parent);
  });

  test("uses the first explicit model when parent inheritance is disabled", () => {
    const resolved = resolveAgentSubagentModelPool(
      modelConfiguration({ inheritParent: false, modelProviderIds: ["child-b", "child-a"] }),
      "main",
    );

    expect(resolved.inheritedModelProviderId).toBeUndefined();
    expect(resolved.modelProviderIds).toEqual(["child-b", "child-a"]);
    expect(resolved.fallbackModelProviderId).toBe("child-b");
  });

  test("rejects an explicit request outside the resolved host pool", () => {
    const resolved = resolveAgentSubagentModelPool(
      modelConfiguration({ inheritParent: true, modelProviderIds: ["child-a"] }),
      "main",
    );

    expect(resolveAgentSubagentRequestedModel(resolved, "child-a")).toEqual({
      modelProviderId: "child-a",
      source: AgentChildRunModelSelectionSources.Request,
    });
    expect(() => resolveAgentSubagentRequestedModel(resolved, "outside")).toThrowError(
      expect.objectContaining({ messageKey: "orchestration.modelNotAllowed" }),
    );
  });

  test("rejects non-chat models at the shared pool boundary", () => {
    const config = modelConfiguration({ inheritParent: false, modelProviderIds: ["embedding"] });

    expect(() => resolveAgentSubagentModelPool(config, "main")).toThrowError(
      expect.objectContaining({ messageKey: "orchestration.modelChatCapabilityRequired" }),
    );
  });

  test("requires one source and unique explicit model IDs", () => {
    expect(() =>
      AgentDelegationConfigurationSchema.parse({
        modelPool: { inheritParent: false, modelProviderIds: [] },
      }),
    ).toThrow(/inherit the parent model or contain at least one configured model/u);
    expect(() =>
      AgentDelegationConfigurationSchema.parse({
        modelPool: { inheritParent: true, modelProviderIds: ["child-a", "child-a"] },
      }),
    ).toThrow(/must be unique/u);
  });
});

function modelConfiguration(modelPool: { inheritParent: boolean; modelProviderIds: string[] }): AgentSystemConfig {
  return {
    DefaultModelProviderId: "main",
    ModelProviderEndpoints: [
      {
        Id: "test-provider",
        Enabled: true,
        Kind: "OpenAICompatible",
        BaseUrl: "https://models.example.test/v1",
        ApiKey: "test-key",
      },
    ],
    ModelProviders: [
      model("main", "gpt-main", true),
      model("child-a", "gpt-child-a", true),
      model("child-b", "gpt-child-b", true),
      model("outside", "gpt-outside", true),
      model("embedding", "text-embedding", false),
    ],
    Extensions: {
      "agent-delegation": {
        Configuration: { modelPool },
      },
    },
  };
}

function model(id: string, name: string, chat: boolean) {
  return {
    Id: id,
    ProviderId: "test-provider",
    Endpoint: "Responses" as const,
    Model: name,
    Capabilities: { Chat: chat },
  };
}
