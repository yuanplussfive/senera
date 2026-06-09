import { describe, expect, it } from "vitest";
import {
  normalizeEditedMessageContent,
  consumePendingAfterTruncate,
  removePendingAfterTruncate,
  resolveSendTargetSession,
  upsertPendingAfterTruncate,
  type PendingAfterTruncate,
} from "./useChatCommands";

const pendingA: PendingAfterTruncate = {
  sessionId: "session-a",
  requestId: "request-a",
  nextInput: "first",
  modelProviderId: "model-a",
};

describe("upsertPendingAfterTruncate", () => {
  it("adds a pending action when no matching session/request exists", () => {
    expect(upsertPendingAfterTruncate([], pendingA)).toEqual([pendingA]);
  });

  it("replaces a matching pending action while preserving unrelated items", () => {
    const unrelated: PendingAfterTruncate = {
      sessionId: "session-b",
      requestId: "request-b",
      nextInput: "other",
    };
    const replacement: PendingAfterTruncate = {
      ...pendingA,
      nextInput: "replacement",
    };

    expect(upsertPendingAfterTruncate([pendingA, unrelated], replacement)).toEqual([unrelated, replacement]);
  });
});

describe("removePendingAfterTruncate", () => {
  it("removes only the matching session/request pair", () => {
    const unrelated: PendingAfterTruncate = {
      sessionId: "session-a",
      requestId: "request-b",
      nextInput: "other",
    };

    expect(removePendingAfterTruncate([pendingA, unrelated], pendingA)).toEqual([unrelated]);
  });
});

describe("consumePendingAfterTruncate", () => {
  it("returns the replay request, last-send state, append data, and queue without the consumed item", () => {
    const unrelated: PendingAfterTruncate = {
      sessionId: "session-b",
      requestId: "request-b",
      nextInput: "other",
    };

    expect(consumePendingAfterTruncate({
      createRequestId: () => "new-request",
      fromRequestId: "request-a",
      queue: [pendingA, unrelated],
      sessionId: "session-a",
    })).toEqual({
      appendUserMessage: {
        sessionId: "session-a",
        requestId: "new-request",
        input: "first",
      },
      lastSentMessage: {
        sessionId: "session-a",
        requestId: "new-request",
        input: "first",
        modelProviderId: "model-a",
      },
      messageRequest: {
        type: "session.message",
        sessionId: "session-a",
        requestId: "new-request",
        modelProviderId: "model-a",
        input: "first",
      },
      nextQueue: [unrelated],
    });
  });

  it("returns null when no pending action matches the truncated session/request", () => {
    expect(consumePendingAfterTruncate({
      createRequestId: () => "new-request",
      fromRequestId: "missing-request",
      queue: [pendingA],
      sessionId: "session-a",
    })).toBeNull();
  });
});

describe("normalizeEditedMessageContent", () => {
  it("trims non-empty edited content", () => {
    expect(normalizeEditedMessageContent("  updated prompt  ")).toBe("updated prompt");
  });

  it("returns null for blank edited content", () => {
    expect(normalizeEditedMessageContent("   ")).toBeNull();
  });
});

describe("resolveSendTargetSession", () => {
  it("blocks sending while active session history is loading", () => {
    expect(resolveSendTargetSession({
      activeSessionId: "session-a",
      createSessionId: () => "created-session",
      historyLoadingIds: { "session-a": true },
      missingOnServerIds: {},
    })).toEqual({ kind: "blocked_history_loading", sessionId: "session-a" });
  });

  it("creates a new target when there is no active session", () => {
    expect(resolveSendTargetSession({
      activeSessionId: null,
      createSessionId: () => "created-session",
      historyLoadingIds: {},
      missingOnServerIds: {},
    })).toEqual({ kind: "ready", sessionId: "created-session", shouldCreateSession: true });
  });

  it("creates a new target when the active session is missing on the server", () => {
    expect(resolveSendTargetSession({
      activeSessionId: "missing-session",
      createSessionId: () => "created-session",
      historyLoadingIds: {},
      missingOnServerIds: { "missing-session": true },
    })).toEqual({ kind: "ready", sessionId: "created-session", shouldCreateSession: true });
  });

  it("reuses the active session when it is ready", () => {
    expect(resolveSendTargetSession({
      activeSessionId: "session-a",
      createSessionId: () => "created-session",
      historyLoadingIds: {},
      missingOnServerIds: {},
    })).toEqual({ kind: "ready", sessionId: "session-a", shouldCreateSession: false });
  });
});
