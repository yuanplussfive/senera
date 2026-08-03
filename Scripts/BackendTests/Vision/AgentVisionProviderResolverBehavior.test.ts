import { describe, expect, it } from "vitest";
import { AgentLocalizedError } from "../../../Source/AgentSystem/I18n/AgentLocalizedError.js";
import { resolveAgentVisionProvider } from "../../../Source/AgentSystem/Vision/AgentVisionProviderResolver.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("Agent vision provider resolver", () => {
  it("honors an explicitly configured vision model over the conversation model", () => {
    const provider = resolveAgentVisionProvider(testConfig(), {
      conversationModelProviderId: "chat-model",
      configuredModelProviderId: "vision-model",
    });

    expect(provider.Id).toBe("vision-model");
  });

  it("falls back from a non-vision conversation model to an available vision model", () => {
    const provider = resolveAgentVisionProvider(testConfig(), {
      conversationModelProviderId: "chat-model",
    });

    expect(provider.Id).toBe("vision-model");
  });

  it.each([
    ["missing-model", "vision.modelNotFound"],
    ["chat-model", "vision.modelNotCapable"],
  ])("rejects invalid explicit model %s with a stable message key", (modelProviderId, messageKey) => {
    let failure: unknown;
    try {
      resolveAgentVisionProvider(testConfig(), { configuredModelProviderId: modelProviderId });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AgentLocalizedError);
    expect(failure).toMatchObject({ messageKey, messageParams: { modelProviderId } });
  });
});

function testConfig(): AgentSystemConfig {
  return {
    DefaultModelProviderId: "chat-model",
    ModelProviderEndpoints: [{ Id: "openai", Enabled: true, BaseUrl: "https://example.test/v1" }],
    ModelProviders: [
      {
        Id: "chat-model",
        ProviderId: "openai",
        Endpoint: "ChatCompletions",
        Model: "chat-model",
        Capabilities: { Vision: false },
      },
      {
        Id: "vision-model",
        ProviderId: "openai",
        Endpoint: "ChatCompletions",
        Model: "vision-model",
        Capabilities: { Vision: true },
      },
    ],
  };
}
