import assert from "node:assert/strict";
import { buildOpenAiInput } from "../Source/AgentSystem/ModelEndpoints/OpenAiMessageProjection.js";
import { OpenAiChatCompletionsEndpoint } from "../Source/AgentSystem/ModelEndpoints/OpenAiChatCompletionsEndpoint.js";
import { OpenAiResponsesEndpoint } from "../Source/AgentSystem/ModelEndpoints/OpenAiResponsesEndpoint.js";
import type { AgentLanguageModelRequest } from "../Source/AgentSystem/ModelEndpoints/AgentLanguageModel.js";
import { projectSeneraModelProviderToPi } from "../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import type {
  AgentSystemConfig,
  ResolvedAgentModelProviderConfig,
} from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { EndpointRuntime } from "../Source/AgentSystem/ModelEndpoints/ModelEndpointTypes.js";

const request: AgentLanguageModelRequest = {
  requestId: "verify-openai-compatible-message-projection",
  step: 1,
  systemPrompt: "runtime system",
  messages: [
    {
      role: "developer",
      content: "developer rule",
    },
    {
      role: "user",
      content: "hello",
    },
  ],
};

const systemCompatible = buildOpenAiInput(request);
assert.deepEqual(
  systemCompatible.map((message) => message.role),
  ["system", "user"],
);
assert.match(systemCompatible[0]?.content ?? "", /<system_instructions>/);
assert.match(systemCompatible[0]?.content ?? "", /runtime system/);
assert.match(systemCompatible[0]?.content ?? "", /<developer_instructions>/);
assert.match(systemCompatible[0]?.content ?? "", /developer rule/);

const nativeDeveloper = buildOpenAiInput(request, {
  supportsDeveloperRole: true,
});
assert.deepEqual(
  nativeDeveloper.map((message) => message.role),
  ["system", "developer", "user"],
);
assert.equal(nativeDeveloper[0]?.content, "runtime system");
assert.equal(nativeDeveloper[1]?.content, "developer rule");

const piProvider = projectSeneraModelProviderToPi(createProvider({ DeveloperRole: false }), createConfig());
assert.equal(piProvider.model.compat?.supportsDeveloperRole, false);

const piDeveloperProvider = projectSeneraModelProviderToPi(createProvider({ DeveloperRole: true }), createConfig());
assert.equal(piDeveloperProvider.model.compat?.supportsDeveloperRole, true);

async function verifyOpenAiEndpointPayloadProjection(): Promise<void> {
  const chatHttp = new RecordingHttpClient({ choices: [{ message: { content: "ok" } }] });
  const chatEndpoint = new OpenAiChatCompletionsEndpoint(
    createRuntime(createProvider({ DeveloperRole: false }), chatHttp),
  );
  await chatEndpoint.complete(request);
  assert.deepEqual(readMessageRoles(chatHttp.lastJsonPayload?.messages), ["system", "user"]);

  const chatDeveloperHttp = new RecordingHttpClient({ choices: [{ message: { content: "ok" } }] });
  const chatDeveloperEndpoint = new OpenAiChatCompletionsEndpoint(
    createRuntime(createProvider({ DeveloperRole: true }), chatDeveloperHttp),
  );
  await chatDeveloperEndpoint.complete(request);
  assert.deepEqual(readMessageRoles(chatDeveloperHttp.lastJsonPayload?.messages), ["system", "developer", "user"]);

  const responsesHttp = new RecordingHttpClient({ output_text: "ok" });
  const responsesEndpoint = new OpenAiResponsesEndpoint(
    createRuntime(createProvider({ DeveloperRole: false, Chat: true }), responsesHttp),
  );
  await responsesEndpoint.complete(request);
  assert.deepEqual(readMessageRoles(responsesHttp.lastJsonPayload?.input), ["system", "user"]);

  const responsesDeveloperHttp = new RecordingHttpClient({ output_text: "ok" });
  const responsesDeveloperEndpoint = new OpenAiResponsesEndpoint(
    createRuntime(createProvider({ DeveloperRole: true, Chat: true }), responsesDeveloperHttp),
  );
  await responsesDeveloperEndpoint.complete(request);
  assert.deepEqual(readMessageRoles(responsesDeveloperHttp.lastJsonPayload?.input), ["system", "developer", "user"]);
}

function createConfig(): AgentSystemConfig {
  return {
    Server: {
      Host: "127.0.0.1",
      Port: 8787,
    },
    DefaultModelProviderId: "main",
    ModelProviderEndpoints: [
      {
        Id: "main",
        BaseUrl: "https://example.invalid/v1",
        ApiKey: "test-key",
      },
    ],
    ModelProviders: [
      {
        Id: "main",
        ProviderId: "main",
        Endpoint: "ChatCompletions",
        Model: "test-model",
      },
    ],
  };
}

function createProvider(
  capabilities: NonNullable<ResolvedAgentModelProviderConfig["Capabilities"]>,
): ResolvedAgentModelProviderConfig {
  return {
    Id: "main",
    ProviderId: "main",
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test-key",
    ApiVersion: "",
    Model: "test-model",
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutMs: 20_000,
    FirstTokenTimeoutMs: 20_000,
    MaxRequestMs: 20_000,
    MaxNetworkRetries: 1,
    Headers: {},
    Capabilities: {
      Chat: true,
      Embedding: false,
      Rerank: false,
      Vision: false,
      ImageOutput: false,
      Reasoning: false,
      ...capabilities,
    },
  };
}

function createRuntime(provider: ResolvedAgentModelProviderConfig, http: RecordingHttpClient): EndpointRuntime {
  return {
    config: provider,
    http: http as unknown as EndpointRuntime["http"],
  };
}

function readMessageRoles(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const role = readRecord(item)?.role;
        return typeof role === "string" ? [role] : [];
      })
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

class RecordingHttpClient {
  lastJsonPayload?: Record<string, unknown>;

  constructor(private readonly response: Record<string, unknown>) {}

  async postJson(
    _path: unknown,
    payload: unknown,
    _headers: HeadersInit,
    _options?: { signal?: AbortSignal },
  ): Promise<Record<string, unknown>> {
    this.lastJsonPayload = readRecord(payload) ?? {};
    return this.response;
  }

  async postSseStream(): Promise<never> {
    throw new Error("stream verification is not part of this contract test.");
  }
}

await verifyOpenAiEndpointPayloadProjection();

console.log("OpenAI-compatible message projection verified.");
