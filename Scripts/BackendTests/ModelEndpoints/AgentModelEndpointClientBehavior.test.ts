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

  test("fails over to the next endpoint in the priority pool when the primary errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input instanceof URL ? input : input);
      if (url.includes("primary.example")) throw new Error("primary unreachable");
      return Response.json({ choices: [{ message: { content: "Fallback response" } }] });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const client = new AgentModelEndpointClient(createPooledSystemConfig({ stream: false }));

    await expect(client.complete(requestWithEvents([]))).resolves.toMatchObject({
      text: "Fallback response",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("throws the last error when every endpoint in the pool fails", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("pool exhausted")));
    const client = new AgentModelEndpointClient(createPooledSystemConfig({ stream: false }));

    await expect(client.complete(requestWithEvents([]))).rejects.toThrow("pool exhausted");
  });

  test("fails over to the fallback endpoint when the primary stream cannot be established", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input instanceof URL ? input : input);
      if (url.includes("primary.example")) throw new Error("stream unavailable");
      return createSseResponse(['data: {"choices":[{"delta":{"content":"streamed"}}]}\n\n', "data: [DONE]\n\n"]);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const client = new AgentModelEndpointClient(createPooledSystemConfig({ stream: true }));

    const stream = await client.stream(requestWithEvents([]));
    await expect(collectModelStream(stream)).resolves.toEqual([{ textDelta: "streamed", accumulatedText: "streamed" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("prefers the highest-priority healthy endpoint and applies per-endpoint base URLs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input instanceof URL ? input : input);
      return Response.json({
        choices: [{ message: { content: url.includes("primary.example") ? "from-primary" : "from-fallback" } }],
      });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const client = new AgentModelEndpointClient(createPooledSystemConfig({ stream: false }));

    await expect(client.complete(requestWithEvents([]))).resolves.toMatchObject({
      text: "from-primary",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

function createPooledSystemConfig({ stream }: { stream?: boolean }): AgentSystemConfig {
  return {
    DefaultModelProviderId: "main",
    ModelProviderEndpoints: [
      {
        Id: "primary-endpoint",
        Enabled: true,
        Kind: "OpenAICompatible",
        BaseUrl: "https://primary.example/v1",
        ApiKey: "test-secret",
        ApiVersion: "2023-06-01",
        Headers: {},
        ProviderId: "pool",
        Priority: 0,
      },
      {
        Id: "fallback-endpoint",
        Enabled: true,
        Kind: "OpenAICompatible",
        BaseUrl: "https://fallback.example/v1",
        ApiKey: "test-secret",
        ApiVersion: "2023-06-01",
        Headers: {},
        ProviderId: "pool",
        Priority: 1,
      },
    ],
    ModelProviders: [
      {
        Id: "main",
        ProviderId: "pool",
        Endpoint: "ChatCompletions",
        Model: "test-model",
        Stream: stream,
        MaxNetworkRetries: 0,
      },
    ],
  };
}
