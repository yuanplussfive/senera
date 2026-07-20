import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentModelEndpointClient } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelEndpointClient.js";
import type { AgentLanguageModelRequest } from "../../../Source/AgentSystem/ModelEndpoints/AgentLanguageModel.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { collectModelStream, createSseResponse } from "./ModelEndpointTestFixtures.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent model endpoint client", () => {
  test("emits normalized lifecycle events for non-streaming providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { content: "Completed response" } }],
        }),
      ),
    );
    const client = new AgentModelEndpointClient(createSystemConfig({ stream: false }));
    const events: AgentDomainEvent[] = [];

    await expect(client.complete(requestWithEvents(events))).resolves.toMatchObject({
      text: "Completed response",
      usage: { source: "local_estimate" },
    });

    expect(events.map((event) => event.kind)).toEqual([AgentEventKinds.ModelStarted, AgentEventKinds.ModelCompleted]);
    expect(events[1]).toMatchObject({
      data: {
        text: "Completed response",
        provider: client.metadata,
        usage: { source: "local_estimate" },
      },
    });
  });

  test("converts provider SSE chunks into unified deltas and does not expose credentials in events", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          createSseResponse([
            'data: {"choices":[{"delta":{"content":"First "}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"second"}}]}\n\n',
            'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11}}\n\n',
            "data: [DONE]\n\n",
          ]),
        ),
    );
    const client = new AgentModelEndpointClient(createSystemConfig({ stream: true }));
    const events: AgentDomainEvent[] = [];

    const stream = await client.stream(requestWithEvents(events));
    await expect(collectModelStream(stream)).resolves.toEqual([
      { textDelta: "First ", accumulatedText: "First " },
      { textDelta: "second", accumulatedText: "First second" },
    ]);

    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.ModelStarted,
      AgentEventKinds.ModelDelta,
      AgentEventKinds.ModelDelta,
      AgentEventKinds.ModelCompleted,
    ]);
    expect(stream.usage).toMatchObject({
      source: "provider_reported",
      inputTokens: 9,
      outputTokens: 2,
      totalTokens: 11,
    });
    expect(JSON.stringify(events)).not.toContain("test-secret");
  });

  test("rejects provider configurations without an API key before issuing a request", () => {
    expect(() => new AgentModelEndpointClient(createSystemConfig({ apiKey: "" }))).toThrow();
  });
});

function requestWithEvents(events: AgentDomainEvent[]): AgentLanguageModelRequest {
  return {
    requestId: "request-model-client",
    step: 3,
    systemPrompt: "Follow policy.",
    messages: [{ role: "user", content: "Summarize this." }],
    onEvent: (event) => {
      events.push(event);
    },
  };
}

function createSystemConfig({
  apiKey = "test-secret",
  stream,
}: {
  apiKey?: string;
  stream?: boolean;
}): AgentSystemConfig {
  return {
    DefaultModelProviderId: "main",
    ModelProviderEndpoints: [
      {
        Id: "test-endpoint",
        Enabled: true,
        Kind: "OpenAICompatible",
        BaseUrl: "https://gateway.example/v1",
        ApiKey: apiKey,
        ApiVersion: "2023-06-01",
        Headers: {},
      },
    ],
    ModelProviders: [
      {
        Id: "main",
        ProviderId: "test-endpoint",
        Endpoint: "ChatCompletions",
        Model: "test-model",
        Stream: stream,
      },
    ],
  };
}
