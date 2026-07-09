import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import {
  coalesceStreamingEvents,
  isBufferedStreamingEvent,
  StreamingEventMaxLatencyMs,
} from "../../../Frontend/src/api/streamingEventCoalescer.ts";

test("model delta events are buffered and coalesced by session request and step", () => {
  const queue = [
    event("session_a", "request_a", 1, 9, "你"),
    event("session_a", "request_a", 1, 10, "好"),
    event("session_a", "request_b", 1, 11, "新"),
    event("session_a", "request_a", 2, 12, "步骤"),
  ];

  const coalesced = coalesceStreamingEvents(queue);

  expect(isBufferedStreamingEvent(EventKinds.ModelDelta)).toBe(true);
  expect(isBufferedStreamingEvent(EventKinds.RunCompleted)).toBe(false);
  expect(StreamingEventMaxLatencyMs).toBeGreaterThan(0);
  expect(coalesced.map((item) => [
    item.sessionId,
    item.requestId,
    item.step,
    item.sequence,
    item.timestamp,
    item.data,
  ])).toEqual([
    ["session_a", "request_a", 1, 9, "2026-07-09T00:00:09.000Z", { text: "你好" }],
    ["session_a", "request_b", 1, 11, "2026-07-09T00:00:11.000Z", { text: "新" }],
    ["session_a", "request_a", 2, 12, "2026-07-09T00:00:12.000Z", { text: "步骤" }],
  ]);
});

test("missing delta text is treated as an empty string without dropping the event", () => {
  const coalesced = coalesceStreamingEvents([
    {
      ...event("session_a", "request_a", 1, 1, "开头"),
      data: {},
    },
    event("session_a", "request_a", 1, 2, "正文"),
  ]);

  expect(coalesced.length).toBe(1);
  expect(coalesced[0].data).toEqual({ text: "正文" });
  expect(coalesced[0].sequence).toBe(1);
});

function event(sessionId, requestId, step, sequence, text) {
  return {
    channel: "agent.event",
    kind: EventKinds.ModelDelta,
    layer: "progress",
    phase: "model",
    sequence,
    timestamp: `2026-07-09T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    sessionId,
    requestId,
    step,
    data: { text },
  };
}
