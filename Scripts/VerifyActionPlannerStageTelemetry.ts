import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/ActionPlanner/AgentActionPlanner.js";
import { AgentActionPlannerStageNames, type AgentActionPlannerStageEvent } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerTelemetry.js";
import type { AgentToolCatalogItem } from "../Source/AgentSystem/ToolRuntime/AgentToolCatalogProjector.js";
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

const catalogTool: AgentToolCatalogItem = {
  name: "WeatherTool",
  title: "Weather Tool",
  summary: "Read current weather and forecasts.",
  rootKind: "User",
  capabilities: [],
  tags: [],
  useCases: [],
  examples: [],
  avoid: [],
  permissions: [],
  evidenceCapabilities: [{
    produces: "weather forecast",
    quality: "observed",
    satisfies: ["weather forecast"],
    kinds: ["weather_forecast_day"],
    capabilityIds: [],
  }],
};

void main();

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const responses = [
    {
      taskType: "weather lookup",
      answerGoal: "Query the weather forecast requested by the user.",
      intentTags: ["weather"],
      targetRefs: [{
        kind: "location-date",
        value: "latest user weather request",
        status: "needs-forecast",
      }],
      candidateTools: [{
        name: "WeatherTool",
        purpose: "Read requested forecast evidence.",
        supports: ["weather forecast"],
      }],
      discoveryQueries: ["weather forecast"],
      requiredEffects: [],
      requiredEvidence: [{
        id: "weather-forecast-evidence",
        need: "weather forecast",
        scope: TaskEvidenceScope.CurrentRun,
        minimum: 1,
        reason: "The user asked for weather facts.",
      }],
      userInputNeeds: [],
      nextStepPurpose: "Fetch weather forecast evidence.",
      completionCriteria: ["Forecast evidence is available."],
      notes: [],
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
    const fixture = createActionPlanInputFixture("查天气");
    const result = await planner.plan({
      requestId: "verify-stage-telemetry",
      input: {
        ...fixture,
        runState: {
          ...fixture.runState,
          loadedTools: ["WeatherTool"],
        },
        compactToolCatalog: [{
          name: "WeatherTool",
          title: "Weather Tool",
          summary: "Read current weather and forecasts.",
          capabilities: [],
          evidence: ["weather forecast"],
          effects: [],
          outputs: [],
          permissions: [],
          loaded: true,
          rootKind: "User",
        }],
        toolCatalog: [{
          ...catalogTool,
          loaded: true,
        }],
      },
      onStage: (event) => {
        telemetry.push(event);
      },
    });

    assert.equal(result.kind, "planned");
    assert.deepEqual(telemetry.map((event) => `${event.stage}:${event.status}`), [
      `${AgentActionPlannerStageNames.BuildTaskFrame}:started`,
      `${AgentActionPlannerStageNames.BuildTaskFrame}:completed`,
      `${AgentActionPlannerStageNames.EvaluateEvidence}:started`,
      `${AgentActionPlannerStageNames.EvaluateEvidence}:completed`,
    ]);
    const taskFrameCompleted = telemetry.find((event) =>
      event.stage === AgentActionPlannerStageNames.BuildTaskFrame && event.status === "completed"
    );
    assert.equal(taskFrameCompleted?.status, "completed");
    assert.equal(taskFrameCompleted?.taskFrame?.answerGoal, "Query the weather forecast requested by the user.");
    const evidenceCompleted = telemetry.find((event) =>
      event.stage === AgentActionPlannerStageNames.EvaluateEvidence && event.status === "completed"
    );
    assert.equal(evidenceCompleted?.status, "completed");
    assert.equal(evidenceCompleted?.status === "completed" ? evidenceCompleted.selectedAction : undefined, "use_tools");
    assert.equal(evidenceCompleted?.status === "completed" ? evidenceCompleted.evidenceDecision?.ready : undefined, false);
    assert.equal(result.decision.action, "use_tools");
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
