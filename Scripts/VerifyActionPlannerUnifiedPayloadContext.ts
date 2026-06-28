import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/ActionPlanner/AgentActionPlanner.js";
import { TaskEvidenceScope } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import type { AgentToolCatalogItem } from "../Source/AgentSystem/ToolRuntime/AgentToolCatalogProjector.js";
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

const weatherTool: AgentToolCatalogItem = {
  name: "WeatherTool",
  title: "Weather",
  summary: "Provides weather forecast evidence.",
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
  const requests: Array<{
    url: string;
    body: Record<string, unknown>;
  }> = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, body });

    return new Response(sseEvent({
      choices: [{
        delta: {
          content: JSON.stringify(requests.length === 1
            ? taskFrameResponse()
            : evidenceVerificationResponse()),
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
    const input = createActionPlanInputFixture("请查询上海明天天气");
    input.runState.loadedTools = ["WeatherTool"];
    input.evidenceState.push({
      evidenceUri: "WTH1",
      kind: "weather_forecast_day",
      toolName: "WeatherTool",
      artifactUri: "senera://artifact/art_444444444444444444444444",
      locator: "Shanghai, China @ 2026-06-12",
      display: "forecast for Shanghai, China on 2026-06-12: Cloudy",
      label: "Shanghai forecast",
      source: "WeatherAPI",
      confidence: 0.8,
      facts: [
        { name: "condition", value: "Cloudy" },
      ],
      artifactRefs: [
        "evidence",
        "projection",
      ],
    });
    input.compactToolCatalog.push({
      name: "WeatherTool",
      title: "Weather",
      summary: "Provides weather forecast evidence.",
      capabilities: [],
      evidence: ["weather forecast"],
      effects: [],
      outputs: [],
      permissions: [],
      loaded: true,
      rootKind: "User",
    });
    input.toolCatalog.push({
      ...weatherTool,
      loaded: true,
    });

    const result = await new AgentActionPlanner(config, provider, {
      list: () => [weatherTool],
    }).plan({
      requestId: "verify-unified-payload-context",
      input,
    });

    assert.equal(result.decision.action, "answer");
    assert.equal(requests.length, 2);

    const buildPrompt = readFinalPlannerInput(requests[0]?.body);
    assert.equal(buildPrompt.directive.stage, "buildTaskFrame");
    assert.equal(Array.isArray(buildPrompt.compactToolCatalog), true);
    assert.equal("toolCatalog" in buildPrompt, false);

    const verifyPrompt = readFinalPlannerInput(requests[1]?.body);
    assert.equal(verifyPrompt.directive.stage, "verifyTaskEvidence");
    assert.equal(verifyPrompt.task.answerGoal.includes("Shanghai weather"), true);
    assert.equal(verifyPrompt.verificationRequirements[0]?.id, "weather-forecast");
    assert.equal(verifyPrompt.evidenceState[0]?.evidenceUri, "WTH1");
    assert.equal(verifyPrompt.evidenceCatalog[0]?.toolName, "WeatherTool");

    console.log("Action planner unified payload context verification passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function taskFrameResponse() {
  return {
    taskType: "weather",
    answerGoal: "Answer the requested Shanghai weather forecast.",
    intentTags: ["weather", "forecast"],
    targetRefs: [{
      kind: "location",
      value: "Shanghai, China",
      status: "resolved",
    }],
    candidateTools: [{
      name: "WeatherTool",
      purpose: "Fetch weather forecast evidence.",
      supports: ["weather_forecast_day"],
    }],
    discoveryQueries: [],
    requiredEffects: [],
    requiredEvidence: [{
      id: "weather-forecast",
      need: "Forecast for Shanghai, China on 2026-06-12",
      scope: TaskEvidenceScope.CurrentRun,
      minimum: 1,
      reason: "The final answer depends on weather forecast evidence.",
    }],
    userInputNeeds: [],
    nextStepPurpose: "Verify whether existing forecast evidence is enough.",
    completionCriteria: ["Weather forecast evidence supports the answer."],
    notes: [],
  };
}

function evidenceVerificationResponse() {
  return {
    ready: true,
    requirements: [{
      requirementId: "weather-forecast",
      need: "Forecast for Shanghai, China on 2026-06-12",
      status: "Satisfied",
      evidenceUris: ["WTH1"],
      artifactUris: ["senera://artifact/art_444444444444444444444444"],
      reason: "WTH1 directly supports the requested weather forecast.",
      missingFacts: [],
      unsupportedClaims: [],
    }],
    summary: "Weather forecast evidence is sufficient.",
  };
}

function readFinalPlannerInput(body: Record<string, unknown> | undefined): {
  directive: {
    stage: string;
  };
  compactToolCatalog?: unknown[];
  task: {
    answerGoal: string;
  };
  verificationRequirements: Array<{
    id: string;
  }>;
  evidenceState: Array<{
    evidenceUri: string;
  }>;
  evidenceCatalog: Array<{
    toolName: string;
  }>;
} {
  const final = readMessages(body).at(-1);
  assert.equal(final?.role, "user");
  assert.ok(final?.content.includes("\"plannerInput\""));
  const parsed = JSON.parse(final.content) as {
    plannerInput: {
      directive: {
        stage: string;
      };
      compactToolCatalog?: unknown[];
      task: {
        answerGoal: string;
      };
      verificationRequirements: Array<{
        id: string;
      }>;
      evidenceState: Array<{
        evidenceUri: string;
      }>;
      evidenceCatalog: Array<{
        toolName: string;
      }>;
    };
  };
  return parsed.plannerInput;
}

function readMessages(body: Record<string, unknown> | undefined): Array<{
  role: string;
  content: string;
}> {
  const rawMessages = Array.isArray(body?.messages)
    ? body.messages
    : Array.isArray(body?.input)
      ? body.input
      : [];

  return rawMessages.map((value) => {
    const record = value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};
    return {
      role: String(record.role ?? ""),
      content: readContent(record.content),
    };
  });
}

function readContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }

      const record = entry as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    }).join("");
  }

  return "";
}

function sseEvent(value: Record<string, unknown>): string {
  return [
    `data: ${JSON.stringify(value)}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}
