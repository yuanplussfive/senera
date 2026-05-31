import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventKinds, type EventEnvelope, type SessionListItem } from "../api/eventTypes";
import { DEFAULT_USER_PROFILE, useStore } from "./sessionStore";

const localStorageStub = vi.hoisted(() => {
  const items = new Map<string, string>();
  const stub = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => {
      items.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: stub,
    configurable: true,
  });
  return stub;
});

function resetStore(): void {
  localStorageStub.clear();
  useStore.setState({
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
    viewedRunIdBySession: {},
    historyLoadedIds: {},
    historyLoadingIds: {},
    historyFailedIds: {},
    missingOnServerIds: {},
    pendingCreatedSessionIds: {},
    pendingDeletedSessionIds: {},
    modelProviders: [],
    selectedModelProviderId: null,
    userProfile: DEFAULT_USER_PROFILE,
  });
}

function sessionItem(input: Partial<SessionListItem> & { sessionId: string }): SessionListItem {
  return {
    title: "新对话",
    status: "idle",
    createdAt: "2026-05-29T08:00:00.000Z",
    updatedAt: "2026-05-29T08:00:00.000Z",
    entryCount: 0,
    messageCount: 0,
    ...input,
  };
}

function envelope<TKind extends string, TData>(
  kind: TKind,
  data: TData,
  sessionId?: string,
  requestId?: string,
): EventEnvelope<TKind, TData> {
  return {
    channel: "agent.event",
    kind,
    layer: "snapshot",
    phase: "session",
    sequence: 1,
    timestamp: "2026-05-29T08:00:00.000Z",
    sessionId,
    requestId,
    data,
  };
}

