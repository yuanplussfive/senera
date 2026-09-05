import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { b as baml } from "../../../Source/AgentSystem/BamlClient/baml_client/index.js";
import type { AgentBamlModelRequest } from "../../../Source/AgentSystem/BamlClient/AgentBamlStructuredOutputRunner.js";
import { AgentActionPlannerModelTransport } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerModelTransport.js";
import type { AgentLanguageModelImageAttachment } from "../../../Source/AgentSystem/ModelEndpoints/AgentLanguageModel.js";
import type { AgentNativeToolApiStreams } from "../../../Source/AgentSystem/ModelEndpoints/AgentNativeToolApiStreams.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("Action planner model transport", () => {
  test("uses Pi's declared vendor adapter and returns BAML-parseable structured output", async () => {
    const requests: Array<{
      model: Model<Api>;
      context: Context;
      options: SimpleStreamOptions | undefined;
    }> = [];
    const transport = new AgentActionPlannerModelTransport(
      modelProvider({ Endpoint: "ClaudeMessages" }),
      undefined,
      undefined,
      {
        apiStreams: piStreams((model, context, options) => {
          requests.push({ model, context, options: options as SimpleStreamOptions | undefined });
          return completedStream(
            model,
            '{"kind":"Execute","fragment":{"preface":"I will inspect it.","calls":[{"toolName":"WorkspaceRead","purpose":"Read the package metadata.","required":true}]}}',
          );
        }),
      },
    );

    const output = await transport.complete(
      request({ attachments: [{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }] }),
    );
    const decision = baml.parse.EvolveTurn(output);

    expect(decision).toMatchObject({
      kind: "Execute",
      fragment: {
        preface: "I will inspect it.",
        calls: [{ toolName: "WorkspaceRead", purpose: "Read the package metadata.", required: true }],
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: { api: "anthropic-messages", id: "test-model" },
      options: {
        apiKey: "test-key",
        temperature: 0,
        timeoutMs: 5_000,
        maxRetries: 0,
        maxRetryDelayMs: 0,
      },
    });
    expect(requests[0]?.context.systemPrompt).toContain("Return only ControllerDecision.");
    expect(requests[0]?.context.systemPrompt).toContain("Planner-specific guidance.");
    expect(requests[0]?.context.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: [
          { type: "text", text: "<planner_input>Inspect package metadata.</planner_input>" },
          { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
        ],
      }),
    ]);
  });

  test("propagates Pi cache accounting to structured-call timing", async () => {
    const timings: unknown[] = [];
    const transport = new AgentActionPlannerModelTransport(
      modelProvider({ Endpoint: "ClaudeMessages" }),
      undefined,
      (timing) => {
        timings.push(timing);
      },
      {
        apiStreams: piStreams((model, context, options) => {
          expect(context.messages).toHaveLength(1);
          expect(options).toMatchObject({
            sessionId: expect.any(String),
            cacheRetention: "long",
          });
          return completedStream(model, '{"kind":"Direct","response":"已完成。"}', {
            cacheRead: 128,
            cacheWrite: 32,
          });
        }),
      },
    );

    await expect(
      transport.complete(request({ cache: { scope: "cache-scope", retention: "long" } })),
    ).resolves.toContain("Direct");
    expect(timings).toEqual([
      expect.objectContaining({
        status: "completed",
        cacheReadTokens: 128,
        cacheWriteTokens: 32,
      }),
    ]);
  });

  test("retries an empty Pi completion before returning structured text", async () => {
    const responses = ["", '{"kind":"Direct","response":"Completed."}'];
    const stream = vi.fn((model: Model<Api>) => completedStream(model, responses.shift() ?? ""));
    const transport = new AgentActionPlannerModelTransport(
      modelProvider({ MaxNetworkRetries: 1 }),
      undefined,
      undefined,
      {
        apiStreams: piStreams(stream),
      },
    );

    await expect(transport.complete(request())).resolves.toBe('{"kind":"Direct","response":"Completed."}');
    expect(stream).toHaveBeenCalledTimes(2);
  });

  test("reports explicit Pi completion diagnostics after every empty response", async () => {
    const responses = [
      completedStream({} as Model<Api>, "", { stopReason: "length", output: 64, reasoning: 64 }),
      completedStream({} as Model<Api>, "", { output: 1 }),
    ];
    const transport = new AgentActionPlannerModelTransport(
      modelProvider({ MaxNetworkRetries: 1 }),
      undefined,
      undefined,
      {
        apiStreams: piStreams((model) => responses.shift() ?? completedStream(model, "")),
      },
    );
    const completion = transport.complete(request());

    await expect(completion).rejects.toEqual(
      expect.objectContaining({
        name: "AgentEmptyModelResponseError",
        providerId: "test-model",
        model: "test-model",
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
  });
});

function piStreams(
  stream: (
    model: Model<Api>,
    context: Context,
    options?: StreamOptions | SimpleStreamOptions,
  ) => AssistantMessageEventStream,
): AgentNativeToolApiStreams {
  const providerStreams: ProviderStreams = {
    stream: (model, context, options) => stream(model, context, options),
    streamSimple: (model, context, options) => stream(model, context, options),
  };
  return {
    "openai-responses": providerStreams,
    "openai-completions": providerStreams,
    "anthropic-messages": providerStreams,
    "google-generative-ai": providerStreams,
  };
}

function completedStream(
  model: Model<Api>,
  text: string,
  overrides: Partial<
    Pick<AssistantMessage, "stopReason" | "rawStopReason"> & {
      output: number;
      reasoning?: number;
      cacheRead?: number;
      cacheWrite?: number;
    }
  > = {},
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: text ? [{ type: "text", text }] : [],
    usage: {
      input: 6,
      output: overrides.output ?? 3,
      cacheRead: overrides.cacheRead ?? 2,
      cacheWrite: overrides.cacheWrite ?? 0,
      reasoning: overrides.reasoning,
      totalTokens: 8 + (overrides.output ?? 3),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: overrides.stopReason ?? "stop",
    ...(overrides.rawStopReason ? { rawStopReason: overrides.rawStopReason } : {}),
    timestamp: Date.now(),
  };
  stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
  stream.push({ type: "done", reason: message.stopReason === "length" ? "length" : "stop", message });
  stream.end(message);
  return stream;
}

function request(
  overrides: Omit<Partial<AgentBamlModelRequest>, "messages"> & {
    attachments?: readonly AgentLanguageModelImageAttachment[];
  } = {},
): AgentBamlModelRequest {
  return {
    requestId: "action-planner:EvolveTurn",
    step: 1,
    systemPrompt: "Return only ControllerDecision.",
    messages: [
      { role: "developer", content: "Planner-specific guidance." },
      {
        role: "user",
        content: "<planner_input>Inspect package metadata.</planner_input>",
        ...(overrides.attachments ? { attachments: overrides.attachments } : {}),
      },
    ],
    ...overrides,
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
    ToolPlanningMode: "baml",
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
