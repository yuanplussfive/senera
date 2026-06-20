import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventKinds, type EventEnvelope, type SessionListItem } from "../api/eventTypes";
import { sessionPersistOptions } from "./session/persistence";
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
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    motionLevel: "full",
    viewedRunIdBySession: {},
    historyLoadedIds: {},
    historyLoadingIds: {},
    historyFailedIds: {},
    historyReplayBuffers: {},
    historyStepBuffers: {},
    historyEventRunIds: {},
    missingOnServerIds: {},
    pendingCreatedSessionIds: {},
    pendingDeletedSessionIds: {},
    modelProviders: [],
    selectedModelProviderId: null,
    pluginConfigs: [],
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

function timedEnvelope<TKind extends string, TData>(
  kind: TKind,
  timestamp: string,
  data: TData,
  sessionId?: string,
  requestId?: string,
  step?: number,
): EventEnvelope<TKind, TData> {
  return {
    ...envelope(kind, data, sessionId, requestId),
    timestamp,
    step,
  };
}

describe("sessionStore history recovery", () => {
  beforeEach(() => {
    resetStore();
  });

  it("projects scoped child-agent events into the parent run without touching parent streamed text", () => {
    useStore.getState().ingest(timedEnvelope(
      EventKinds.RunStarted,
      "2026-05-29T08:00:00.000Z",
      { input: "请用子代理并行审查当前 PR" },
      "session-1",
      "parent-run",
    ));

    const scopedModelStarted = timedEnvelope(
      EventKinds.ModelStarted,
      "2026-05-29T08:00:01.000Z",
      { model: "review-model" },
      "session-1",
      "child-job-1",
      1,
    );
    scopedModelStarted.scope = {
      parentRequestId: "parent-run",
      workflowName: "ParallelPullRequestReview",
      jobId: "child-job-1",
      agentName: "SecurityReviewer",
      role: "childAgent",
    };
    useStore.getState().ingest(scopedModelStarted);

    const scopedDelta = timedEnvelope(
      EventKinds.ModelDelta,
      "2026-05-29T08:00:02.000Z",
      { text: "child-only-token" },
      "session-1",
      "child-job-1",
      1,
    );
    scopedDelta.scope = scopedModelStarted.scope;
    useStore.getState().ingest(scopedDelta);

    const run = useStore.getState().sessions["session-1"]?.runs.find((item) => item.requestId === "parent-run");
    expect(run?.streamingRaw).toBe("");
    expect(run?.displayText).toBe("");
    expect(run?.steps.some((step) =>
      step.scope?.jobId === "child-job-1" &&
      step.scope?.agentName === "SecurityReviewer" &&
      step.kind === "model" &&
      step.status === "running")).toBe(true);
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

  it("drops partial chunked history when the history load fails", () => {
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
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-1:user",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "你好",
            },
          },
        ],
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

  it("buffers chunked history events and atomically materializes them on completion", () => {
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
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-1:user",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "你好",
            },
          },
        ],
      },
      "history-session",
    ));
    expect(useStore.getState().sessions["history-session"].messages).toEqual([]);

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-1:assistant",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:02.000Z",
              kind: "assistant.decision",
              xml: "<final_answer>你好呀</final_answer>",
            },
            visible: { kind: "final_answer", text: "你好呀" },
          },
        ],
      },
      "history-session",
    ));
    expect(useStore.getState().sessions["history-session"].messages).toEqual([]);

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

  it("appends chunked history into the replay buffer without cloning previous chunks", () => {
    const concatSpy = vi.spyOn(Array.prototype, "concat");
    try {
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
        EventKinds.SessionHistoryChunk,
        {
          sessionId: "history-session",
          entries: [
            {
              entry: {
                id: "req-1:user",
                requestId: "req-1",
                timestamp: "2026-05-29T08:00:00.000Z",
                kind: "user.message",
                content: "你好",
              },
            },
          ],
        },
        "history-session",
      ));
      useStore.getState().ingest(envelope(
        EventKinds.SessionHistoryEntry,
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

      expect(useStore.getState().historyReplayBuffers["history-session"]).toHaveLength(2);
      expect(concatSpy).not.toHaveBeenCalled();
    } finally {
      concatSpy.mockRestore();
    }
  });

  it("rebuilds persisted run history while materializing chat history", () => {
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
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-1:user",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "查天气",
            },
          },
          {
            entry: {
              id: "req-1:assistant",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:03.000Z",
              kind: "assistant.decision",
              xml: "<final_answer>有雨</final_answer>",
            },
            visible: { kind: "final_answer", text: "有雨" },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: "history-session",
        events: [
          timedEnvelope(
            EventKinds.RunStarted,
            "2026-05-29T08:00:00.000Z",
            { input: "查天气" },
            "history-session",
            "req-1",
          ),
          timedEnvelope(
            EventKinds.ActionPlannerStageStarted,
            "2026-05-29T08:00:01.000Z",
            { stage: "buildTaskFrame" },
            "history-session",
            "req-1",
            1,
          ),
          timedEnvelope(
            EventKinds.ActionPlannerStageCompleted,
            "2026-05-29T08:00:01.250Z",
            { stage: "buildTaskFrame" },
            "history-session",
            "req-1",
            1,
          ),
          timedEnvelope(
            EventKinds.ToolCallStarted,
            "2026-05-29T08:00:01.500Z",
            { index: 1, toolName: "WeatherTool", callId: "call-1" },
            "history-session",
            "req-1",
            1,
          ),
          timedEnvelope(
            EventKinds.ToolCallCompleted,
            "2026-05-29T08:00:02.000Z",
            { index: 1, toolName: "WeatherTool", callId: "call-1", preview: "Rain" },
            "history-session",
            "req-1",
            1,
          ),
          timedEnvelope(
            EventKinds.FinalAnswer,
            "2026-05-29T08:00:03.000Z",
            { content: "有雨" },
            "history-session",
            "req-1",
          ),
          timedEnvelope(
            EventKinds.RunCompleted,
            "2026-05-29T08:00:03.010Z",
            {},
            "history-session",
            "req-1",
          ),
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(session.messages.map((message) => message.content)).toEqual(["查天气", "有雨"]);
    expect(session.runs).toHaveLength(1);
    expect(session.runs[0].status).toBe("completed");
    expect(session.runs[0].steps.map((step) => step.title)).toEqual([
      "理解用户问题",
      "构建任务合约",
      "调用 WeatherTool",
      "生成回复",
    ]);
    expect(session.runs[0].steps[1]).toMatchObject({
      startedAt: "2026-05-29T08:00:01.000Z",
      endedAt: "2026-05-29T08:00:01.250Z",
    });
    expect(session.runs[0].steps.find((step) => step.callId === "call-1")?.toolBatch).toEqual({
      id: "req-1:1",
      index: 1,
      size: undefined,
    });
    expect(session.runs[0]).toMatchObject({
      visibleText: "有雨",
      displayText: "有雨",
    });
  });

  it("rebuilds compact tool traces with stable execution batch metadata", () => {
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
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-compact:user",
              requestId: "req-compact",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "查两类信息",
            },
          },
          {
            entry: {
              id: "req-compact:assistant",
              requestId: "req-compact",
              timestamp: "2026-05-29T08:00:04.000Z",
              kind: "assistant.decision",
              xml: "<final_answer>查完了</final_answer>",
            },
            visible: { kind: "final_answer", text: "查完了" },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistorySteps,
      {
        sessionId: "history-session",
        runs: [
          {
            requestId: "req-compact",
            input: "查两类信息",
            startedAt: "2026-05-29T08:00:00.000Z",
            endedAt: "2026-05-29T08:00:04.000Z",
            status: "completed",
            traces: [
              {
                step: 2,
                seq: 0,
                kind: "tool",
                toolName: "SearchTool",
                callId: "search-call",
                status: "done",
              },
              {
                step: 2,
                seq: 1,
                kind: "tool",
                toolName: "WeatherTool",
                callId: "weather-call",
                status: "done",
              },
            ],
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    ));

    const toolSteps = useStore.getState().sessions["history-session"]?.runs[0]?.steps
      .filter((step) => step.kind === "tool");

    expect(toolSteps?.map((step) => step.toolBatch)).toEqual([
      { id: "req-compact:2", index: 0 },
      { id: "req-compact:2", index: 1 },
    ]);
  });

  it("materializes replayed ask-user text without re-entering the typewriter queue", () => {
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
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-ask:user",
              requestId: "req-ask",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "帮我查一个东西",
            },
          },
          {
            entry: {
              id: "req-ask:assistant",
              requestId: "req-ask",
              timestamp: "2026-05-29T08:00:02.000Z",
              kind: "assistant.decision",
              xml: "<ask_user>请补充查询目标</ask_user>",
            },
            visible: { kind: "ask_user", text: "请补充查询目标" },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: "history-session",
        events: [
          timedEnvelope(
            EventKinds.RunStarted,
            "2026-05-29T08:00:00.000Z",
            { input: "帮我查一个东西" },
            "history-session",
            "req-ask",
          ),
          timedEnvelope(
            EventKinds.AskUser,
            "2026-05-29T08:00:02.000Z",
            { question: "请补充查询目标" },
            "history-session",
            "req-ask",
          ),
          timedEnvelope(
            EventKinds.RunCompleted,
            "2026-05-29T08:00:02.010Z",
            {},
            "history-session",
            "req-ask",
          ),
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    ));

    const run = useStore.getState().sessions["history-session"]?.runs[0];

    expect(run).toMatchObject({
      visibleText: "请补充查询目标",
      displayText: "请补充查询目标",
    });
  });

  it("keeps full persisted run events instead of replacing them with compact step traces", () => {
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
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-rich:user",
              requestId: "req-rich",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "并行审查",
            },
          },
          {
            entry: {
              id: "req-rich:assistant",
              requestId: "req-rich",
              timestamp: "2026-05-29T08:00:04.000Z",
              kind: "assistant.decision",
              xml: "<final_answer>完成</final_answer>",
            },
            visible: { kind: "final_answer", text: "完成" },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistorySteps,
      {
        sessionId: "history-session",
        runs: [
          {
            requestId: "req-rich",
            input: "并行审查",
            startedAt: "2026-05-29T08:00:00.000Z",
            endedAt: "2026-05-29T08:00:04.000Z",
            status: "completed",
            traces: [
              {
                step: 1,
                seq: 0,
                kind: "tool",
                toolName: "AgentDelegateTool",
                callId: "delegate",
                status: "done",
              },
            ],
          },
        ],
      },
      "history-session",
    ));
    const childStarted = timedEnvelope(
      EventKinds.ModelStarted,
      "2026-05-29T08:00:02.000Z",
      { model: "review-model" },
      "history-session",
      "job-a",
      1,
    );
    childStarted.scope = {
      parentRequestId: "req-rich",
      workflowName: "ReviewWorkflow",
      jobId: "job-a",
      agentName: "SecurityReviewer",
      role: "childAgent",
    };
    useStore.getState().ingest(envelope(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: "history-session",
        events: [
          timedEnvelope(
            EventKinds.RunStarted,
            "2026-05-29T08:00:00.000Z",
            { input: "并行审查" },
            "history-session",
            "req-rich",
          ),
          timedEnvelope(
            EventKinds.ToolCallStarted,
            "2026-05-29T08:00:01.000Z",
            { index: 1, toolName: "AgentDelegateTool", callId: "delegate" },
            "history-session",
            "req-rich",
            1,
          ),
          timedEnvelope(
            EventKinds.ToolCallCompleted,
            "2026-05-29T08:00:01.500Z",
            { index: 1, toolName: "AgentDelegateTool", callId: "delegate", preview: "planned" },
            "history-session",
            "req-rich",
            1,
          ),
          childStarted,
          timedEnvelope(
            EventKinds.FinalAnswer,
            "2026-05-29T08:00:04.000Z",
            { content: "完成" },
            "history-session",
            "req-rich",
          ),
          timedEnvelope(
            EventKinds.RunCompleted,
            "2026-05-29T08:00:04.010Z",
            {},
            "history-session",
            "req-rich",
          ),
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    ));

    const run = useStore.getState().sessions["history-session"]?.runs[0];
    expect(run?.steps.some((step) => step.scope?.agentName === "SecurityReviewer")).toBe(true);
    expect(run?.steps.map((step) => step.id)).toContain("req-rich-answer");
    expect(run?.steps).toHaveLength(4);
  });

  it("does not treat replayed failed run events as history load failures", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 1,
          messageCount: 1,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: "history-session",
        totalEntries: 1,
        messageCount: 1,
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-failed:user",
              requestId: "req-failed",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "触发失败",
            },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistorySteps,
      {
        sessionId: "history-session",
        runs: [
          {
            requestId: "req-failed",
            input: "触发失败",
            startedAt: "2026-05-29T08:00:00.000Z",
            endedAt: "2026-05-29T08:00:02.000Z",
            status: "failed",
            traces: [
              {
                step: 0,
                seq: 0,
                kind: "answer",
                status: "failed",
                startedAt: "2026-05-29T08:00:00.000Z",
                endedAt: "2026-05-29T08:00:02.000Z",
                title: "回复数据丢失",
                errorMessage: "model failed",
              },
            ],
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: "history-session",
        events: [
          timedEnvelope(
            EventKinds.RunFailed,
            "2026-05-29T08:00:02.000Z",
            { message: "model failed" },
            "history-session",
            "req-failed",
          ),
        ],
      },
      "history-session",
    ));

    expect(useStore.getState().historyLoadingIds["history-session"]).toBe(true);
    expect(useStore.getState().historyFailedIds["history-session"]).toBeUndefined();

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(useStore.getState().historyLoadingIds["history-session"]).toBe(false);
    expect(useStore.getState().historyLoadedIds["history-session"]).toBe(true);
    expect(useStore.getState().historyFailedIds["history-session"]).toBeUndefined();
    expect(session.messages.map((message) => message.content)).toEqual(["触发失败"]);
    expect(session.messageCount).toBe(1);
    expect(session.runs).toHaveLength(1);
    expect(session.runs[0]).toMatchObject({
      requestId: "req-failed",
      status: "failed",
      recoverySource: undefined,
    });
    expect(session.runs[0].steps[0]).toMatchObject({
      title: "回复数据丢失",
      status: "failed",
    });
  });

  it("keeps materialized history when completion is received more than once", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 1,
          messageCount: 1,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: "history-session",
        totalEntries: 1,
        messageCount: 1,
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-1:user",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "你好",
            },
          },
        ],
      },
      "history-session",
    ));
    const completed = envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    );

    useStore.getState().ingest(completed);
    useStore.getState().ingest(completed);

    const session = useStore.getState().sessions["history-session"];
    expect(session.messages.map((message) => message.content)).toEqual(["你好"]);
    expect(session.messageCount).toBe(1);
  });

  it("keeps accepting legacy streamed history entries", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 1,
          messageCount: 1,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: "history-session",
        totalEntries: 1,
        messageCount: 1,
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
          content: "旧 entry 仍可恢复",
        },
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(session.messages.map((message) => message.content)).toEqual(["旧 entry 仍可恢复"]);
    expect(session.messageCount).toBe(1);
  });

  it("drops buffered chunked history when the history load fails", () => {
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
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-1:user",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "你好",
            },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.RunFailed,
      { message: "history projection failed after one chunk" },
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

  it("rebuilds running runs from history snapshots", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 1,
          messageCount: 1,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: "history-session",
        totalEntries: 1,
        messageCount: 1,
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-running:user",
              requestId: "req-running",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "长回复",
            },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistorySteps,
      {
        sessionId: "history-session",
        runs: [
          {
            requestId: "req-running",
            input: "长回复",
            startedAt: "2026-05-29T08:00:00.000Z",
            status: "running",
            traces: [],
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(session.messages.map((message) => message.content)).toEqual(["长回复"]);
    expect(session.runs[0]).toMatchObject({
      requestId: "req-running",
      status: "running",
      recoverySource: "history",
    });
  });

  it("merges refresh history without duplicating recovered runs or messages", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 1,
          messageCount: 1,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: "history-session",
        totalEntries: 1,
        messageCount: 1,
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-1:user",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "长回复",
            },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistorySteps,
      {
        sessionId: "history-session",
        runs: [
          {
            requestId: "req-1",
            input: "长回复",
            startedAt: "2026-05-29T08:00:00.000Z",
            status: "running",
            traces: [],
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    ));

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: "history-session",
        totalEntries: 2,
        messageCount: 2,
        refresh: true,
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-1:user",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "长回复",
            },
          },
          {
            entry: {
              id: "req-1:assistant",
              requestId: "req-1",
              timestamp: "2026-05-29T08:00:05.000Z",
              kind: "assistant.decision",
              xml: "<final_answer>完成了</final_answer>",
            },
            visible: { kind: "final_answer", text: "完成了" },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistorySteps,
      {
        sessionId: "history-session",
        runs: [
          {
            requestId: "req-1",
            input: "长回复",
            startedAt: "2026-05-29T08:00:00.000Z",
            endedAt: "2026-05-29T08:00:05.000Z",
            status: "completed",
            traces: [
              {
                step: 1,
                seq: 0,
                kind: "answer",
                status: "done",
                startedAt: "2026-05-29T08:00:00.000Z",
                endedAt: "2026-05-29T08:00:05.000Z",
              },
            ],
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session", refresh: true },
      "history-session",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(session.messages.map((message) => message.content)).toEqual(["长回复", "完成了"]);
    expect(session.runs).toHaveLength(1);
    expect(session.runs[0]).toMatchObject({
      requestId: "req-1",
      status: "completed",
      recoverySource: undefined,
    });
  });

  it("does not append replayed failed run events during refresh recovery", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [
        sessionItem({
          sessionId: "history-session",
          entryCount: 1,
          messageCount: 1,
        }),
      ],
    }));
    useStore.getState().markHistoryLoading("history-session");

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: "history-session",
        totalEntries: 1,
        messageCount: 1,
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-failed:user",
              requestId: "req-failed",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "触发失败",
            },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistorySteps,
      {
        sessionId: "history-session",
        runs: [
          {
            requestId: "req-failed",
            input: "触发失败",
            startedAt: "2026-05-29T08:00:00.000Z",
            status: "running",
            traces: [],
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session" },
      "history-session",
    ));

    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: "history-session",
        totalEntries: 1,
        messageCount: 1,
        refresh: true,
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: "history-session",
        entries: [
          {
            entry: {
              id: "req-failed:user",
              requestId: "req-failed",
              timestamp: "2026-05-29T08:00:00.000Z",
              kind: "user.message",
              content: "触发失败",
            },
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistorySteps,
      {
        sessionId: "history-session",
        runs: [
          {
            requestId: "req-failed",
            input: "触发失败",
            startedAt: "2026-05-29T08:00:00.000Z",
            endedAt: "2026-05-29T08:00:02.000Z",
            status: "failed",
            traces: [
              {
                step: 0,
                seq: 0,
                kind: "answer",
                status: "failed",
                startedAt: "2026-05-29T08:00:00.000Z",
                endedAt: "2026-05-29T08:00:02.000Z",
                title: "回复数据丢失",
                errorMessage: "model failed",
              },
            ],
          },
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: "history-session",
        events: [
          timedEnvelope(
            EventKinds.RunFailed,
            "2026-05-29T08:00:02.000Z",
            { message: "model failed" },
            "history-session",
            "req-failed",
          ),
        ],
      },
      "history-session",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.SessionHistoryCompleted,
      { sessionId: "history-session", refresh: true },
      "history-session",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(session.messages.map((message) => message.content)).toEqual(["触发失败"]);
    expect(session.runs).toHaveLength(1);
    expect(session.runs[0]).toMatchObject({
      requestId: "req-failed",
      status: "failed",
      recoverySource: undefined,
    });
  });

  it("replaces existing assistant final answers for the same request", () => {
    useStore.getState().ingest(envelope(EventKinds.SessionListSnapshot, {
      sessions: [sessionItem({ sessionId: "history-session" })],
    }));
    useStore.getState().appendUserMessage("history-session", "req-1", "说一句");

    useStore.getState().ingest(envelope(
      EventKinds.FinalAnswer,
      { content: "第一版" },
      "history-session",
      "req-1",
    ));
    useStore.getState().ingest(envelope(
      EventKinds.FinalAnswer,
      { content: "第二版" },
      "history-session",
      "req-1",
    ));

    const session = useStore.getState().sessions["history-session"];
    expect(session.messages.map((message) => message.content)).toEqual(["说一句", "第二版"]);
  });
});

