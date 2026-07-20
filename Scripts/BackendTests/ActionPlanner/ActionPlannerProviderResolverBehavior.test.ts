import { describe, expect, test } from "vitest";
import { resolvePlannerProvider } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerProviderResolver.js";
import { createModelProvider, createPlannerConfig } from "../Support/AgentTestFixtures.js";

describe("action planner provider resolution", () => {
  test("inherits the complete independently selected provider instead of the session provider", () => {
    const sessionProvider = createModelProvider({
      Id: "session-provider",
      ProviderId: "session-endpoint",
      Headers: { "x-session": "session" },
      TimeoutMs: 10_000,
      ContextWindowTokens: 32_000,
    });
    const planningProvider = createModelProvider({
      Id: "planning-provider",
      ProviderId: "planning-endpoint",
      Endpoint: "GoogleGenerateContent",
      BaseUrl: "https://planning.example/v1",
      Model: "planning-model",
      Headers: { "x-planning": "planner" },
      TimeoutMs: 45_000,
      FirstTokenTimeoutMs: 12_000,
      MaxRequestMs: 90_000,
      MaxNetworkRetries: 3,
      ContextWindowTokens: 1_000_000,
      MaxModelOutputTokens: 16_384,
    });
    const client = createPlannerConfig().PlanningClient;

    const resolved = resolvePlannerProvider(sessionProvider, {
      ...client,
      ModelProviderId: planningProvider.Id,
      ModelProvider: planningProvider,
      BaseUrl: planningProvider.BaseUrl,
      ApiKey: planningProvider.ApiKey,
      Model: planningProvider.Model,
    });

    expect(resolved).toMatchObject({
      Id: "planning-provider",
      ProviderId: "planning-endpoint",
      Endpoint: "GoogleGenerateContent",
      BaseUrl: "https://planning.example/v1",
      Model: "planning-model",
      Headers: { "x-planning": "planner" },
      TimeoutMs: 45_000,
      FirstTokenTimeoutMs: 12_000,
      MaxRequestMs: 90_000,
      MaxNetworkRetries: 3,
      ContextWindowTokens: 1_000_000,
      MaxModelOutputTokens: 16_384,
      Stream: false,
    });
  });
});
