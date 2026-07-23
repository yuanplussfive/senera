import { describe, expect, test } from "vitest";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import { projectAgentRunEventForHistory } from "../../../Source/AgentSystem/Events/AgentRunEventHistoryPolicy.js";

describe("run event history policy", () => {
  test("does not persist transient run activity", () => {
    const projected = projectAgentRunEventForHistory({
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.RunActivityChanged,
      layer: AgentEventLayers.Progress,
      phase: AgentEventPhases.Run,
      sequence: 1,
      timestamp: "2026-07-17T00:00:00.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      step: 1,
      data: {
        activityId: "activity-1",
        activity: "running_agent_turn",
        state: "started",
      },
    });

    expect(projected).toBeUndefined();
  });

  test("persists model completion metadata without duplicating response text", () => {
    const projected = projectAgentRunEventForHistory({
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.ModelCompleted,
      layer: AgentEventLayers.Snapshot,
      phase: AgentEventPhases.Model,
      sequence: 1,
      timestamp: "2026-07-17T00:00:00.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      step: 1,
      data: {
        text: "x".repeat(4_000_000),
        provider: { endpointId: "provider-1", model: "fast-planner" },
        usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      },
    });

    expect(projected?.data).toEqual({
      text: "",
      provider: { endpointId: "provider-1", model: "fast-planner" },
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    });
    expect(JSON.stringify(projected).length).toBeLessThan(1_000);
  });
});