describe("sessionStore streaming display", () => {
  beforeEach(() => {
    resetStore();
  });

  it("keeps raw stream exact while display text advances separately", () => {
    const sessionId = "stream-session";
    const requestId = "req-stream";
    useStore.getState().registerCreatingSession(sessionId, "流式测试");
    useStore.getState().appendUserMessage(sessionId, requestId, "写一段话");

    useStore.getState().ingest(envelope(
      EventKinds.ModelStarted,
      { model: "test-model" },
      sessionId,
      requestId,
    ));
    useStore.getState().ingest(envelope(
      EventKinds.ModelDelta,
      { text: "abcdef" },
      sessionId,
      requestId,
    ));

    let run = useStore.getState().sessions[sessionId].runs[0];
    expect(run.streamingRaw).toBe("abcdef");
    expect(run.visibleText).toBe("abcdef");
    expect(run.displayText).toBe("");

    const pending = useStore.getState().advanceStreamingDisplay(sessionId, requestId);

    run = useStore.getState().sessions[sessionId].runs[0];
    expect(pending).toBe(true);
    expect(run.streamingRaw).toBe("abcdef");
    expect(run.visibleText).toBe("abcdef");
    expect(run.displayText.length).toBeGreaterThan(0);
    expect(run.displayText.length).toBeLessThan(run.visibleText.length);
  });

  it("keeps final answer as display target instead of clearing runtime text", () => {
    const sessionId = "final-session";
    const requestId = "req-final";
    useStore.getState().registerCreatingSession(sessionId, "最终回复测试");
    useStore.getState().appendUserMessage(sessionId, requestId, "继续");
    useStore.getState().ingest(envelope(
      EventKinds.ModelStarted,
      { model: "test-model" },
      sessionId,
      requestId,
    ));
    useStore.getState().ingest(envelope(
      EventKinds.ModelDelta,
      { text: "Hello " },
      sessionId,
      requestId,
    ));
    useStore.getState().advanceStreamingDisplay(sessionId, requestId);

    useStore.getState().ingest(envelope(
      EventKinds.FinalAnswer,
      { content: "Hello world" },
      sessionId,
      requestId,
    ));

    const run = useStore.getState().sessions[sessionId].runs[0];
    expect(run.streamingRaw).toBe("Hello ");
    expect(run.visibleText).toBe("Hello world");
    expect(run.displayText).toBe("He");
    expect(useStore.getState().sessions[sessionId].messages.at(-1)?.content).toBe("Hello world");
  });

  it("syncs display text in one step when motion is disabled", () => {
    const sessionId = "no-motion-session";
    const requestId = "req-no-motion";
    useStore.getState().registerCreatingSession(sessionId, "关闭动效测试");
    useStore.getState().setMotionLevel("none");
    useStore.getState().appendUserMessage(sessionId, requestId, "直接显示");
    useStore.getState().ingest(envelope(
      EventKinds.ModelDelta,
      { text: "完整文本" },
      sessionId,
      requestId,
    ));

    const pending = useStore.getState().advanceStreamingDisplay(sessionId, requestId);
    const run = useStore.getState().sessions[sessionId].runs[0];
    expect(pending).toBe(false);
    expect(run.displayText).toBe("完整文本");
  });
});

