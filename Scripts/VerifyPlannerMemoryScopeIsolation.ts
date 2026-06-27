import assert from "node:assert/strict";
import { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/AgentActionPlannerContext.js";
import { EmptyActionPlannerLedger } from "../Source/AgentSystem/AgentActionPlannerLedger.js";
import { AgentConversationProjector } from "../Source/AgentSystem/AgentConversationProjector.js";
import { AgentEvidenceBroker } from "../Source/AgentSystem/AgentEvidenceBroker.js";
import { createToolEvidenceMemoryEntries } from "../Source/AgentSystem/AgentPlannerMemory.js";
import type { AgentToolCatalogItem } from "../Source/AgentSystem/AgentToolCatalogProjector.js";
import {
  TaskEvidenceScope,
  type TaskFrame,
} from "../Source/AgentSystem/BamlClient/baml_client/types.js";

void main();

async function main(): Promise<void> {
  const previousRequestId = "request_weather_previous";
  const currentRequestId = "request_weather_followup";
  const timestamp = "2026-06-21T00:00:00.000Z";
  const weatherEvidenceUri = "senera://evidence/ev_333333333333333333333333";
  const conversation = new AgentConversationProjector();
  const entries = [
    conversation.projectUserInput(previousRequestId, "查一下上海明天天气", timestamp),
    ...createToolEvidenceMemoryEntries({
      requestId: previousRequestId,
      step: 1,
      timestamp,
      results: [{
        callId: "call_weather",
        name: "WeatherTool",
        arguments: {
          location: "Shanghai, China",
        },
        process: {
          exitCode: 0,
          signal: null,
          stderr: "",
        },
        result: {},
        artifact: {
          artifactId: "art_weather",
          artifactUri: "senera://artifact/art_weather",
          artifactPath: ".senera/artifacts/runs/request_weather_previous/step_001",
          relativePath: "request_weather_previous/step_001",
          manifestPath: ".senera/artifacts/runs/request_weather_previous/step_001/manifest.json",
          files: {},
          summary: "forecast for Shanghai, China on 2026-06-22: Cloudy",
          evidence: [{
            key: "weather.forecast:Shanghai, China:2026-06-22",
            evidenceUri: weatherEvidenceUri,
            kind: "weather_forecast_day",
            locator: "Shanghai, China @ 2026-06-22",
            display: "forecast for Shanghai, China on 2026-06-22: Cloudy",
            label: "Shanghai forecast 2026-06-22",
            source: "WeatherAPI",
            confidence: 0.8,
            slots: {
              condition: "Cloudy",
            },
            modelSlots: [
              { name: "condition", value: "Cloudy" },
            ],
            plannerMemory: {
              facts: [
                { name: "condition", value: "Cloudy" },
              ],
              artifactRefs: ["projection"],
            },
          }],
          delta: [],
        },
      }],
    }),
  ];

  const input = new AgentActionPlannerContextBuilder().buildInput({
    requestId: currentRequestId,
    userMessage: "还是这个天气吗？",
    currentStep: 1,
    dynamicTools: true,
    loadedToolNames: ["WeatherTool", "ArtifactMemoryReadTool"],
    messages: [{
      role: "user",
      content: "还是这个天气吗？",
    }],
    conversationEntries: entries,
    ledger: EmptyActionPlannerLedger,
    toolCatalog: createToolCatalog(),
    activeSkills: [],
  });

  assert.equal(input.evidenceMemory.length, 1);
  assert.equal(input.evidenceMemory[0]?.evidenceUri, weatherEvidenceUri);
  assert.equal(input.evidenceState.length, 0);

  const decision = await new AgentEvidenceBroker().decide({
    input,
    taskFrame: createMemoryScopedTaskFrame(),
  });

  assert.equal(decision.ready, true);
  assert.equal(decision.action.action, "answer");
  assert.equal(decision.missingNeeds.length, 0);
  assert.equal(decision.recommendedTools.length, 0);

  console.log("Planner memory scope isolation verification passed.");
}

function createMemoryScopedTaskFrame(): TaskFrame {
  return {
    taskType: "weather follow-up",
    answerGoal: "Answer from the historical weather evidence already in memory.",
    intentTags: ["weather", "follow-up"],
    taskTags: ["weather", "天气"],
    targetRefs: [{
      kind: "weather-memory",
      value: "Shanghai, China @ 2026-06-22",
      status: "from-memory",
    }],
    candidateTools: [{
      name: "ArtifactMemoryReadTool",
      purpose: "Load full artifact details only if the memory projection is insufficient.",
      supports: ["artifact-memory"],
    }],
    discoveryQueries: [],
    requiredEffects: [],
    requiredEvidence: [{
      id: "historical-weather-memory",
      need: "historical weather evidence already projected into memory",
      scope: TaskEvidenceScope.Memory,
      minimum: 1,
      reason: "The current follow-up can be answered from historical projected evidence.",
    }],
    userInputNeeds: [],
    nextStepPurpose: "Answer using the remembered weather projection.",
    completionCriteria: ["The answer does not call tools again when memory is enough."],
    notes: [],
  };
}

function createToolCatalog(): AgentToolCatalogItem[] {
  return [
    {
      name: "WeatherTool",
      title: "Weather",
      summary: "Read weather observations and forecasts.",
      rootKind: "User",
      capabilities: [{
        id: "weather.forecast",
        title: "Weather forecast",
        description: "Fetch current weather forecast evidence.",
        facets: {
          Actions: ["read"],
          Targets: ["weather"],
          Inputs: ["location", "date"],
          Outputs: ["forecast"],
          Evidence: ["weather_forecast_day"],
          Effects: ["read-only"],
        },
      }],
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
        capabilityIds: ["weather.forecast"],
      }],
    },
    {
      name: "ArtifactMemoryReadTool",
      title: "Artifact memory read",
      summary: "Read full stored artifact memory.",
      rootKind: "System",
      capabilities: [{
        id: "artifact.memory.read",
        title: "Artifact memory read",
        description: "Load full stored artifact projection by URI.",
        facets: {
          Actions: ["read"],
          Targets: ["artifact-memory"],
          Inputs: ["artifact-uri"],
          Outputs: ["artifact-projection"],
          Evidence: ["artifact-memory"],
          Effects: ["read-only"],
        },
      }],
      tags: [],
      useCases: [],
      examples: [],
      avoid: [],
      permissions: [],
      evidenceCapabilities: [{
        produces: "artifact memory",
        quality: "projected",
        satisfies: ["artifact memory"],
        kinds: ["artifact_memory"],
        capabilityIds: ["artifact.memory.read"],
      }],
    },
  ];
}
