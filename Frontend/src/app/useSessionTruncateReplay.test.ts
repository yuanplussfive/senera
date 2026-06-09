import { describe, expect, it } from "vitest";
import {
  EventKinds,
  EventLayers,
  EventPhases,
  type EventEnvelope,
} from "../api/eventTypes";
import {
  executeSessionTruncateReplay,
  resolveSessionTruncateReplay,
} from "./useSessionTruncateReplay";
import type { LastSentMessage, PendingAfterTruncate } from "./useChatCommands";

const pending: PendingAfterTruncate = {
  sessionId: "session-a",
  requestId: "request-a",
  nextInput: "replay me",
  modelProviderId: "model-a",
};

function event(kind: EventEnvelope["kind"], overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    channel: "agent.event",
    kind,
    layer: EventLayers.Snapshot,
    phase: EventPhases.Session,
    sequence: 1,
    timestamp: "2026-06-08T00:00:00.000Z",
    sessionId: "session-a",
    data: {},
    ...overrides,
  };
}

function truncated(fromRequestId = "request-a"): EventEnvelope {
  return event(EventKinds.SessionTruncated, {
    data: {
      sessionId: "session-a",
      fromRequestId,
      removedEntries: 2,
    },
  });
}

describe("resolveSessionTruncateReplay", () => {
  it("derives the replay request and append payload from a matching truncate event", () => {
    expect(resolveSessionTruncateReplay({
      createRequestId: () => "request-b",
      env: truncated(),
      pendingAfterTruncate: [pending],
    })).toEqual({
      appendUserMessage: {
        sessionId: "session-a",
        requestId: "request-b",
        input: "replay me",
      },
      lastSentMessage: {
        sessionId: "session-a",
        requestId: "request-b",
        input: "replay me",
        modelProviderId: "model-a",
      },
      messageRequest: {
        type: "session.message",
        sessionId: "session-a",
        requestId: "request-b",
        input: "replay me",
        modelProviderId: "model-a",
      },
      nextQueue: [],
    });
  });

  it("ignores unrelated events, missing session ids, and missing pending actions", () => {
    expect(resolveSessionTruncateReplay({
      createRequestId: () => "request-b",
      env: event(EventKinds.RunCompleted),
      pendingAfterTruncate: [pending],
    })).toBeNull();
    expect(resolveSessionTruncateReplay({
      createRequestId: () => "request-b",
      env: event(EventKinds.SessionTruncated, { sessionId: undefined }),
      pendingAfterTruncate: [pending],
    })).toBeNull();
    expect(resolveSessionTruncateReplay({
      createRequestId: () => "request-b",
      env: truncated("other-request"),
      pendingAfterTruncate: [pending],
    })).toBeNull();
  });
});

describe("executeSessionTruncateReplay", () => {
  it("sends the replay request before appending the replacement user message", () => {
    const calls: string[] = [];
    const lastSendRef = { current: null as LastSentMessage | null };
    const pendingAfterTruncateRef = { current: [pending] };
    const sentRequests: unknown[] = [];
    const appended: unknown[] = [];
    const replay = resolveSessionTruncateReplay({
      createRequestId: () => "request-b",
      env: truncated(),
      pendingAfterTruncate: [pending],
    });

    if (!replay) {
      throw new Error("expected replay");
    }

    const send = (request: unknown): boolean => {
      calls.push("send");
      sentRequests.push(request);
      return true;
    };

    expect(executeSessionTruncateReplay({
      appendUserMessage: (sessionId, requestId, input) => {
        calls.push("append");
        appended.push({ sessionId, requestId, input });
      },
      lastSendRef,
      pendingAfterTruncateRef,
      replay,
      send,
    })).toBe(true);
    expect(calls).toEqual(["send", "append"]);
    expect(sentRequests).toEqual([{
      type: "session.message",
      sessionId: "session-a",
      requestId: "request-b",
      input: "replay me",
      modelProviderId: "model-a",
    }]);
    expect(appended).toEqual([{
      sessionId: "session-a",
      requestId: "request-b",
      input: "replay me",
    }]);
    expect(lastSendRef.current).toEqual({
      sessionId: "session-a",
      requestId: "request-b",
      input: "replay me",
      modelProviderId: "model-a",
    });
    expect(pendingAfterTruncateRef.current).toEqual([]);
  });

  it("does not append the replacement user message when replay send fails", () => {
    const lastSendRef = { current: null as LastSentMessage | null };
    const pendingAfterTruncateRef = { current: [pending] };
    const appended: unknown[] = [];
    const replay = resolveSessionTruncateReplay({
      createRequestId: () => "request-b",
      env: truncated(),
      pendingAfterTruncate: [pending],
    });

    if (!replay) {
      throw new Error("expected replay");
    }

    const send = (): boolean => false;

    expect(executeSessionTruncateReplay({
      appendUserMessage: (sessionId, requestId, input) => {
        appended.push({ sessionId, requestId, input });
      },
      lastSendRef,
      pendingAfterTruncateRef,
      replay,
      send,
    })).toBe(false);
    expect(appended).toEqual([]);
    expect(lastSendRef.current).toBeNull();
    expect(pendingAfterTruncateRef.current).toEqual([]);
  });

  it("preserves unrelated pending truncate actions after consuming the matching replay", () => {
    const lastSendRef = { current: null as LastSentMessage | null };
    const unrelated: PendingAfterTruncate = {
      sessionId: "session-b",
      requestId: "request-b",
      nextInput: "other",
    };
    const pendingAfterTruncateRef = { current: [pending, unrelated] };
    const replay = resolveSessionTruncateReplay({
      createRequestId: () => "request-c",
      env: truncated(),
      pendingAfterTruncate: pendingAfterTruncateRef.current,
    });

    if (!replay) {
      throw new Error("expected replay");
    }

    expect(executeSessionTruncateReplay({
      appendUserMessage: (sessionId, requestId, input) => {
        expect({ sessionId, requestId, input }).toEqual({
          sessionId: "session-a",
          requestId: "request-c",
          input: "replay me",
        });
      },
      lastSendRef,
      pendingAfterTruncateRef,
      replay,
      send: () => true,
    })).toBe(true);
    expect(pendingAfterTruncateRef.current).toEqual([unrelated]);
  });
});