describe("session persistence migration", () => {
  it("returns only persisted UI preferences when migrating legacy state", () => {
    const migrate = sessionPersistOptions.migrate;
    expect(migrate).toBeDefined();

    const migrated = migrate?.({
      sidebarCollapsed: true,
      rightPanelCollapsed: true,
      motionLevel: "none",
      selectedModelProviderId: "provider-1",
      userProfile: {
        name: "Ada",
        avatarDataUrl: null,
        updatedAt: "2026-05-29T08:00:00.000Z",
      },
      activeSessionId: "legacy-active",
      sessions: { "legacy-active": {} },
      sessionOrder: ["legacy-active"],
      viewedRunIdBySession: { "legacy-active": "req-1" },
      modelProviders: [{ id: "provider-1" }],
      historyLoadingIds: { "legacy-active": true },
    }, 1);

    expect(migrated).toEqual({
      sidebarCollapsed: true,
      rightPanelCollapsed: true,
      motionLevel: "full",
      selectedModelProviderId: "provider-1",
      userProfile: {
        name: "Ada",
        avatarDataUrl: null,
        updatedAt: "2026-05-29T08:00:00.000Z",
      },
    });
  });

  it("keeps persisted motion level when migrating current preferences", () => {
    const migrate = sessionPersistOptions.migrate;
    expect(migrate).toBeDefined();

    const migrated = migrate?.({
      sidebarCollapsed: false,
      rightPanelCollapsed: true,
      motionLevel: "reduced",
      selectedModelProviderId: null,
      userProfile: DEFAULT_USER_PROFILE,
      sessions: { discarded: {} },
    }, 4);

    expect(migrated).toMatchObject({
      sidebarCollapsed: false,
      rightPanelCollapsed: true,
      motionLevel: "reduced",
    });
  });

  it("falls back to full motion when persisted motion level is invalid", () => {
    const migrate = sessionPersistOptions.migrate;
    expect(migrate).toBeDefined();

    const migrated = migrate?.({
      motionLevel: "cinematic",
    }, 4);

    expect(migrated).toMatchObject({
      motionLevel: "full",
    });
  });
});

