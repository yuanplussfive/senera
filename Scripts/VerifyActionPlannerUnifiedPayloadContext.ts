import assert from "node:assert/strict";
import { b as baml } from "../Source/AgentSystem/BamlClient/baml_client/index.js";
import type { TaskFrame } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import { buildEvidenceVerificationPromptJson } from "../Source/AgentSystem/AgentActionPlannerPromptJson.js";
import { createActionPlanInputFixture } from "./ActionPlannerFixture.js";

void main();

async function main(): Promise<void> {
  const input = createActionPlanInputFixture("请查询上海明天天气");
  input.runState.loadedTools = ["WeatherTool"];
  input.timeline.push({
    index: 1,
    role: "assistant",
    kind: "assistant_message",
    step: 1,
    content: "I will use WeatherTool if fresh weather evidence is missing.",
    evidenceRefs: [],
    artifactUris: [],
  });
  input.timeline.push({
    index: 2,
    role: "user",
    kind: "tool_observation",
    step: 1,
    content: "WTH1 forecast for Shanghai, China on 2026-06-12: Cloudy.",
    evidenceRefs: ["WTH1"],
    artifactUris: ["senera://artifact/art_444444444444444444444444"],
  });
  input.evidenceMemory.push({
    evidenceRef: "WTH1",
    kind: "weather_forecast_day",
    locator: "Shanghai, China @ 2026-06-12",
    display: "forecast for Shanghai, China on 2026-06-12: Cloudy",
    label: "Shanghai forecast",
    toolName: "WeatherTool",
    artifactUri: "senera://artifact/art_444444444444444444444444",
    facts: [
      { name: "condition", value: "Cloudy" },
    ],
    artifactRefs: [
      "evidence",
      "projection",
    ],
  });
  input.evidenceState.push({
    evidenceRef: "WTH1",
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

  const taskFrame: TaskFrame = {
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
      minimum: 1,
      reason: "The final answer depends on weather forecast evidence.",
    }],
    userInputNeeds: [],
    nextStepPurpose: "Verify whether existing forecast evidence is enough.",
    completionCriteria: ["Weather forecast evidence supports the answer."],
    notes: [],
  };

  const request = await baml.request.VerifyTaskEvidence(
    buildEvidenceVerificationPromptJson(input, taskFrame),
    {},
  );
  const body = request.body.json() as Record<string, unknown>;
  const messages = readMessages(body);
  const plannerJson = readPlannerJson(messages);

  assert.equal(messages[0]?.role, "system");
  assert.equal(messages.at(-1)?.role, "user");
  assert.equal(plannerJson.directive.stage, "verifyTaskEvidence");
  assert.equal(plannerJson.context.task.answerGoal.includes("Shanghai weather"), true);
  assert.equal(plannerJson.context.verificationRequirements[0]?.id, "weather-forecast");
  assert.equal(plannerJson.context.evidenceState[0]?.evidenceRef, "WTH1");

  console.log("Action planner evidence verification context verification passed.");
}

function readPlannerJson(messages: Array<{
  role: string;
  content: string;
}>): {
  context: {
    task: {
      answerGoal: string;
    };
    verificationRequirements: Array<{
      id: string;
    }>;
    evidenceState: Array<{
      evidenceRef: string;
    }>;
  };
  directive: {
    stage: string;
  };
} {
  const userMessage = messages.find((message) =>
    message.role === "user" && message.content.trim().startsWith("{")
  );
  assert.ok(userMessage, "planner request should contain a JSON user message");
  return JSON.parse(userMessage.content) as {
    context: {
      task: {
        answerGoal: string;
      };
      verificationRequirements: Array<{
        id: string;
      }>;
      evidenceState: Array<{
        evidenceRef: string;
      }>;
    };
    directive: {
      stage: string;
    };
  };
}

function readMessages(body: Record<string, unknown>): Array<{
  role: string;
  content: string;
}> {
  const rawMessages = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
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
