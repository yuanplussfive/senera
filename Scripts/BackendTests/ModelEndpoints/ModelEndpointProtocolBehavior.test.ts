import { describe, expect, test } from "vitest";
import { rawPathSegment } from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpClient.js";
import { createModelEndpoint } from "../../../Source/AgentSystem/ModelEndpoints/ModelEndpointTypes.js";
import {
  createModelEndpointRuntime,
  createModelRequest,
  createStaticModelStream,
  readHeaders,
  readRecord,
  RecordingModelHttp,
  type RecordedJsonRequest,
  type RecordedSseRequest,
} from "./ModelEndpointTestFixtures.js";

const endpointProtocols = [
  {
    name: "OpenAI Chat Completions",
    endpoint: "ChatCompletions",
    completeResponse: {
      choices: [{ message: { content: [{ text: "Hello " }, { text: "world" }] } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
        prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
        completion_tokens_details: { reasoning_tokens: 1 },
      },
    },
    completeText: "Hello world",
    streamEvent: { choices: [{ delta: { content: "delta" } }] },
    usageEvent: {
      choices: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
        prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
        completion_tokens_details: { reasoning_tokens: 1 },
      },
    },
    expectedUsage: {
      source: "provider_reported",
      inputTokens: 7,
      outputTokens: 4,
      totalTokens: 14,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      reasoningTokens: 1,
    },
    expectedPath: ["chat", "completions"],
    assertJsonRequest(request: RecordedJsonRequest) {
      expect(readHeaders(request.headers).get("authorization")).toBe("Bearer test-key");
      expect(readRecord(request.payload)).toMatchObject({ model: "test-model", temperature: 0 });
      expect(readRecord(request.payload).messages).toEqual([
        {
          role: "system",
          content:
            "<system_instructions>\nFollow the system instruction.\n</system_instructions>\n\n<developer_instructions>\nUse concise answers.\n</developer_instructions>",
        },
        { role: "user", content: "Explain the current status." },
      ]);
    },
  },
  {
    name: "OpenAI Responses",
    endpoint: "Responses",
    completeResponse: {
      output: [{ content: [{ text: "Response " }, { text: "text" }] }],
      usage: {
        input_tokens: 12,
        output_tokens: 5,
        total_tokens: 17,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 },
      },
    },
    completeText: "Response text",
    streamEvent: { type: "response.output_text.delta", delta: "delta" },
    usageEvent: {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 12,
          output_tokens: 5,
          total_tokens: 17,
          input_tokens_details: { cached_tokens: 3 },
          output_tokens_details: { reasoning_tokens: 2 },
        },
      },
    },
    expectedUsage: {
      source: "provider_reported",
      inputTokens: 9,
      outputTokens: 5,
      totalTokens: 17,
      cacheReadTokens: 3,
      reasoningTokens: 2,
    },
    expectedPath: ["responses"],
    assertJsonRequest(request: RecordedJsonRequest) {
      expect(readHeaders(request.headers).get("authorization")).toBe("Bearer test-key");
      expect(readRecord(request.payload)).toMatchObject({ model: "test-model", temperature: 0 });
      expect(readRecord(request.payload).input).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: "user" })]),
      );
    },
  },
  {
    name: "Claude Messages",
    endpoint: "ClaudeMessages",
    completeResponse: {
      content: [
        { type: "tool_use", text: "ignored" },
        { type: "text", text: "Claude " },
        { type: "text", text: "text" },
      ],
      usage: {
        input_tokens: 8,
        output_tokens: 3,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 1,
      },
    },
    completeText: "Claude text",
    streamEvent: { type: "content_block_delta", delta: { text: "delta" } },
    usageEvent: {
      type: "message_delta",
      usage: {
        input_tokens: 8,
        output_tokens: 3,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 1,
      },
    },
    expectedUsage: {
      source: "provider_reported",
      inputTokens: 8,
      outputTokens: 3,
      totalTokens: 14,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    },
    expectedPath: ["messages"],
    assertJsonRequest(request: RecordedJsonRequest) {
      const headers = readHeaders(request.headers);
      expect(headers.get("x-api-key")).toBe("test-key");
      expect(headers.get("anthropic-version")).toBe("");
      expect(readRecord(request.payload)).toMatchObject({ model: "test-model", stream: false });
      expect(readRecord(request.payload).messages).toEqual([{ role: "user", content: "Explain the current status." }]);
    },
  },
  {
    name: "Google Generate Content",
    endpoint: "GoogleGenerateContent",
    completeResponse: {
      candidates: [{ content: { parts: [{ text: "Google " }, { text: "text" }] } }],
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 4,
        totalTokenCount: 16,
        cachedContentTokenCount: 2,
        thoughtsTokenCount: 1,
      },
    },
    completeText: "Google text",
    streamEvent: { candidates: [{ content: { parts: [{ text: "delta" }] } }] },
    usageEvent: {
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 4,
        totalTokenCount: 16,
        cachedContentTokenCount: 2,
        thoughtsTokenCount: 1,
      },
    },
    expectedUsage: {
      source: "provider_reported",
      inputTokens: 9,
      outputTokens: 5,
      totalTokens: 16,
      cacheReadTokens: 2,
      reasoningTokens: 1,
    },
    expectedPath: ["models", rawPathSegment("test-model:generateContent")],
    assertJsonRequest(request: RecordedJsonRequest) {
      expect(readHeaders(request.headers).get("x-goog-api-key")).toBe("test-key");
      expect(readRecord(request.payload)).toMatchObject({
        systemInstruction: { parts: expect.any(Array) },
        generationConfig: { temperature: 0 },
      });
      expect(readRecord(request.payload).contents).toEqual([
        { role: "user", parts: [{ text: "Explain the current status." }] },
      ]);
    },
  },
] as const;