describe("sessionStore planner timeline", () => {
  beforeEach(() => {
    resetStore();
  });

  it("projects action planning as two measured stages", () => {
    const sessionId = "planner-session";
    const requestId = "planner-request";
    useStore.getState().registerCreatingSession(sessionId, "规划测试");

    useStore.getState().ingest(timedEnvelope(
      EventKinds.RunStarted,
      "2026-05-29T08:00:00.000Z",
      { input: "查明天上海天气" },
      sessionId,
      requestId,
    ));
    useStore.getState().ingest(timedEnvelope(
      EventKinds.ActionPlannerStageStarted,
      "2026-05-29T08:00:01.000Z",
      { stage: "buildTaskFrame" },
      sessionId,
      requestId,
      1,
    ));
    useStore.getState().ingest(timedEnvelope(
      EventKinds.ActionPlannerStageCompleted,
      "2026-05-29T08:00:01.250Z",
      { stage: "buildTaskFrame", repaired: false },
      sessionId,
      requestId,
      1,
    ));
    useStore.getState().ingest(timedEnvelope(
      EventKinds.ActionPlannerStageStarted,
      "2026-05-29T08:00:01.300Z",
      { stage: "evaluateEvidence" },
      sessionId,
      requestId,
      1,
    ));
    useStore.getState().ingest(timedEnvelope(
      EventKinds.ActionPlannerStageCompleted,
      "2026-05-29T08:00:01.700Z",
      { stage: "evaluateEvidence", selectedAction: "use_tools" },
      sessionId,
      requestId,
      1,
    ));
    useStore.getState().ingest(timedEnvelope(
      EventKinds.ActionPlanned,
      "2026-05-29T08:00:01.720Z",
      {
        status: "planned",
        action: "use_tools",
        expectedOutputMode: "tool_call_xml",
        preferredTools: ["WeatherTool"],
        toolSearchQueries: [],
        loadedTools: ["WeatherTool"],
      },
      sessionId,
      requestId,
      1,
    ));

    const run = useStore.getState().sessions[sessionId]?.runs[0];
    expect(run?.steps.map((step) => step.title)).toEqual([
      "理解用户问题",
      "构建任务合约",
      "判断完成状态",
    ]);
    expect(run?.steps[1]).toMatchObject({
      status: "done",
      startedAt: "2026-05-29T08:00:01.000Z",
      endedAt: "2026-05-29T08:00:01.250Z",
    });
    expect(run?.steps[2]).toMatchObject({
      status: "done",
      startedAt: "2026-05-29T08:00:01.300Z",
      endedAt: "2026-05-29T08:00:01.700Z",
      decisionKind: "use_tools",
    });
    expect(run?.steps.filter((step) => step.title.startsWith("规划行动"))).toHaveLength(0);
  });
});
