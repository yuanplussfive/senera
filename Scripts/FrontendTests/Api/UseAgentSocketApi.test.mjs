import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import {
  parseAgentSocketEventData,
  readAgentSocketRetryDelayMs,
} from "../../../Frontend/src/api/useAgentSocket.ts";

test("agent socket retry delay uses capped exponential backoff", () => {
  expect(readAgentSocketRetryDelayMs(0)).toBe(1000);
  expect(readAgentSocketRetryDelayMs(1)).toBe(2000);
  expect(readAgentSocketRetryDelayMs(4)).toBe(15000);
  expect(readAgentSocketRetryDelayMs(20)).toBe(15000);
  expect(readAgentSocketRetryDelayMs(-1)).toBe(1000);
});

test("agent socket event parser accepts string event payloads and rejects malformed frames", () => {
  const env = parseAgentSocketEventData(JSON.stringify({
    channel: "agent.event",
    kind: EventKinds.RunStarted,
    layer: "progress",
    phase: "run",
    sequence: 1,
    timestamp: "2026-07-09T00:00:00.000Z",
    data: { input: "hello" },
  }));

  expect(env.kind).toBe(EventKinds.RunStarted);
  expect(env.data).toEqual({ input: "hello" });
  expect(() => parseAgentSocketEventData({})).toThrow();
  expect(() => parseAgentSocketEventData("{")).toThrow();
});
