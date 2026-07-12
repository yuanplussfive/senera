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
    },
    completeText: "Hello world",
    streamEvent: { choices: [{ delta: { content: "delta" } }] },
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
    },
    completeText: "Response text",
    streamEvent: { type: "response.output_text.delta", delta: "delta" },
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
    },
    completeText: "Claude text",
    streamEvent: { type: "content_block_delta", delta: { text: "delta" } },
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
    },
    completeText: "Google text",
    streamEvent: { candidates: [{ content: { parts: [{ text: "delta" }] } }] },
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

    await expect(endpoint.complete(createModelRequest())).resolves.toEqual({ text: protocol.completeText });

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
    expect(request.extractText(protocol.streamEvent)).toBe("delta");
  });
});
