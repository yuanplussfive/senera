import { describe, expect, test, vi } from "vitest";
import type { AgentBamlModelRequest } from "../../../Source/AgentSystem/BamlClient/AgentBamlStructuredOutputRunner.js";
import { AgentActionPlannerModelTransport } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerModelTransport.js";
import { createModelProviderMetadata } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelMetadata.js";
import type { TextGenerationEndpoint } from "../../../Source/AgentSystem/ModelEndpoints/ModelEndpointTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("Action planner model transport", () => {
  test("retries an empty completed response before returning structured text", async () => {
    const provider = modelProvider({ MaxNetworkRetries: 1 });
    const endpoint = scriptedEndpoint(["", '{"candidates":[]}'], provider);
    const transport = transportWithEndpoint(provider, endpoint);

    await expect(transport.complete(request())).resolves.toBe('{"candidates":[]}');
    expect(endpoint.stream).toHaveBeenCalledTimes(2);
  });

  test("reports an explicit provider error after every empty response", async () => {
    const provider = modelProvider({ MaxNetworkRetries: 1 });
    const endpoint = scriptedEndpoint(
      [
        {
          text: "",
          completion: { finishReason: "length" },
          usage: providerUsage({ outputTokens: 64, reasoningTokens: 64 }),
        },
        {
          text: "",
          completion: { finishReason: "stop" },
          usage: providerUsage({ outputTokens: 1 }),
        },
      ],
      provider,
    );
    const transport = transportWithEndpoint(provider, endpoint);
    const completion = transport.complete(request());

    await expect(completion).rejects.toEqual(
      expect.objectContaining({
        name: "AgentEmptyModelResponseError",
        providerId: provider.Id,
        model: provider.Model,
        attempts: 2,
        responses: [
          {
            attempt: 1,
            finishReason: "length",
            status: null,
            outputTokens: 64,
            reasoningTokens: 64,
          },
          {
            attempt: 2,
            finishReason: "stop",
            status: null,
            outputTokens: 1,
            reasoningTokens: null,
          },
        ],
      }),
    );
    await expect(completion).rejects.toThrow('"finishReason":"length"');
  });
});

function transportWithEndpoint(
  provider: ResolvedAgentModelProviderConfig,
  endpoint: TextGenerationEndpoint,
): AgentActionPlannerModelTransport {
  const transport = new AgentActionPlannerModelTransport(provider);
  (transport as unknown as { endpoint: TextGenerationEndpoint }).endpoint = endpoint;
  return transport;
}

function scriptedEndpoint(
  responses: readonly ScriptedResponse[],
  provider: ResolvedAgentModelProviderConfig,
): TextGenerationEndpoint & { stream: ReturnType<typeof vi.fn<TextGenerationEndpoint["stream"]>> } {
  const queue = [...responses];
  const stream = vi.fn<TextGenerationEndpoint["stream"]>(async () => {
    const response = normalizeScriptedResponse(queue.shift());
    return {
      metadata: createModelProviderMetadata(provider),
      usage: response.usage,
      completion: response.completion,
      abort: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield { textDelta: response.text, accumulatedText: response.text };
      },
    };
  });
  return {
    complete: async () => normalizeScriptedResponse(queue.shift()),
    stream,
  };
}

type ScriptedResponse = string | Awaited<ReturnType<TextGenerationEndpoint["complete"]>>;

function normalizeScriptedResponse(response: ScriptedResponse | undefined) {
  return typeof response === "string" ? { text: response } : (response ?? { text: "" });
}

function providerUsage(values: { outputTokens: number; reasoningTokens?: number }) {
  return {
    source: "provider_reported" as const,
    ...values,
  };
}

function request(): AgentBamlModelRequest {
  return {
    requestId: "action-planner:learn-memory",
    step: 1,
    systemPrompt: "Return structured output.",
    messages: [{ role: "user", content: "Learn durable memory." }],
  };
}

function modelProvider(overrides: Partial<ResolvedAgentModelProviderConfig> = {}): ResolvedAgentModelProviderConfig {
  return {
    Id: "test-model",
    ProviderId: "test-endpoint",
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://model.example/v1",
    ApiKey: "test-key",
    ApiVersion: "",
    Model: "test-model",
    ContextWindowTokens: 128_000,
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutMs: 5_000,
    FirstTokenTimeoutMs: 5_000,
    MaxRequestMs: 5_000,
    MaxNetworkRetries: 0,
    RetryBaseDelayMs: 0,
    RetryMaxDelayMs: 0,
    RetryAfterMaxDelayMs: 0,
    Headers: {},
    ...overrides,
  };
}
