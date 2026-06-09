import { describe, expect, it } from "vitest";
import {
  EventKinds,
  EventLayers,
  EventPhases,
  type EventEnvelope,
} from "../api/eventTypes";
import { applyServerKnownSessionEvent } from "./useServerKnownSessions";

function event(kind: EventEnvelope["kind"], overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    channel: "agent.event",
    kind,
    layer: EventLayers.Snapshot,
    phase: EventPhases.Session,
    sequence: 1,
    timestamp: "2026-06-08T00:00:00.000Z",
    data: {},
    ...overrides,
  };
}

describe("applyServerKnownSessionEvent", () => {
  it("marks created and snapshot sessions as known", () => {
    const known = new Set<string>();

    expect(applyServerKnownSessionEvent(known, event(EventKinds.SessionCreated, {
      sessionId: "session-a",
    }))).toBe(true);
    expect(applyServerKnownSessionEvent(known, event(EventKinds.SessionSnapshot, {
      sessionId: "session-b",
    }))).toBe(true);

    expect([...known]).toEqual(["session-a", "session-b"]);
  });

  it("removes closed sessions from the known set", () => {
    const known = new Set(["session-a", "session-b"]);

    expect(applyServerKnownSessionEvent(known, event(EventKinds.SessionClosed, {
      sessionId: "session-a",
    }))).toBe(true);

    expect([...known]).toEqual(["session-b"]);
  });

  it("ignores unrelated events and events without a session id", () => {
    const known = new Set(["session-a"]);

    expect(applyServerKnownSessionEvent(known, event(EventKinds.ModelDelta, {
      sessionId: "session-b",
    }))).toBe(false);
    expect(applyServerKnownSessionEvent(known, event(EventKinds.SessionCreated))).toBe(false);
    expect([...known]).toEqual(["session-a"]);
  });
});
