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
  expect(isBufferedStreamingEvent(EventKinds.ExecutionResourceOutput)).toBe(true);
  expect(isBufferedStreamingEvent(EventKinds.RunCompleted)).toBe(false);
  expect(StreamingEventMaxLatencyMs).toBeGreaterThan(0);
  expect(
    coalesced.map((item) => [item.sessionId, item.requestId, item.step, item.sequence, item.timestamp, item.data]),
  ).toEqual([
    ["session_a", "request_a", 1, 9, "2026-07-09T00:00:09.000Z", { text: "你好" }],
    ["session_a", "request_b", 1, 11, "2026-07-09T00:00:11.000Z", { text: "新" }],
    ["session_a", "request_a", 2, 12, "2026-07-09T00:00:12.000Z", { text: "步骤" }],
  ]);
});

test("contiguous terminal output is coalesced without losing cursor boundaries", () => {
  const coalesced = coalesceStreamingEvents([
    outputEvent(20, "stdout", "first", 5),
    outputEvent(21, "stdout", " second", 7),
    outputEvent(22, "stderr", " error", 6),
    outputEvent(23, "stdout", " tail", 5),
  ]);

  expect(coalesced).toHaveLength(3);
  expect(coalesced[0]).toMatchObject({
    sequence: 20,
    timestamp: "2026-07-09T00:00:20.000Z",
    data: {
      resourceId: "resource_a",
      cursorStart: 20,
      cursor: 21,
      stream: "stdout",
      text: "first second",
      byteLength: 12,
      totalBytes: 12,
    },
  });
  expect(coalesced[1].data).toMatchObject({ cursor: 22, stream: "stderr", text: " error" });
  expect(coalesced[2].data).toMatchObject({ cursor: 23, stream: "stdout", text: " tail" });
});

test("terminal output gaps are not hidden by frame coalescing", () => {
  const coalesced = coalesceStreamingEvents([
    outputEvent(30, "stdout", "before", 6),
    outputEvent(32, "stdout", "after", 5),
  ]);

  expect(coalesced).toHaveLength(2);
  expect(coalesced.map((item) => item.data.cursor)).toEqual([30, 32]);
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

test("non-streaming events remain ordering barriers inside a frame batch", () => {
  const boundary = {
    ...event("session_a", "request_a", 1, 2, ""),
    kind: EventKinds.ToolCallStarted,
    phase: "tool",
    data: { toolName: "WorkspaceReadFile", callId: "call_a" },
  };
  const coalesced = coalesceStreamingEvents([
    event("session_a", "request_a", 1, 1, "before"),
    boundary,
    event("session_a", "request_a", 1, 3, "after"),
  ]);

  expect(coalesced.map((item) => [item.kind, item.sequence])).toEqual([
    [EventKinds.ModelDelta, 1],
    [EventKinds.ToolCallStarted, 2],
    [EventKinds.ModelDelta, 3],
  ]);
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

function outputEvent(cursor, stream, text, byteLength) {
  return {
    channel: "agent.event",
    kind: EventKinds.ExecutionResourceOutput,
    layer: "progress",
    phase: "tool",
    sequence: cursor,
    timestamp: `2026-07-09T00:00:${String(cursor).padStart(2, "0")}.000Z`,
    sessionId: "session_a",
    requestId: "request_a",
    step: 1,
    data: {
      resourceId: "resource_a",
      cursor,
      stream,
      text,
      byteLength,
      totalBytes: cursor === 20 ? byteLength : 12,
    },
  };
}
