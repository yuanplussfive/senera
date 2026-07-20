import { describe, expect, test } from "vitest";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import { projectAgentRunEventForHistory } from "../../../Source/AgentSystem/Events/AgentRunEventHistoryPolicy.js";

describe("run event history policy", () => {
  test("persists Pi traces as lightweight spans instead of raw provider payloads", () => {
    const projected = projectAgentRunEventForHistory({
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.PiTrace,
      layer: AgentEventLayers.Progress,
      phase: AgentEventPhases.Model,
      sequence: 1,
      timestamp: "2026-07-17T00:00:00.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      step: 1,
      data: {
        source: "proxy",
        eventType: "provider_response",
        summary: "kind=final_answer",
        payload: {
          durationMs: 1250,
          model: "fast-planner",
          callId: "call-1",
          error: { message: "provider warning", stack: "x".repeat(100_000) },
          transcript: "x".repeat(4_000_000),
          messages: Array.from({ length: 100 }, () => ({ content: "large" })),
        },
      },
    });

    expect(projected?.data).toEqual({
      source: "proxy",
      eventType: "provider_response",
      summary: "kind=final_answer",
      payload: {
        durationMs: 1250,
        model: "fast-planner",
        callId: "call-1",
        error: "provider warning",
      },
    });
    expect(JSON.stringify(projected).length).toBeLessThan(1_000);
  });
});
