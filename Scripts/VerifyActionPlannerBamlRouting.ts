import assert from "node:assert/strict";
import { createActionPlannerBamlClient } from "../Source/AgentSystem/AgentActionPlannerBamlClient.js";
import { b as baml } from "../Source/AgentSystem/BamlClient/baml_client/index.js";
import { buildActionPlannerPromptJson } from "../Source/AgentSystem/AgentActionPlannerPromptJson.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createActionPlanInputFixture } from "./ActionPlannerFixture.js";

const baseProvider: ResolvedAgentModelProviderConfig = {
  Id: "test",
  ProviderId: "test",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://example.test/v1",
  ApiKey: "test-key",
  ApiVersion: "2023-06-01",
  Model: "test-model",
  Temperature: 0.2,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 1000,
  FirstTokenTimeoutMs: -1,
  MaxRequestMs: -1,
  MaxNetworkRetries: 0,
  Headers: {},
};

const input = createActionPlanInputFixture();

const cases = [
  {
    endpoint: "ChatCompletions",
    baseUrl: "https://example.test/v1",
    expectedUrl: "https://example.test/v1/chat/completions",
    expectedBodyKeys: ["messages"],
  },
  {
    endpoint: "Responses",
    baseUrl: "https://example.test/v1",
    expectedUrl: "https://example.test/v1/responses",
    expectedBodyKeys: ["input"],
  },
  {
    endpoint: "ClaudeMessages",
    baseUrl: "https://api.anthropic.com/v1",
    expectedUrl: "https://api.anthropic.com/v1/messages",
    expectedBodyKeys: ["messages"],
  },
  {
    endpoint: "GoogleGenerateContent",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    expectedUrl: "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent",
    expectedBodyKeys: ["contents", "generationConfig"],
  },
] as const;

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  for (const testCase of cases) {
    const client = createActionPlannerBamlClient(
      {
        ...baseProvider,
        Endpoint: testCase.endpoint,
        BaseUrl: testCase.baseUrl,
      },
      {
        Provider: "openai-generic",
        BaseUrl: testCase.baseUrl,
        ApiKey: "test-key",
        Model: "test-model",
        Temperature: 0.1,
        MaxTokens: -1,
      },
    );

    const request = await baml.request.BuildTaskFrame(buildActionPlannerPromptJson(input, {
      stage: "buildTaskFrame",
    }), {
      clientRegistry: client.registry,
    });
    const body = request.body.json() as Record<string, unknown>;

    assert.equal(request.method, "POST");
    assert.equal(request.url, testCase.expectedUrl);
    for (const key of testCase.expectedBodyKeys) {
      assert.ok(key in body, `${testCase.endpoint} body missing ${key}`);
    }
  }

  const limitedClient = createActionPlannerBamlClient(baseProvider, {
    Provider: "openai-generic",
    BaseUrl: baseProvider.BaseUrl,
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0.1,
    MaxTokens: 321,
  });
  const limitedRequest = await baml.request.BuildTaskFrame(buildActionPlannerPromptJson(input, {
    stage: "buildTaskFrame",
  }), {
    clientRegistry: limitedClient.registry,
  });
  assert.equal((limitedRequest.body.json() as Record<string, unknown>).max_tokens, 321);

  console.log("Action planner BAML routing verification passed.");
}
