import assert from "node:assert/strict";
import { ActionKind, b as baml } from "../Source/AgentSystem/BamlClient/baml_client/index.js";
import { buildActionPlannerPromptJson } from "../Source/AgentSystem/AgentActionPlannerPromptJson.js";
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
    confidence: 0.8,
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

  const request = await baml.request.BuildActionPayload(buildActionPlannerPromptJson(input, {
    stage: "buildActionPayload",
    selectedAction: ActionKind.UseTools,
  }), {});
  const body = request.body.json() as Record<string, unknown>;
  const messages = readMessages(body);
  const promptText = messages.map((message) => message.content).join("\n");
  const plannerJson = readPlannerJson(messages);

  assert.equal(messages[0]?.role, "system");
  assert.equal(messages.at(-1)?.role, "user");
  assert.equal(plannerJson.directive.stage, "buildActionPayload");
  assert.equal(plannerJson.directive.selectedAction, "UseTools");
  assert.equal(plannerJson.context.runState.loadedTools.includes("WeatherTool"), true);
  assert.equal(plannerJson.context.timeline[0]?.content.includes("请查询上海明天天气"), true);
  assert.equal(plannerJson.context.timeline[1]?.content.includes("WeatherTool"), true);
  assert.equal(plannerJson.context.timeline[2]?.content.includes("WTH1 forecast"), true);
  assert.equal(promptText.includes("Payload directive:"), false);
  assert.equal(promptText.includes("selectedAction=UseTools"), false);
  assert.equal(promptText.includes("primaryContext"), false);
  assert.equal(promptText.includes("safetyContext"), false);
  assert.equal(promptText.includes("fallbackContext"), false);
  assert.equal(promptText.includes("Projection observability"), false);

  console.log("Action planner unified payload context verification passed.");
}

function readPlannerJson(messages: Array<{
  role: string;
  content: string;
}>): {
  context: {
    runState: {
      loadedTools: string[];
    };
    timeline: Array<{
      content: string;
    }>;
  };
  directive: {
    stage: string;
    selectedAction?: string;
  };
} {
  const userMessage = messages.find((message) =>
    message.role === "user" && message.content.trim().startsWith("{")
  );
  assert.ok(userMessage, "planner request should contain a JSON user message");
  return JSON.parse(userMessage.content) as {
    context: {
      runState: {
        loadedTools: string[];
      };
      timeline: Array<{
        content: string;
      }>;
    };
    directive: {
      stage: string;
      selectedAction?: string;
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
