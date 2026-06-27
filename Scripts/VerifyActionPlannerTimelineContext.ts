import assert from "node:assert/strict";
import { b as baml } from "../Source/AgentSystem/BamlClient/baml_client/index.js";
import { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/AgentActionPlannerContext.js";
import { buildActionPlannerPromptJson } from "../Source/AgentSystem/AgentActionPlannerPromptJson.js";
import { projectActionPlannerBamlRequestBody } from "../Source/AgentSystem/AgentActionPlannerPromptProjector.js";
import { createActionPlanInputFixture } from "./ActionPlannerFixture.js";

const weatherEvidenceUri = "senera://evidence/ev_111111111111111111111111";

void main();

async function main(): Promise<void> {
  const input = new AgentActionPlannerContextBuilder().buildInput({
    userMessage: "下一步做什么？",
    currentStep: 2,
    dynamicTools: true,
    loadedToolNames: [],
    messages: [
      {
        role: "user",
        content: "先搜索天气",
      },
      {
        role: "assistant",
        content: "<senera_tool_calls><tool_call><name>WeatherTool</name><arguments></arguments></tool_call></senera_tool_calls>",
      },
      {
        role: "user",
        content: [
          "<read_only_evidence>",
          "<kind>tool_results</kind>",
          "<payload>",
          "<result>",
          "<tool_result>",
          "<runtime><call_id>call-1</call_id></runtime>",
          "<name>WeatherTool</name>",
          "<response>",
          "<artifact>",
          "<artifactUri>senera://artifact/art_333333333333333333333333</artifactUri>",
          "<summary>weather current Shanghai, China: Cloudy, 27C</summary>",
          "<evidence>",
          "<item>",
          `<evidenceUri>${weatherEvidenceUri}</evidenceUri>`,
          "<kind>weather_observation</kind>",
          "<locator>Shanghai, China</locator>",
          "<display>current Shanghai, China: Cloudy, 27C</display>",
          "<source>WeatherAPI</source>",
          "<confidence>0.8</confidence>",
          "<slots><item><name>condition</name><value>Cloudy</value></item></slots>",
          "</item>",
          "</evidence>",
          "</artifact>",
          "</response>",
          "</tool_result>",
          "</result>",
          "</payload>",
          "</read_only_evidence>",
        ].join(""),
      },
    ],
    ledger: {
      calls: [],
      evidence: [],
      warnings: [],
      deltas: [],
      lastNewEvidenceStep: 0,
    },
    toolCatalog: [],
  });

  assert.equal("runState" in input, true);
  assert.equal("timeline" in input, true);
  assert.equal("evidenceMemory" in input, true);
  assert.equal("plannerJournal" in input, true);
  assert.equal("executionState" in input, false);
  assert.equal("recentDeltas" in input, false);
  assert.equal(input.timeline.length, 3);
  assert.deepEqual(input.timeline.map((turn) => turn.role), ["user", "assistant", "user"]);
  assert.equal(input.timeline[2].evidenceUris.includes(weatherEvidenceUri), true);
  assert.equal(input.timeline[2].content.includes(`evidenceUri: ${weatherEvidenceUri}`), true);
  assert.equal(input.timeline[2].content.includes("slots:"), true);
  assert.equal(JSON.parse(input.timeline[1]?.payloadJson ?? "{}").calls[0].name, "WeatherTool");
  assert.equal(
    JSON.parse(input.timeline[2]?.payloadJson ?? "{}").observations[0].artifact.evidence[0].evidenceUri,
    weatherEvidenceUri,
  );
  assert.equal(JSON.stringify(input.runState).includes(weatherEvidenceUri), false);

  const request = await baml.request.BuildTaskFrame(buildActionPlannerPromptJson(input, {
    stage: "buildTaskFrame",
  }), {});
  const body = request.body.json() as Record<string, unknown>;
  const messages = readMessages(body);
  assert.ok(messages.length >= 2);
  assert.equal(messages[0]?.role, "system");
  const plannerJson = readPlannerJson(messages);
  assert.equal(plannerJson.directive.stage, "buildTaskFrame");
  assert.equal(plannerJson.context.currentUserTurn.content, "下一步做什么？");
  assert.deepEqual(plannerJson.context.timeline.map((turn) => turn.role), ["user", "assistant", "user"]);
  assert.equal(plannerJson.context.timeline[1]?.kind, "tool_call");
  assert.equal(plannerJson.context.timeline[1]?.content.includes("WeatherTool"), true);
  assert.equal(plannerJson.context.timeline[2]?.content.includes(`evidenceUri: ${weatherEvidenceUri}`), true);

  const projected = projectActionPlannerBamlRequestBody(body);
  const projectedText = JSON.stringify(projected.messages);
  const projectedToolTurn = JSON.parse(projected.messages[2]?.content ?? "{}");
  assert.equal(projectedToolTurn.turn.kind, "tool_observation");
  assert.equal(projectedToolTurn.turn.payload.observations[0].artifact.evidence[0].evidenceUri, weatherEvidenceUri);
  assert.equal(projectedText.includes("payloadJson"), false);
  assert.equal(projectedText.includes("read_only_evidence"), false);
  assert.equal(projectedText.includes(`evidenceUri: ${weatherEvidenceUri}`), false);
  const projectedPlannerInput = JSON.parse(projected.messages.at(-1)?.content ?? "{}");
  assert.equal(projectedPlannerInput.plannerInput.currentUserTurn.content, "下一步做什么？");
  assert.equal("timeline" in projectedPlannerInput.plannerInput, false);

  const promptText = JSON.stringify(messages);
  assert.equal(promptText.includes("Timeline turn:"), false);
  assert.equal(promptText.includes("Run state:"), false);
  assert.equal(promptText.includes("Visible tool catalog:"), false);
  assert.equal(promptText.includes("Evidence memory:"), false);
  assert.equal(promptText.includes("Planner journal:"), false);
  assert.equal(promptText.includes("Execution state:"), false);
  assert.equal(promptText.includes("Recent state deltas:"), false);

  const repairRequest = await baml.request.RepairTaskFrame(buildActionPlannerPromptJson(input, {
    stage: "repairTaskFrame",
    invalidTaskFrame: "{\"taskType\":\"inspect\",\"reason\":\"extra\"}",
    issues: ["unexpected field: reason"],
  }), {});
  const repairMessages = readMessages(repairRequest.body.json() as Record<string, unknown>);
  assert.equal(repairMessages[0]?.role, "system");
  assert.equal(repairMessages.at(-1)?.role, "user");
  const repairJson = readPlannerJson(repairMessages);
  assert.equal(repairJson.directive.stage, "repairTaskFrame");
  assert.equal(repairJson.directive.invalidTaskFrame?.includes("reason"), true);
  assert.deepEqual(repairJson.directive.issues, ["unexpected field: reason"]);
  assert.equal(repairJson.context.timeline[1]?.kind, "tool_call");
  assert.equal(repairJson.context.timeline[1]?.content.includes("WeatherTool"), true);
  assert.equal(repairJson.context.timeline[2]?.content.includes(`evidenceUri: ${weatherEvidenceUri}`), true);
  const repairText = JSON.stringify(repairMessages);
  assert.equal(repairText.includes("Action selector repair directive:"), false);
  assert.equal(repairText.includes("Invalid selection:"), false);
  assert.equal(repairText.includes("Runtime input:"), false);

  const fixture = createActionPlanInputFixture("测试 timeline fixture");
  assert.equal(fixture.timeline[0]?.content, "测试 timeline fixture");

  console.log("Action planner timeline context verification passed.");
}

function readPlannerJson(messages: Array<{
  role: string;
  content: string;
}>): {
  context: {
    currentUserTurn: {
      content: string;
    };
    timeline: Array<{
      kind?: string;
      role: string;
      content: string;
    }>;
  };
  directive: {
    stage: string;
    invalidTaskFrame?: string;
    issues?: string[];
  };
} {
  const userMessage = messages.find((message) =>
    message.role === "user" && message.content.trim().startsWith("{")
  );
  assert.ok(userMessage, "planner request should contain a JSON user message");
  return JSON.parse(userMessage.content) as {
    context: {
      currentUserTurn: {
        content: string;
      };
      timeline: Array<{
        kind?: string;
        role: string;
        content: string;
      }>;
    };
    directive: {
      stage: string;
      invalidTaskFrame?: string;
      issues?: string[];
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
