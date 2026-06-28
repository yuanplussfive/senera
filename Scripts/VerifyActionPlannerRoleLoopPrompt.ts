import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/ActionPlanner/AgentActionPlanner.js";
import { TaskEvidenceScope } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  createActionPlannerConfigFixture,
  createActionPlanInputFixture,
} from "./ActionPlannerFixture.js";

const provider: ResolvedAgentModelProviderConfig = {
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

const config = createActionPlannerConfigFixture({
  maxRepairAttempts: 0,
  client: {
    Provider: "openai-generic",
    BaseUrl: "https://example.test/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0.1,
    MaxTokens: -1,
  },
});

void main();

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(init?.body ?? ""));
    return new Response(sseEvent({
      choices: [{
        delta: {
          content: JSON.stringify({
            taskType: "conversation follow-up",
            answerGoal: "Answer the follow-up from conversation context.",
            intentTags: ["conversation"],
            targetRefs: [],
            candidateTools: [],
            discoveryQueries: [],
            requiredEffects: [],
            requiredEvidence: [{
              id: "conversation-context",
              need: "conversation context",
              scope: TaskEvidenceScope.Conversation,
              minimum: 1,
              reason: "The latest user message is answerable from conversation context.",
            }],
            userInputNeeds: [],
            nextStepPurpose: "Answer directly.",
            completionCriteria: ["No tool call is needed."],
            notes: [],
          }),
        },
      }],
    }), {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    });
  };

  try {
    const input = createActionPlanInputFixture("继续刚才的问题");
    input.timeline = [
      {
        index: 0,
        role: "user",
        kind: "user_message",
        content: "上一轮用户问题",
        evidenceUris: [],
        artifactUris: [],
      },
      {
        index: 1,
        role: "assistant",
        kind: "assistant_message",
        content: "上一轮自然语言回复",
        evidenceUris: [],
        artifactUris: [],
      },
      {
        index: 2,
        role: "user",
        kind: "user_message",
        content: "继续刚才的问题",
        evidenceUris: [],
        artifactUris: [],
      },
    ];
    const result = await new AgentActionPlanner(config, provider, {}).plan({
      requestId: "verify-role-loop-planner-prompt",
      input,
    });

    assert.equal(result.decision.action, "answer");
    assert.equal(requests.length, 1);
    const body = JSON.parse(requests[0] ?? "{}") as {
      messages?: Array<{
        role?: string;
        content?: string;
      }>;
    };
    const messages = body.messages ?? [];
    assert.equal(messages.some((message) =>
      message.role === "user" && message.content?.includes("上一轮用户问题")), true);
    assert.equal(messages.some((message) =>
      message.role === "assistant" && message.content?.includes("上一轮自然语言回复")), true);
    assert.equal(messages.at(-1)?.role, "user");
    assert.equal(messages.at(-1)?.content?.includes("\"plannerInput\""), true);
    assert.equal(messages.at(-1)?.content?.includes("\"compactToolCatalog\""), true);

    console.log("Action planner role-loop prompt verification passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function sseEvent(value: Record<string, unknown>): string {
  return [
    `data: ${JSON.stringify(value)}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}
