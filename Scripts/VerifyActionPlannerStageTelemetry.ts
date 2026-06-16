import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/AgentActionPlanner.js";
import { AgentActionPlannerStageNames, type AgentActionPlannerStageEvent } from "../Source/AgentSystem/AgentActionPlannerTelemetry.js";
import type { AgentToolCatalogItem } from "../Source/AgentSystem/AgentToolCatalogProjector.js";
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

const catalogTool: AgentToolCatalogItem = {
  name: "WeatherTool",
  title: "Weather Tool",
  summary: "Read current weather and forecasts.",
  capabilities: [],
  tags: [],
  useCases: [],
  examples: [],
  avoid: [],
  permissions: [],
};

void main();

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const responses = [
    {
      action: "UseTools",
    },
    {
      action: "UseTools",
      answer: null,
      askUser: null,
      useTools: {
        preferredTools: ["WeatherTool"],
        instruction: "Query the weather forecast requested by the user.",
      },
      discoverTools: null,
    },
  ];
  const telemetry: AgentActionPlannerStageEvent[] = [];

  globalThis.fetch = async () => {
    const response = responses.shift();
    assert.ok(response, "unexpected planner model call");
    return new Response(sseEvent({
      choices: [{
        delta: {
          content: JSON.stringify(response),
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
      list: () => [catalogTool],
    });
    const result = await planner.plan({
      requestId: "verify-stage-telemetry",
      input: createActionPlanInputFixture("查天气"),
      onStage: (event) => {
        telemetry.push(event);
      },
    });

    assert.equal(result.kind, "planned");
    assert.deepEqual(telemetry.map((event) => `${event.stage}:${event.status}`), [
      `${AgentActionPlannerStageNames.SelectAction}:started`,
      `${AgentActionPlannerStageNames.SelectAction}:completed`,
      `${AgentActionPlannerStageNames.BuildActionPayload}:started`,
      `${AgentActionPlannerStageNames.BuildActionPayload}:completed`,
    ]);
    const selectionCompleted = telemetry.find((event) =>
      event.stage === AgentActionPlannerStageNames.SelectAction && event.status === "completed"
    );
    const payloadCompleted = telemetry.find((event) =>
      event.stage === AgentActionPlannerStageNames.BuildActionPayload && event.status === "completed"
    );
    assert.equal(selectionCompleted?.status, "completed");
    assert.equal(payloadCompleted?.status, "completed");
    assert.equal(selectionCompleted.selectedAction, "use_tools");
    assert.equal(payloadCompleted.selectedAction, "use_tools");
    console.log("Action planner stage telemetry verification passed.");
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
