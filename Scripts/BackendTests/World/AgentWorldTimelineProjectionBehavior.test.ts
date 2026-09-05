import { describe, expect, test } from "vitest";
import type { AgentWorldEvent } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { projectAgentWorldTimeline } from "../../../Source/AgentSystem/World/AgentWorldTimelineProjection.js";

const localDate = "2026-09-01";

describe("world timeline projection", () => {
  test("shows a sealed segment summary in place of covered turn events", () => {
    const events = [
      event({
        id: "turn-1",
        type: "conversation.turn.completed",
        occurredAt: "2026-09-01T08:00:00.000Z",
        evidenceRefs: ["senera://memory-episode/one", "senera://memory-source/one"],
        summary: "很长的逐轮对话文本",
      }),
      event({
        id: "tool-1",
        type: "tool.completed",
        occurredAt: "2026-09-01T08:01:00.000Z",
        evidenceRefs: ["senera://event/tool-1"],
        summary: "资料查询完成",
      }),
      event({
        id: "segment-1",
        type: "conversation.segment.completed",
        occurredAt: "2026-09-01T08:05:00.000Z",
        evidenceRefs: ["senera://memory-episode/one"],
        summary: "这一段对话围绕资料查询展开。",
      }),
    ];

    expect(
      projectAgentWorldTimeline({
        events,
        localDate,
        limit: 10,
      }).map((entry) => entry.id),
    ).toEqual(["tool-1", "segment-1"]);
    expect(events.map((entry) => entry.id)).toEqual(["turn-1", "tool-1", "segment-1"]);
  });

  test("does not hide a turn when the rollup does not cover it", () => {
    const events = [
      event({
        id: "turn-1",
        type: "conversation.turn.completed",
        occurredAt: "2026-09-01T08:00:00.000Z",
        evidenceRefs: ["senera://memory-episode/one"],
        summary: "未被覆盖的交流",
      }),
      event({
        id: "segment-1",
        type: "conversation.segment.completed",
        occurredAt: "2026-09-01T08:05:00.000Z",
        evidenceRefs: ["senera://memory-episode/two"],
        summary: "另一段交流",
      }),
    ];

    expect(
      projectAgentWorldTimeline({
        events,
        localDate,
        limit: 10,
      }).map((entry) => entry.id),
    ).toEqual(["turn-1", "segment-1"]);
  });
});

function event(input: {
  id: string;
  type: string;
  occurredAt: string;
  evidenceRefs: string[];
  summary: string;
}): AgentWorldEvent {
  return {
    ...input,
    uri: `senera://world-event/${input.id}`,
    worldId: "world",
    sequence: 1,
    subject: { id: input.id, kind: "conversation" },
    changes: [],
    recordedAt: input.occurredAt,
    localDate,
    source: "world",
  };
}
