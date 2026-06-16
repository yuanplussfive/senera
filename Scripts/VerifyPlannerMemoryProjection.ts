import assert from "node:assert/strict";
import { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/AgentActionPlannerContext.js";
import { AgentConversationPolicy } from "../Source/AgentSystem/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Source/AgentSystem/AgentConversationProjector.js";
import {
  createPlannerJournalEntry,
  createToolEvidenceMemoryEntries,
} from "../Source/AgentSystem/AgentPlannerMemory.js";
import { AgentToolResultXmlRenderer } from "../Source/AgentSystem/AgentToolResultXmlRenderer.js";
import type { ExecutedToolCallResult } from "../Source/AgentSystem/Types.js";

const previousRequestId = "request_weather_1";
const currentRequestId = "request_weather_2";
const timestamp = "2026-06-11T00:00:00.000Z";
const conversationProjector = new AgentConversationProjector();
const conversationPolicy = new AgentConversationPolicy();
const contextBuilder = new AgentActionPlannerContextBuilder();
const toolResultRenderer = new AgentToolResultXmlRenderer();

const weatherResult: ExecutedToolCallResult = {
  callId: "call-1",
  name: "WeatherTool",
  arguments: {
    location: "Shanghai, China",
    date: "2026-06-12",
  },
  process: {
    exitCode: 0,
    signal: null,
    stderr: "",
  },
  result: {
    ok: true,
  },
  artifact: {
    artifactId: "art_111111111111111111111111",
    artifactUri: "senera://artifact/art_111111111111111111111111",
    artifactPath: "E:\\senera\\.senera\\artifacts\\request_weather_1\\step_001",
    relativePath: ".senera/artifacts/request_weather_1/step_001",
    manifestPath: "E:\\senera\\.senera\\artifacts\\request_weather_1\\step_001\\artifact.json",
    files: {},
    summary: "WTH1 forecast for Shanghai, China on 2026-06-12: Cloudy",
    evidence: [{
      key: "weather.forecast.day:Shanghai, China:2026-06-12",
      ref: "WTH1",
      kind: "weather_forecast_day",
      locator: "Shanghai, China @ 2026-06-12",
      display: "forecast for Shanghai, China on 2026-06-12: Cloudy",
      label: "Shanghai forecast 2026-06-12",
      source: "WeatherAPI",
      confidence: 0.8,
      modelSlots: [
        { name: "resolvedLocation", value: "Shanghai, China" },
        { name: "date", value: "2026-06-12" },
        { name: "condition", value: "Cloudy" },
      ],
      plannerMemory: {
        facts: [
          { name: "resolvedLocation", value: "Shanghai, China" },
          { name: "date", value: "2026-06-12" },
          { name: "condition", value: "Cloudy" },
        ],
        artifactRefs: [
          "evidence",
          "projection",
        ],
      },
    }],
    delta: [],
  },
};

const plannerInputFixture = {
  runState: {
    currentStep: 1,
    dynamicTools: true,
    loadedTools: ["WeatherTool"],
    progress: {
      totalToolCalls: 0,
      totalEvidence: 0,
      lastNewEvidenceStep: 0,
      repeatedCallCount: 0,
      stalled: false,
    },
    warnings: [],
  },
  timeline: [{
    index: 0,
    role: "user",
    kind: "user_message",
    content: "查明天上海天气",
    evidenceRefs: [],
    artifactUris: [],
  }],
  evidenceMemory: [],
  plannerJournal: [],
  toolCatalog: [],
};

const historyEntries = [
  conversationProjector.projectUserInput(previousRequestId, "查明天上海天气", timestamp),
  conversationProjector.projectContextToolResults(
    previousRequestId,
    toolResultRenderer.render({
      kind: "ToolResults",
      value: [weatherResult],
    }),
    timestamp,
  ),
  ...createToolEvidenceMemoryEntries({
    requestId: previousRequestId,
    step: 1,
    results: [weatherResult],
    timestamp,
  }),
  createPlannerJournalEntry({
    requestId: previousRequestId,
    step: 1,
    loadedToolNames: ["WeatherTool"],
    timestamp,
    plan: {
      kind: "planned",
      selectedAction: "use_tools",
      selectionRepaired: false,
      payloadRepaired: false,
      input: plannerInputFixture,
      decision: {
        action: "use_tools",
        useTools: {
          preferredTools: ["WeatherTool"],
          instruction: "Get Shanghai weather forecast for tomorrow.",
        },
      },
    },
  }),
];

const currentUserEntry = conversationProjector.projectUserInput(
  currentRequestId,
  "明天上海天气呢？",
  "2026-06-11T00:01:00.000Z",
);
const plannerTimelineMessages = conversationPolicy.materialize(
  [
    ...historyEntries,
    currentUserEntry,
  ],
  {
    toolResultsScope: {
      kind: "request",
      requestId: currentRequestId,
    },
  },
);
const input = contextBuilder.buildInput({
  requestId: currentRequestId,
  userMessage: currentUserEntry.content,
  currentStep: 1,
  dynamicTools: true,
  loadedToolNames: [],
  messages: plannerTimelineMessages,
  conversationEntries: [
    ...historyEntries,
    currentUserEntry,
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

assert.equal(input.evidenceMemory.length, 1);
assert.equal(input.evidenceMemory[0]?.evidenceRef, "WTH1");
assert.equal(input.evidenceMemory[0]?.kind, "weather_forecast_day");
assert.equal(input.evidenceMemory[0]?.locator, "Shanghai, China @ 2026-06-12");
assert.equal(input.evidenceMemory[0]?.facts.some((fact) => fact.name === "date" && fact.value === "2026-06-12"), true);
assert.equal(JSON.stringify(input.evidenceMemory).includes("\"source\""), false);
assert.equal(JSON.stringify(input.evidenceMemory).includes("\"summary\""), false);
assert.equal(JSON.stringify(input.evidenceMemory).includes("\"slots\""), false);
assert.equal(JSON.stringify(input.evidenceMemory).includes("\"key\""), false);
assert.equal(input.plannerJournal.length, 1);
assert.equal(input.plannerJournal[0]?.selectedAction, "use_tools");
assert.equal(input.timeline.some((turn) => turn.content.includes("WTH1")), false);
assert.equal(conversationPolicy.materialize(historyEntries).some((message) => message.content.includes("tool.evidence_memory")), false);
assert.equal(plannerTimelineMessages.some((message) => message.content.includes("WTH1")), false);

const mainProgramHistoryMessages = conversationPolicy.materialize(historyEntries, {
  toolResultsScope: {
    kind: "none",
  },
  evidenceMemoryScope: {
    kind: "all",
  },
});
const mainProgramHistoryText = mainProgramHistoryMessages.map((message) => message.content).join("\n");
assert.equal(mainProgramHistoryText.includes("tool_evidence_memory"), true);
assert.equal(mainProgramHistoryText.includes("WTH1"), true);
assert.equal(mainProgramHistoryText.includes("forecast for Shanghai, China on 2026-06-12: Cloudy"), true);
assert.equal(mainProgramHistoryText.includes("call-1"), false);
assert.equal(mainProgramHistoryText.includes("WeatherAPI"), false);
assert.equal(mainProgramHistoryText.includes("weather.forecast.day:Shanghai, China:2026-06-12"), false);

const currentWeatherResult: ExecutedToolCallResult = {
  ...weatherResult,
  artifact: weatherResult.artifact
    ? {
        ...weatherResult.artifact,
        artifactId: "art_222222222222222222222222",
        artifactUri: "senera://artifact/art_222222222222222222222222",
        evidence: weatherResult.artifact.evidence.map((entry) => ({
          ...entry,
          key: "weather.forecast.day:Shanghai, China:2026-06-13",
          ref: "WTH2",
          locator: "Shanghai, China @ 2026-06-13",
          display: "forecast for Shanghai, China on 2026-06-13: Rain",
          label: "Shanghai forecast 2026-06-13",
          modelSlots: entry.modelSlots.map((slot) =>
            slot.name === "date"
              ? { ...slot, value: "2026-06-13" }
              : slot.name === "condition"
                ? { ...slot, value: "Rain" }
                : slot
          ),
          plannerMemory: {
            ...entry.plannerMemory,
            facts: entry.plannerMemory.facts.map((fact) =>
              fact.name === "date"
                ? { ...fact, value: "2026-06-13" }
                : fact.name === "condition"
                  ? { ...fact, value: "Rain" }
                  : fact
            ),
          },
        })),
        summary: "WTH2 forecast for Shanghai, China on 2026-06-13: Rain",
      }
    : undefined,
};
const currentToolResultEntry = conversationProjector.projectContextToolResults(
  currentRequestId,
  toolResultRenderer.render({
    kind: "ToolResults",
    value: [currentWeatherResult],
  }),
  "2026-06-11T00:02:00.000Z",
  undefined,
  1,
);
const currentRunMessages = conversationPolicy.materialize(
  [
    ...historyEntries,
    currentUserEntry,
    currentToolResultEntry,
  ],
  {
    toolResultsScope: {
      kind: "request",
      requestId: currentRequestId,
    },
  },
);
const currentRunInput = contextBuilder.buildInput({
  requestId: currentRequestId,
  userMessage: currentUserEntry.content,
  currentStep: 2,
  dynamicTools: true,
  loadedToolNames: ["WeatherTool"],
  messages: currentRunMessages,
  conversationEntries: [
    ...historyEntries,
    currentUserEntry,
    currentToolResultEntry,
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
assert.equal(currentRunInput.timeline.some((turn) => turn.content.includes("WTH1")), false);
assert.equal(currentRunInput.timeline.some((turn) => turn.content.includes("WTH2")), true);

console.log("Planner memory projection verification passed.");
