import { describe, expect, test } from "vitest";
import { EmptyAgentContinuityMemoryPromptContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import { projectAgentContinuitySnapshot } from "../../../Source/AgentSystem/Continuity/AgentContinuitySnapshot.js";
import { AgentLoopPromptEventFactory } from "../../../Source/AgentSystem/Loop/AgentLoopPromptEventFactory.js";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import { projectAgentRunEventForHistory } from "../../../Source/AgentSystem/Events/AgentRunEventHistoryPolicy.js";

describe("native MemOS snapshots", () => {
  const memory = {
    ...EmptyAgentContinuityMemoryPromptContext,
    enabled: true,
    query: "用户偏好",
    deliveryEpoch: 7,
    eventCandidates: [
      {
        id: "knowledge-1",
        uri: "memos:knowledge-1",
        revision: "v1",
        type: "preference" as const,
        summary: "用户偏好先给结论。",
        occurredAt: "2026-08-22T08:00:00Z",
        score: 0.92,
        matchedBy: ["memos", "semantic"],
        scores: { keyword: 0.72, semantic: 0.91, hybrid: 0.82 },
      },
    ],
  };
  test("retains native identity and excludes internal delivery state", () => {
    const snapshot = projectAgentContinuitySnapshot(memory);
    expect(snapshot).toEqual({
      enabled: true,
      query: memory.query,
      eventCandidates: memory.eventCandidates,
      periodDigests: [],
      selection: memory.selection,
    });
    expect(snapshot).not.toHaveProperty("deliveryEpoch");
    expect(snapshot.eventCandidates).not.toBe(memory.eventCandidates);
    expect(snapshot.eventCandidates[0]?.matchedBy).not.toBe(memory.eventCandidates[0]?.matchedBy);
    expect(snapshot.eventCandidates[0]?.scores).not.toBe(memory.eventCandidates[0]?.scores);
  });
  test("emits and preserves exactly the selected native records for history replay", () => {
    const events = new AgentLoopPromptEventFactory().promptRendered("request-1", 1, "prompt", 2, memory);
    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.PromptSummary,
      AgentEventKinds.ContinuitySnapshot,
    ]);
    const snapshot = projectAgentContinuitySnapshot(memory);
    const event = projectAgentRunEventForHistory({
      eventId: "continuity-1",
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.ContinuitySnapshot,
      layer: AgentEventLayers.Snapshot,
      phase: AgentEventPhases.Prompt,
      sequence: 2,
      timestamp: "2026-08-22T08:00:00Z",
      sessionId: "session-1",
      requestId: "request-1",
      step: 1,
      data: snapshot,
    });
    expect(event?.data).toEqual(snapshot);
    expect(events[1]?.data).toEqual(snapshot);
  });
});
