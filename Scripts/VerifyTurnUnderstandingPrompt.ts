import assert from "node:assert/strict";
import { b as baml } from "../Source/AgentSystem/BamlClient/baml_client/index.js";
import { buildActionPlannerPromptJson } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerPromptJson.js";
import { projectActionPlannerBamlRequestBody } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerPromptProjector.js";
import { createActionPlannerBamlClient } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerBamlClient.js";
import { createActionPlanInputFixture } from "./ActionPlannerFixture.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

void main();

async function main(): Promise<void> {
  const input = createActionPlanInputFixture("那北京呢？");
  input.turnUnderstanding = undefined;
  input.timeline = [
    {
      index: 0,
      role: "user",
      kind: "user_message",
      content: "上海明天天气怎么样？",
      evidenceUris: [],
      artifactUris: [],
    },
    {
      index: 1,
      role: "assistant",
      kind: "assistant_message",
      content: "上海明天多云。",
      evidenceUris: ["WTH1"],
      artifactUris: [],
    },
    {
      index: 2,
      role: "user",
      kind: "user_message",
      content: "那北京呢？",
      evidenceUris: [],
      artifactUris: [],
    },
  ];

  const provider: ResolvedAgentModelProviderConfig = {
    Id: "test",
  ProviderId: "test",
  Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test",
    ApiVersion: "2023-06-01",
    Model: "prompt-builder",
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: false,
    TimeoutMs: 1000,
    FirstTokenTimeoutMs: -1,
    MaxRequestMs: -1,
    MaxNetworkRetries: 0,
    Headers: {},
  };
  const client = createActionPlannerBamlClient(provider, {
    Provider: "openai-generic",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test",
    Model: "prompt-builder",
    Temperature: 0,
    MaxTokens: -1,
  });

  const request = await baml.request.UnderstandUserTurn(
    buildActionPlannerPromptJson(input, {
      stage: "understandUserTurn",
    }),
    {
      clientRegistry: client.registry,
    },
  );

  const projected = projectActionPlannerBamlRequestBody(request.body.json() as Record<string, unknown>);
  assert.equal(projected.messages.length, 4);
  assert.equal(projected.messages[0]?.role, "user");
  assert.ok(projected.messages[0]?.content.includes("上海明天天气怎么样"));
  assert.equal(projected.messages.at(-1)?.role, "user");

  const final = JSON.parse(projected.messages.at(-1)?.content ?? "{}") as {
    plannerInput?: {
      currentUserTurn?: {
        content?: string;
      };
      directive?: {
        stage?: string;
      };
    };
  };
  assert.equal(final.plannerInput?.currentUserTurn?.content, "那北京呢？");
  assert.equal(final.plannerInput?.directive?.stage, "understandUserTurn");

  console.log("Turn understanding prompt verification passed.");
}
