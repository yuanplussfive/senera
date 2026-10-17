import { describe, expect, test } from "vitest";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { resolveAgentPiCompactionReserveTokens } from "../../../Source/AgentSystem/Pi/AgentPiCompactionSettings.js";
import type { Model } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { stream as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  AgentModelEndpointKinds,
  AgentNativeToolApiByEndpoint,
  resolveAgentNativeToolRoute,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentModelEndpointContract.js";

describe("Pi projection behavior", () => {
  test.each(AgentModelEndpointKinds)("projects %s providers through the BAML planning provider", (endpoint) => {
    const provider = createProvider({
      Endpoint: endpoint,
      Capabilities: {
        Vision: true,
        Reasoning: true,
        DeveloperRole: false,
      },
      ContextWindowTokens: 128_000,
      MaxModelOutputTokens: 8_192,
    });
    const projected = projectSeneraModelProviderToPi(provider);

    expect(projected.providerId).toBe("senera");
    expect(projected.model).toMatchObject({
      id: "test-model",
      name: "main",
      api: "senera-planning",
      provider: "senera",
      baseUrl: "senera://planning",
      input: ["text", "image"],
      reasoning: true,
      contextWindow: 128_000,
      maxTokens: 8_192,
    });
    expect(projected.model).not.toHaveProperty("headers");
    expect(projected.model).not.toHaveProperty("compat");
  });

  test.each(AgentModelEndpointKinds)("projects %s providers through its declared native Pi API", (endpoint) => {
    const provider = createProvider({
      Endpoint: endpoint,
      ToolPlanningMode: "native",
      Headers: { "x-senera-test": "enabled" },
      Capabilities: {
        ToolCalling: true,
        Vision: true,
        Reasoning: true,
        DeveloperRole: false,
        StreamingUsage: true,
      },
    });

    const projected = projectSeneraModelProviderToPi(provider);

    const route = resolveAgentNativeToolRoute(endpoint, provider.BaseUrl);
    expect(projected).toMatchObject({
      providerId: provider.ProviderId,
      toolPlanningMode: "native",
      model: {
        api: AgentNativeToolApiByEndpoint[endpoint],
        provider: provider.ProviderId,
        baseUrl: route.baseUrl,
        headers: { "x-senera-test": "enabled" },
      },
    });
    expect(projected.model.headers).not.toHaveProperty("Authorization");
    expect(projected.model.headers).not.toHaveProperty("x-api-key");
    expect(projected.model.headers).not.toHaveProperty("x-goog-api-key");
  });

  test.each([
    ["https://chat.senerapi.com/v1", "https://chat.senerapi.com/"],
    ["https://chat.senerapi.com/proxy/v1/", "https://chat.senerapi.com/proxy"],
    ["https://chat.senerapi.com/v11", "https://chat.senerapi.com/v11"],
  ])("normalizes only an exact Claude SDK-owned path suffix in %s", (baseUrl, expected) => {
    expect(resolveAgentNativeToolRoute("ClaudeMessages", baseUrl)).toEqual({
      api: "anthropic-messages",
      baseUrl: expected,
    });
  });

  test("sends Claude native requests to one exact /v1/messages path through the Pi adapter", async () => {
    const projected = projectSeneraModelProviderToPi(
      createProvider({
        Endpoint: "ClaudeMessages",
        BaseUrl: "https://chat.senerapi.com/v1",
        ToolPlanningMode: "native",
        Capabilities: { Chat: true, ToolCalling: true },
      }),
    );
    let requestedUrl = "";
    const fetch: typeof globalThis.fetch = async (input) => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      return new Response(
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "test stop" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    };
    const stream = streamAnthropic(
      projected.model as Model<"anthropic-messages">,
      normalizeContext({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Route probe" }],
            timestamp: Date.now(),
          },
        ],
      }),
      { apiKey: "test-key", fetch, maxRetries: 0 },
    );

    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(new URL(requestedUrl).origin).toBe("https://chat.senerapi.com");
    expect(new URL(requestedUrl).pathname).toBe("/v1/messages");
  });

  test("uses the resolved context window and bounded output metadata when output limits are unknown", () => {
    const projected = projectSeneraModelProviderToPi(
      createProvider({ ContextWindowTokens: 64_000, MaxModelOutputTokens: -1, MaxOutputTokens: -1 }),
    );

    expect(projected.model.contextWindow).toBe(64_000);
    expect(projected.model.maxTokens).toBe(resolveAgentPiCompactionReserveTokens(64_000));
  });
});

function createProvider(overrides: Partial<ResolvedAgentModelProviderConfig> = {}): ResolvedAgentModelProviderConfig {
  return {
    Id: "main",
    ProviderId: "endpoint-1",
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://model.example/v1",
    ApiKey: "secret",
    ApiVersion: "",
    Model: "test-model",
    ToolPlanningMode: "baml",
    ContextWindowTokens: 128_000,
    Temperature: 0,
    MaxOutputTokens: 1_024,
    Stream: true,
    TimeoutMs: 60_000,
    FirstTokenTimeoutMs: 10_000,
    MaxRequestMs: 120_000,
    MaxNetworkRetries: 0,
    RetryBaseDelayMs: 250,
    RetryMaxDelayMs: 10_000,
    RetryAfterMaxDelayMs: 60_000,
    Headers: {},
    ...overrides,
  };
}
