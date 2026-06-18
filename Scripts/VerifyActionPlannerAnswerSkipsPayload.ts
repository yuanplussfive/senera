import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/AgentActionPlanner.js";
import { AgentActionPlannerStageNames, type AgentActionPlannerStageEvent } from "../Source/AgentSystem/AgentActionPlannerTelemetry.js";
import type { ResolvedAgentActionPlannerConfig, ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types.js";
import { createActionPlanInputFixture } from "./ActionPlannerFixture.js";

const provider: ResolvedAgentModelProviderConfig = {
  Id: "test",
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

const config: ResolvedAgentActionPlannerConfig = {
  Enabled: true,
  MaxRepairAttempts: 0,
  Client: {
    Provider: "auto",
    BaseUrl: "https://example.test/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0.1,
    MaxTokens: -1,
  },
};

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
            action: "Answer",
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
      `${AgentActionPlannerStageNames.SelectAction}:started`,
      `${AgentActionPlannerStageNames.SelectAction}:completed`,
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
