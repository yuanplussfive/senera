import assert from "node:assert/strict";
import { OpenAiResponsesEndpoint } from "../Source/AgentSystem/ModelEndpoints/OpenAiResponsesEndpoint.js";
import { OpenAiChatCompletionsEndpoint } from "../Source/AgentSystem/ModelEndpoints/OpenAiChatCompletionsEndpoint.js";
import { GoogleGenerateContentEndpoint } from "../Source/AgentSystem/ModelEndpoints/GoogleGenerateContentEndpoint.js";
import { ClaudeMessagesEndpoint } from "../Source/AgentSystem/ModelEndpoints/ClaudeMessagesEndpoint.js";
import type { AgentLanguageModelRequest } from "../Source/AgentSystem/AgentLanguageModel.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types.js";
import type { EndpointRuntime, JsonObject, ModelHttpPathSegment } from "../Source/AgentSystem/ModelEndpoints/ModelEndpointTypes.js";

type CapturedRequest = {
  path: ModelHttpPathSegment[];
  payload: unknown;
};

class CaptureHttpClient {
  readonly requests: CapturedRequest[] = [];

  async postJson(path: ModelHttpPathSegment[], payload: unknown): Promise<JsonObject> {
    this.requests.push({
      path,
      payload,
    });
    return {
      output_text: "",
      choices: [{
        message: {
          content: "",
        },
      }],
      candidates: [{
        content: {
          parts: [{
            text: "",
          }],
        },
      }],
      content: [],
    };
  }

  postSseStream(): never {
    throw new Error("stream is not used by this verification script");
  }
}

const request: AgentLanguageModelRequest = {
  requestId: "verify",
  step: 1,
  systemPrompt: "system",
  messages: [{
    role: "user",
    content: "hello",
  }],
};

const baseConfig: ResolvedAgentModelProviderConfig = {
  Id: "test",
  Kind: "OpenAICompatible",
  Endpoint: "Responses",
  BaseUrl: "https://example.test/v1",
  ApiKey: "test",
  ApiVersion: "2023-06-01",
  Model: "test-model",
  Temperature: 0.2,
  MaxOutputTokens: -1,
  Stream: false,
  TimeoutMs: 1000,
  FirstTokenTimeoutMs: -1,
  MaxRequestMs: -1,
  MaxNetworkRetries: 0,
  Headers: {},
};

async function capturePayload(
  endpoint: "Responses" | "ChatCompletions" | "GoogleGenerateContent" | "ClaudeMessages",
  maxOutputTokens: number,
): Promise<unknown> {
  const http = new CaptureHttpClient();
  const runtime: EndpointRuntime = {
    config: {
      ...baseConfig,
      Endpoint: endpoint,
      MaxOutputTokens: maxOutputTokens,
    },
    http: http as never,
  };

  if (endpoint === "Responses") {
    await new OpenAiResponsesEndpoint(runtime).complete(request);
  } else if (endpoint === "ChatCompletions") {
    await new OpenAiChatCompletionsEndpoint(runtime).complete(request);
  } else if (endpoint === "GoogleGenerateContent") {
    await new GoogleGenerateContentEndpoint(runtime).complete(request);
  } else {
    await new ClaudeMessagesEndpoint(runtime).complete(request);
  }

  return http.requests[0]?.payload;
}

async function main(): Promise<void> {
  assert.deepEqual(
    Object.hasOwn(await capturePayload("Responses", -1) as Record<string, unknown>, "max_output_tokens"),
    false,
  );
  assert.equal((await capturePayload("Responses", 123) as Record<string, unknown>).max_output_tokens, 123);

  assert.deepEqual(
    Object.hasOwn(await capturePayload("ChatCompletions", -1) as Record<string, unknown>, "max_tokens"),
    false,
  );
  assert.equal((await capturePayload("ChatCompletions", 123) as Record<string, unknown>).max_tokens, 123);

  const googleUnlimited = await capturePayload("GoogleGenerateContent", -1) as {
    generationConfig: Record<string, unknown>;
  };
  assert.deepEqual(Object.hasOwn(googleUnlimited.generationConfig, "maxOutputTokens"), false);

  const googleLimited = await capturePayload("GoogleGenerateContent", 123) as {
    generationConfig: Record<string, unknown>;
  };
  assert.equal(googleLimited.generationConfig.maxOutputTokens, 123);

  assert.deepEqual(
    Object.hasOwn(await capturePayload("ClaudeMessages", -1) as Record<string, unknown>, "max_tokens"),
    false,
  );
  assert.equal((await capturePayload("ClaudeMessages", 123) as Record<string, unknown>).max_tokens, 123);

  console.log("MaxOutputTokens verification passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
