import { describe, expect, it } from "vitest";
import {
  EventKinds,
  EventLayers,
  EventPhases,
  type EventEnvelope,
} from "../api/eventTypes";
import {
  resolveSessionNotFoundRecovery,
} from "./useSessionNotFoundRecovery";
import type { LastSentMessage } from "./useChatCommands";

const lastSentMessage: LastSentMessage = {
  sessionId: "missing-session",
  requestId: "request-a",
  input: "please continue",
  modelProviderId: "model-a",
};

function event(kind: EventEnvelope["kind"], overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    channel: "agent.event",
    kind,
    layer: EventLayers.Error,
    phase: EventPhases.Session,
    sequence: 1,
    timestamp: "2026-06-08T00:00:00.000Z",
    data: {},
    ...overrides,
  };
}

function sessionNotFound(operation: "session.message" | "session.close" | "session.history"): EventEnvelope {
  return event(EventKinds.SessionNotFound, {
    sessionId: "missing-session",
    data: {
      sessionId: "missing-session",
      operation,
      message: "missing",
    },
  });
}

describe("resolveSessionNotFoundRecovery", () => {
  it("ingests history misses and shows the missing-backend-session warning without recreating", () => {
    expect(resolveSessionNotFoundRecovery(sessionNotFound("session.history"), lastSentMessage)).toEqual({
      kind: "history_missing",
      sessionId: "missing-session",
      toast: {
        variant: "warning",
        title: "该本地会话在后端不存在",
        description: "已切换到仍存在历史的会话。旧的本地占位不会再被自动恢复成空会话。",
      },
    });
  });

  it("refreshes the session list for close misses without ingesting the event", () => {
    expect(resolveSessionNotFoundRecovery(sessionNotFound("session.close"), lastSentMessage)).toEqual({
      kind: "close_missing",
      sessionId: "missing-session",
      listRequest: { type: "session.list" },
      toast: {
        variant: "info",
        title: "会话已从本地列表移除",
        description: "后端已不存在该会话。",
      },
    });
  });

  it("recreates and replays a missing message session when the last sent message matches", () => {
    expect(resolveSessionNotFoundRecovery(sessionNotFound("session.message"), lastSentMessage)).toEqual({
      kind: "message_recreate",
      sessionId: "missing-session",
      createRequest: { type: "session.create", sessionId: "missing-session" },
      replayRequest: {
        type: "session.message",
        sessionId: "missing-session",
        requestId: "request-a",
        input: "please continue",
        modelProviderId: "model-a",
      },
      toast: {
        variant: "info",
        title: "已自动恢复会话",
        description: "后端不再保留先前上下文，但消息记录在前端完整保留。",
      },
    });
  });

  it("recreates a missing message session without replaying unrelated last-send state", () => {
    expect(resolveSessionNotFoundRecovery(sessionNotFound("session.message"), {
      ...lastSentMessage,
      sessionId: "other-session",
    })).toEqual({
      kind: "message_recreate",
      sessionId: "missing-session",
      createRequest: { type: "session.create", sessionId: "missing-session" },
      replayRequest: undefined,
      toast: undefined,
    });
  });

  it("ignores unrelated events and session.not_found events without a session id", () => {
    expect(resolveSessionNotFoundRecovery(event(EventKinds.RunFailed), lastSentMessage)).toBeNull();
    expect(resolveSessionNotFoundRecovery(event(EventKinds.SessionNotFound), lastSentMessage)).toBeNull();
  });
});