describe("sessionStore history recovery", () => {
  beforeEach(() => {
    resetStore();
  });

  it("opens the latest session with messages when a refreshed list starts with an empty session", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "empty-latest",
          updatedAt: "2026-05-29T08:58:12.389Z",
        }),
        sessionItem({
          sessionId: "history-session",
          title: "你好，你知道自己寄生于什么里吗",
          updatedAt: "2026-05-29T08:57:41.382Z",
          entryCount: 10,
          messageCount: 10,
        }),
      ],
    }));

    expect(useStore.getState().activeSessionId).toBe("history-session");
  });

  it("clears a failed history load without injecting a chat error message", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 2,
          messageCount: 2,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.RunFailed,
      { message: "history projection failed" },
      "history-session",
      "server-generated-request-id",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(useStore.getState().historyLoadingIds["history-session"]).toBe(false);
    expect(useStore.getState().historyLoadedIds["history-session"]).toBeUndefined();
    expect(useStore.getState().historyFailedIds["history-session"]).toBe(true);
    expect(session.messages).toEqual([]);
    expect(session.messageCount).toBe(2);
  });

  it("drops partial streamed history when the history load fails", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 2,
          messageCount: 2,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: "history-session",
        totalEntries: 2,
        messageCount: 2,
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryEntry,
      {
        sessionId: "history-session",
        entry: {
          id: "req-1:user",
          requestId: "req-1",
          timestamp: "2026-05-29T08:00:00.000Z",
          kind: "user.message",
          content: "你好",
        },
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.RunFailed,
      { message: "history projection failed after one entry" },
      "history-session",
      "server-generated-request-id",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(useStore.getState().historyLoadingIds["history-session"]).toBe(false);
    expect(useStore.getState().historyLoadedIds["history-session"]).toBeUndefined();
    expect(useStore.getState().historyFailedIds["history-session"]).toBe(true);
    expect(session.messages).toEqual([]);
    expect(session.runs).toEqual([]);
    expect(session.messageCount).toBe(2);
  });

  it("clears failed history state when retrying a history load", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 2,
          messageCount: 2,
        }),
      ],
    }));
    useStore.getState().markHistoryLoadFailed("history-session");

    useStore.getState().markHistoryLoading("history-session");

    expect(useStore.getState().historyLoadingIds["history-session"]).toBe(true);
    expect(useStore.getState().historyFailedIds["history-session"]).toBeUndefined();
  });

  it("marks missing history sessions and moves active selection to an existing fallback", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "missing-session",
          updatedAt: "2026-05-29T08:58:12.389Z",
          entryCount: 2,
          messageCount: 2,
        }),
        sessionItem({
          sessionId: "fallback-session",
          updatedAt: "2026-05-29T08:57:41.382Z",
          entryCount: 2,
          messageCount: 2,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("missing-session");

    useStore.getState().ingest(envelope(
      EventKinds.SessionNotFound,
      {
        sessionId: "missing-session",
        operation: "session.history",
        message: "会话不存在。",
      },
      "missing-session",
    ));

    const state = useStore.getState();
    expect(state.historyLoadingIds["missing-session"]).toBe(false);
    expect(state.missingOnServerIds["missing-session"]).toBe(true);
    expect(state.activeSessionId).toBe("fallback-session");
    expect(state.sessions["missing-session"].messages).toEqual([]);
    expect(state.sessions["missing-session"].messageCount).toBe(0);
  });

  it("does not append local user messages while history is loading", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 2,
          messageCount: 2,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().appendUserMessage("history-session", "req-new", "先追问一句");

    const session = useStore.getState().sessions["history-session"];
    expect(session.messages).toEqual([]);
    expect(session.runs).toEqual([]);
    expect(session.activeRequestId).toBeUndefined();
    expect(session.messageCount).toBe(2);
  });

  it("keeps real run failures distinct while history is still loading", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 2,
          messageCount: 2,
        }),
      ],
    }));
    useStore.getState().appendUserMessage("history-session", "req-1", "继续这个话题");
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.RunFailed,
      { message: "model failed" },
      "history-session",
      "req-1",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(useStore.getState().historyLoadingIds["history-session"]).toBe(true);
    expect(useStore.getState().historyFailedIds["history-session"]).toBeUndefined();
    expect(session.runs[0].status).toBe("failed");
    expect(session.messages.at(-1)?.kind).toBe("Error");
  });

  it("materializes streamed history events and marks the session loaded on completion", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 2,
          messageCount: 2,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      "session.history.started",
      {
        sessionId: "history-session",
        totalEntries: 2,
        messageCount: 2,
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      "session.history.entry",
      {
        sessionId: "history-session",
        entry: {
          id: "req-1:user",
          requestId: "req-1",
          timestamp: "2026-05-29T08:00:00.000Z",
          kind: "user.message",
          content: "你好",
        },
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      "session.history.entry",
      {
        sessionId: "history-session",
        entry: {
          id: "req-1:assistant",
          requestId: "req-1",
          timestamp: "2026-05-29T08:00:02.000Z",
          kind: "assistant.decision",
          xml: "<final_answer>你好呀</final_answer>",
        },
        visible: { kind: "final_answer", text: "你好呀" },
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      "session.history.completed",
      { sessionId: "history-session" },
      "history-session",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(useStore.getState().historyLoadingIds["history-session"]).toBe(false);
    expect(useStore.getState().historyLoadedIds["history-session"]).toBe(true);
    expect(session.messages.map((message) => message.content)).toEqual(["你好", "你好呀"]);
    expect(session.messageCount).toBe(2);
  });

  it("still accepts legacy history snapshots", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 2,
          messageCount: 2,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistorySnapshot,
      {
        sessionId: "history-session",
        totalEntries: 2,
        messageCount: 2,
        entries: [
          {
            entry: {
              id: "req-1:user",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "旧协议还在吗",
            },
          },
          {
            entry: {
              id: "req-1:assistant",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:02.000Z",
              kind: "assistant.decision",
              xml: "<final_answer>还在</final_answer>",
            },
            visible: { kind: "final_answer", text: "还在" },
          },
        ],
      },
      "history-session",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(useStore.getState().historyLoadingIds["history-session"]).toBe(false);
    expect(useStore.getState().historyLoadedIds["history-session"]).toBe(true);
    expect(session.messages.map((message) => message.content)).toEqual(["旧协议还在吗", "还在"]);
  });
});
