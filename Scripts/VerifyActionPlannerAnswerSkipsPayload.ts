import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/AgentActionPlanner.js";
import { AgentActionPlannerStageNames, type AgentActionPlannerStageEvent } from "../Source/AgentSystem/AgentActionPlannerTelemetry.js";
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
  const telemetry: AgentActionPlannerStageEvent[] = [];
  const requests: string[] = [];

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(init?.body ?? ""));
    assert.equal(requests.length, 1, "answer action must not request payload construction");
    return new Response(sseEvent({
      choices: [{
        delta: {
          content: JSON.stringify({
            taskType: "direct answer",
            answerGoal: "直接回答",
            intentTags: ["direct-answer"],
            targetRefs: [],
            candidateTools: [],
            discoveryQueries: [],
            requiredEffects: [],
            requiredEvidence: [],
            userInputNeeds: [],
            nextStepPurpose: "Answer directly from the current conversation.",
            completionCriteria: ["No external evidence is required."],
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
    const planner = new AgentActionPlanner(config, provider, {
      list: () => [],
    });
    const result = await planner.plan({
      requestId: "verify-answer-skips-payload",
      input: createActionPlanInputFixture("直接回答"),
      onStage: (event) => {
        telemetry.push(event);
      },
    });

    assert.equal(result.kind, "planned");
    if (result.kind !== "planned") {
      throw new Error("Expected planned result.");
    }

    assert.equal(result.selectedAction, "answer");
    assert.deepEqual(result.decision, {
      action: "answer",
    });
    assert.equal(result.payloadRepaired, false);
    assert.equal(requests.length, 1);
    assert.deepEqual(telemetry.map((event) => `${event.stage}:${event.status}`), [
      `${AgentActionPlannerStageNames.BuildTaskFrame}:started`,
      `${AgentActionPlannerStageNames.BuildTaskFrame}:completed`,
      `${AgentActionPlannerStageNames.EvaluateEvidence}:started`,
      `${AgentActionPlannerStageNames.EvaluateEvidence}:completed`,
    ]);

    console.log("Action planner answer skip-payload verification passed.");
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
