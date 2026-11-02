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
        dedupeKeys: ["memos:knowledge-1", "memos:knowledge-1@v1"],
      },
    ],
  };
  test("retains native identity and excludes internal deduplication state", () => {
    const snapshot = projectAgentContinuitySnapshot(memory);
    expect(snapshot).toEqual({
      enabled: true,
      query: memory.query,
      eventCandidates: [
        expect.objectContaining({
          id: "knowledge-1",
          matchedBy: memory.eventCandidates[0]!.matchedBy,
          scores: memory.eventCandidates[0]!.scores,
        }),
      ],
      selection: memory.selection,
      metrics: { ranking: { count: 1, average: 0.92, max: 0.92 }, relevance: { count: 0 } },
    });
    expect(snapshot.eventCandidates[0]).not.toHaveProperty("dedupeKeys");
    expect(snapshot.eventCandidates).not.toBe(memory.eventCandidates);
    expect(snapshot.eventCandidates[0]?.matchedBy).not.toBe(memory.eventCandidates[0]?.matchedBy);
    expect(snapshot.eventCandidates[0]?.scores).not.toBe(memory.eventCandidates[0]?.scores);
  });
  test("summarizes ranking independently and never substitutes it for missing relevance", () => {
    const preference = { ...memory.eventCandidates[0]!, score: 0.5, scores: undefined };
    const task = { ...preference, id: "task", type: "context" as const, score: 0.7, scores: { relevance: 0 } };
    const fact = { ...preference, id: "fact", type: "fact" as const, score: 0.3, scores: { relevance: 0.9 } };
    const snapshot = projectAgentContinuitySnapshot({
      ...memory,
      eventCandidates: [preference, fact],
      taskCandidates: [task],
    });
    expect(snapshot.metrics?.ranking).toEqual({ count: 3, average: 0.5, max: 0.7 });
    expect(snapshot.metrics?.relevance).toEqual({ count: 2, average: 0.45, max: 0.9 });
    const empty = projectAgentContinuitySnapshot(EmptyAgentContinuityMemoryPromptContext);
    expect(empty.metrics).toEqual({ ranking: { count: 0 }, relevance: { count: 0 } });
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