describe("model endpoint protocol adapters", () => {
  test.each(endpointProtocols)("projects $name completion requests and responses", async (protocol) => {
    const http = new RecordingModelHttp({ json: protocol.completeResponse });
    const endpoint = createModelEndpoint(
      protocol.endpoint,
      createModelEndpointRuntime(http, { Endpoint: protocol.endpoint }),
    );

    await expect(endpoint.complete(createModelRequest())).resolves.toEqual({
      text: protocol.completeText,
      usage: protocol.expectedUsage,
    });

    const request = http.jsonRequests[0];
    expect(request?.path).toEqual(protocol.expectedPath);
    protocol.assertJsonRequest(request as RecordedJsonRequest);
  });

  test.each(endpointProtocols)("projects $name stream setup and event deltas", async (protocol) => {
    const http = new RecordingModelHttp({ stream: createStaticModelStream(["unused"]) });
    const endpoint = createModelEndpoint(
      protocol.endpoint,
      createModelEndpointRuntime(http, { Endpoint: protocol.endpoint }),
    );

    const stream = await endpoint.stream(createModelRequest());

    expect(stream.metadata).toMatchObject({ model: "test-model" });
    const request = http.sseRequests[0] as RecordedSseRequest;
    expect(request.path).toEqual(
      protocol.endpoint === "GoogleGenerateContent"
        ? ["models", rawPathSegment("test-model:streamGenerateContent")]
        : protocol.expectedPath,
    );
    expect(readRecord(request.payload)).toMatchObject(
      protocol.endpoint === "GoogleGenerateContent" ? { generationConfig: { temperature: 0 } } : { stream: true },
    );
    if (protocol.endpoint === "GoogleGenerateContent") {
      expect(request.query).toEqual({ alt: "sse" });
    }
    expect(request.projectEvent(protocol.streamEvent)).toEqual({ textDelta: "delta", usage: undefined });
    expect(request.projectEvent(protocol.usageEvent)).toEqual({ textDelta: "", usage: protocol.expectedUsage });
    if (protocol.endpoint === "ChatCompletions") {
      expect(readRecord(request.payload)).toMatchObject({ stream_options: { include_usage: true } });
    }
  });

  test("allows OpenAI-compatible gateways to disable streaming usage requests", async () => {
    const http = new RecordingModelHttp({ stream: createStaticModelStream([]) });
    const endpoint = createModelEndpoint(
      "ChatCompletions",
      createModelEndpointRuntime(http, {
        Endpoint: "ChatCompletions",
        Capabilities: { StreamingUsage: false },
      }),
    );

    await endpoint.stream(createModelRequest());

    expect(readRecord(http.sseRequests[0]?.payload)).not.toHaveProperty("stream_options");
  });

  test("accepts OpenAI-compatible usage nested in the first stream choice", async () => {
    const http = new RecordingModelHttp({ stream: createStaticModelStream([]) });
    const endpoint = createModelEndpoint("ChatCompletions", createModelEndpointRuntime(http));

    await endpoint.stream(createModelRequest());

    expect(
      http.sseRequests[0]?.projectEvent({
        choices: [
          {
            delta: {},
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          },
        ],
      }),
    ).toEqual({
      textDelta: "",
      usage: {
        source: "provider_reported",
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
      },
    });
  });
});
