import { expect, test } from "vitest";
import {
  applyModelListSnapshotSelection,
  applyDefaultModelToActiveSession,
  selectModelForActiveSession,
  syncActiveSessionModelSelection,
} from "../../../Frontend/src/store/session/sessionModelSelection.ts";
import { createTestState, TestSessionId } from "./sessionProjectorTestUtils.mjs";

const models = [
  {
    id: "global",
    capabilities: { Chat: true },
    toolPlanningMode: "baml",
    stream: true,
    thinkingLevels: ["off", "low"],
    defaultThinkingLevel: "low",
  },
  {
    id: "agent",
    capabilities: { Chat: true },
    toolPlanningMode: "baml",
    stream: true,
    thinkingLevels: ["off", "high"],
    defaultThinkingLevel: "high",
  },
];

function inheritedState(preference) {
  return createTestState({
    activeSessionId: TestSessionId,
    sessions: {
      [TestSessionId]: {
        sessionId: TestSessionId,
        agentId: "agent-a",
        modelProviderId: "global",
        effectiveModel: { modelProviderId: "global" },
        modelPreference: preference,
      },
    },
    agentDirectory: { agents: [{ id: "agent-a", modelProviderId: "agent" }], defaultAgentId: "agent-a" },
    modelProviders: models,
    defaultModelProviderId: "global",
    selectedThinkingLevelsBySession: {},
  });
}

test("historical execution models never override the Agent default", () => {
  const state = inheritedState();
  syncActiveSessionModelSelection(state);
  expect(state.selectedModelProviderId).toBe("agent");
  expect(state.selectedThinkingLevel).toBe("high");
  expect(state.selectedModelProviderIdsBySession).toEqual({});
  expect(state.selectedThinkingLevelsBySession).toEqual({});
});

test("inherited model and reasoning follow default changes without becoming overrides", () => {
  const state = inheritedState();
  syncActiveSessionModelSelection(state);
  state.agentDirectory.agents[0].modelProviderId = "global";
  applyModelListSnapshotSelection(state, { models, defaultModelProviderId: "global" });
  expect(state.selectedModelProviderId).toBe("global");
  expect(state.selectedThinkingLevel).toBe("low");
});

test("an explicit conversation choice wins, and returning to an inherited default clears a local override", () => {
  const state = inheritedState();
  selectModelForActiveSession(state, "global");
  syncActiveSessionModelSelection(state);
  expect(state.selectedModelProviderId).toBe("global");
  expect(applyDefaultModelToActiveSession(state)).toBe(true);
  expect(state.selectedModelProviderId).toBe("agent");
  expect(state.selectedModelProviderIdsBySession).toEqual({});
});

test("a durable explicit model preference survives catalog refreshes", () => {
  for (const catalog of [
    models,
    models.map((model) => (model.id === "global" ? { ...model, capabilities: { Chat: false } } : model)),
  ]) {
    const state = inheritedState({ modelProviderId: "global" });
    applyModelListSnapshotSelection(state, { models: catalog, defaultModelProviderId: "agent" });
    expect(state.selectedModelProviderId).toBe("global");
  }
});
