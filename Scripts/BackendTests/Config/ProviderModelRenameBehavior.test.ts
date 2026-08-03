import { describe, expect, it } from "vitest";
import {
  AgentProviderModelConfigCommandError,
  renameProviderEndpoint,
} from "../../../Source/AgentSystem/Config/AgentProviderModelConfigCommands.js";
import { resolveModelProviderConfig } from "../../../Source/AgentSystem/Defaults/AgentModelProviderDefaults.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("provider model rename behavior", () => {
  it("migrates canonical model ids and every persisted model reference", () => {
    const renamed = renameProviderEndpoint(renameConfig(), {
      commandId: "rename-provider",
      providerId: "custom",
      nextProviderId: "renamed",
    });

    expect(renamed.ModelProviders).toEqual([
      expect.objectContaining({ Id: "renamed/chat", ProviderId: "renamed" }),
      expect.objectContaining({ Id: "stable-model-id", ProviderId: "renamed" }),
    ]);
    expect(renamed.DefaultModelProviderId).toBe("renamed/chat");
    expect(renamed.ModelProviderIdAliases).toEqual({
      "historical/chat": "renamed/chat",
      "custom/chat": "renamed/chat",
    });
    expect(renamed.ModelGroups?.[0]).toMatchObject({
      Match: "exact",
      Values: ["renamed/chat", "stable-model-id"],
      Strategies: [{ Match: "exact", Values: ["renamed/chat"] }],
    });
    expect(renamed.ActionPlanner?.Client?.ModelProviderId).toBe("renamed/chat");
    expect(renamed.ActionPlanner?.PlanningClient?.ModelProviderId).toBe("stable-model-id");
    expect(renamed.ActionPlanner?.FinalAnswerClient?.ModelProviderId).toBe("renamed/chat");
    expect(renamed.ToolLearning?.Client?.ModelProviderId).toBe("renamed/chat");
    expect(renamed.Defaults?.ActionPlanner?.Client?.ModelProviderId).toBe("renamed/chat");
    expect(renamed.Defaults?.ToolLearning?.Client?.ModelProviderId).toBe("renamed/chat");

    expect(resolveModelProviderConfig(renamed, "custom/chat").Id).toBe("renamed/chat");
    expect(resolveModelProviderConfig(renamed, "historical/chat").Id).toBe("renamed/chat");
  });

  it("rejects a rename that would collide with an existing model id", () => {
    const config = renameConfig();
    config.ModelProviders.push({
      Id: "renamed/chat",
      ProviderId: "openai",
      Endpoint: "Responses",
      Model: "existing-model",
    });

    expect(() =>
      renameProviderEndpoint(config, {
        commandId: "rename-provider-conflict",
        providerId: "custom",
        nextProviderId: "renamed",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentProviderModelConfigCommandError>>({
        code: "provider_model_rename_conflict",
      }),
    );
  });
});

function renameConfig(): AgentSystemConfig {
  return {
    ModelProviderEndpoints: [
      {
        Id: "custom",
        BaseUrl: "https://custom.example.test/v1",
        ApiKey: "secret",
      },
    ],
    ModelProviders: [
      {
        Id: "custom/chat",
        ProviderId: "custom",
        Endpoint: "Responses",
        Model: "chat",
      },
      {
        Id: "stable-model-id",
        ProviderId: "custom",
        Endpoint: "ChatCompletions",
        Model: "stable",
      },
    ],
    DefaultModelProviderId: "custom/chat",
    ModelProviderIdAliases: {
      "historical/chat": "custom/chat",
    },
    ModelGroups: [
      {
        Id: "exact-group",
        Label: "Exact",
        Match: "exact",
        Values: ["custom/chat", "stable-model-id"],
        Strategies: [{ Match: "exact", Values: ["custom/chat"] }],
      },
    ],
    ActionPlanner: {
      Client: { ModelProviderId: "custom/chat" },
      PlanningClient: { ModelProviderId: "stable-model-id" },
      FinalAnswerClient: { ModelProviderId: "custom/chat" },
    },
    ToolLearning: { Client: { ModelProviderId: "custom/chat" } },
    Defaults: {
      ActionPlanner: { Client: { ModelProviderId: "custom/chat" } },
      ToolLearning: { Client: { ModelProviderId: "custom/chat" } },
    },
  };
}
