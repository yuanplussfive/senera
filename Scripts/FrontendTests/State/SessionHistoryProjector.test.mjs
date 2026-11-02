import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { projectEntryToMessage } from "../../../Frontend/src/store/session/historyRunProjection.ts";
import { readRunInputLabel } from "../../../Frontend/src/store/session/runInputLabel.ts";
import {
  createEvent,
  createTestState,
  TestRequestId,
  TestSessionId,
  TestTimestamp,
} from "./sessionProjectorTestUtils.mjs";

test.each(["completed", "failed", "cancelled"])(
  "history thinking survives refresh without reviving a %s run",
  (status) => {
    const state = createTestState();
    const thinking = [0, 1].map((contentIndex) =>
      createEvent(
        EventKinds.ModelThinkingCompleted,
        {
          messageIndex: 0,
          contentIndex,
          content: `思考内容 ${contentIndex}`,
          status: contentIndex === 0 ? "complete" : "interrupted",
        },
        { step: 1, sequence: contentIndex + 1 },
      ),
    );
    for (let refresh = 0; refresh < 2; refresh += 1) {
      applyEvent(state, createEvent(EventKinds.SessionHistoryStarted, { sessionId: TestSessionId, totalEntries: 0 }));
      applyEvent(
        state,
        createEvent(EventKinds.SessionHistorySteps, {
          sessionId: TestSessionId,
          runs: [
            {
              requestId: TestRequestId,
              input: "检查",
              startedAt: TestTimestamp,
              status,
              traces: [{ step: 1, seq: 0, kind: "tool", status: "done", toolName: "WorkspaceRead" }],
            },
          ],
        }),
      );
      applyEvent(state, createEvent(EventKinds.SessionRunHistoryChunk, { sessionId: TestSessionId, events: thinking }));
      applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }));
      const session = state.sessions[TestSessionId];
      expect(session.activeRequestId).toBeUndefined();
      expect(session.runs).toHaveLength(1);
      expect(session.runs[0].status).toBe(status);
      expect(session.runs[0].thinkingBlocks.map(({ content, status }) => ({ content, status }))).toEqual([
        { content: "思考内容 0", status: "complete" },
        { content: "思考内容 1", status: "interrupted" },
      ]);
      expect(session.runs[0].steps.filter((step) => step.kind === "tool")).toHaveLength(1);
    }
    applyEvent(
      state,
      createEvent(EventKinds.SessionRunHistoryDetail, {
        sessionId: TestSessionId,
        requestId: TestRequestId,
        events: thinking,
        complete: true,
      }),
    );
    expect(state.sessions[TestSessionId].runs[0].thinkingBlocks).toHaveLength(2);
  },
);

test("refresh combines earlier durable thinking with the current live thinking block", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "继续检查" }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ModelThinkingDelta,
      {
        messageIndex: 1,
        contentIndex: 0,
        delta: "正在检查",
      },
      { step: 1, sequence: 10 },
    ),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryStarted, { sessionId: TestSessionId, totalEntries: 0, refresh: true }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistorySteps, {
      sessionId: TestSessionId,
      runs: [{ requestId: TestRequestId, input: "继续检查", startedAt: TestTimestamp, status: "running", traces: [] }],
    }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionRunHistoryChunk, {
      sessionId: TestSessionId,
      events: [
        createEvent(
          EventKinds.ModelThinkingCompleted,
          {
            messageIndex: 0,
            contentIndex: 0,
            content: "上一阶段的思考",
            status: "complete",
          },
          { step: 1, sequence: 2 },
        ),
      ],
    }),
  );
  applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId, refresh: true }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ModelThinkingDelta,
      {
        messageIndex: 1,
        contentIndex: 0,
        delta: "，继续分析",
      },
      { step: 1, sequence: 11 },
    ),
  );
  const run = state.sessions[TestSessionId].runs[0];
  expect(run.status).toBe("running");
  expect(run.thinkingBlocks.map(({ content, status }) => ({ content, status }))).toEqual([
    { content: "上一阶段的思考", status: "complete" },
    { content: "正在检查，继续分析", status: "streaming" },
  ]);
});

test("history snapshots recover attachment-only input labels from the stored user message", () => {
  const state = createTestState();
  const attachment = {
    resourceUri: "senera://resource/AbCd12",
    name: "image.png",
    mime: "image/png",
    size: 42,
    status: "uploaded",
  };
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryStarted, { sessionId: TestSessionId, totalEntries: 1, messageCount: 1 }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryChunk, {
      sessionId: TestSessionId,
      entries: [
        {
          entry: {
            id: "user-image",
            requestId: TestRequestId,
            timestamp: TestTimestamp,
            kind: "user.message",
            content: "",
            attachments: [attachment],
          },
        },
      ],
    }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistorySteps, {
      sessionId: TestSessionId,
      runs: [
        {
          requestId: TestRequestId,
          input: "",
          startedAt: TestTimestamp,
          status: "completed",
          traces: [],
        },
      ],
    }),
  );
  applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }));
  const run = state.sessions[TestSessionId].runs[0];
  expect(run.input).toBe("");
  expect(run.inputAttachments).toEqual([attachment]);
  expect(readRunInputLabel(run)).toBe("1 张图片");
});

test("native channel events retain identical metadata in live and historical messages", () => {
  const state = createTestState();
  const metadata = {
    channel: { platform: "onebot11", chatType: "group", chatId: "group-1" },
    channelEvent: {
      id: "poke-1",
      type: "poke",
      actorId: "user-1",
      actorName: "用户",
      targetId: "agent-1",
      targetName: "玉米",
      sentAt: TestTimestamp,
    },
  };
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "", metadata }, { scope: { channel: "onebot11" } }));
  const live = state.sessions[TestSessionId].messages[0];
  expect(live).toMatchObject({ content: "", metadata });
  expect(state.sessions[TestSessionId].title).toBe("新对话");
  const historical = projectEntryToMessage({
    id: `${TestRequestId}:user`,
    requestId: TestRequestId,
    timestamp: TestTimestamp,
    kind: "user.message",
    content: "",
    metadata,
  });
  expect(historical).toEqual(live);
});

test("catalog, live channel starts and snapshots retain the authoritative nonblank title", () => {
  const state = createTestState();
  const title = "测试群 · 10/25 12:23";
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "", title }, { scope: { channel: "onebot11" } }));
  expect(state.sessions[TestSessionId].title).toBe(title);
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionSnapshot,
      {
        sessionId: TestSessionId,
        title,
        status: "idle",
        entryCount: 1,
        messageCount: 1,
      },
      { sequence: 2 },
    ),
  );
  expect(state.sessions[TestSessionId].title).toBe(title);
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionSnapshot,
      {
        sessionId: TestSessionId,
        title: " ",
        status: "idle",
        entryCount: 1,
        messageCount: 1,
      },
      { sequence: 3 },
    ),
  );
  expect(state.sessions[TestSessionId].title).toBe(title);
});

test("replaying an old run never overwrites the current session title", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(EventKinds.SessionSnapshot, {
      sessionId: TestSessionId,
      title: "用户重新命名",
      status: "idle",
      entryCount: 0,
      messageCount: 0,
    }),
  );
  applyEvent(state, createEvent(EventKinds.SessionHistoryStarted, { totalEntries: 0, messageCount: 0 }));
  applyEvent(
    state,
    createEvent(EventKinds.SessionRunHistoryChunk, {
      sessionId: TestSessionId,
      events: [
        createEvent(
          EventKinds.RunStarted,
          { input: "", title: "旧群名 · 10/24 12:00" },
          { scope: { channel: "onebot11" } },
        ),
        createEvent(EventKinds.RunCompleted, {}, { sequence: 2 }),
      ],
    }),
  );
  applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }));
  expect(state.sessions[TestSessionId].title).toBe("用户重新命名");
  expect(state.sessions[TestSessionId].runs[0]?.status).toBe("completed");
});

test("history projection preserves a tool preface as a non-terminal assistant message", () => {
  const message = projectEntryToMessage(
    {
      id: "assistant-entry-preface",
      requestId: TestRequestId,
      timestamp: "2026-07-09T00:00:01.000Z",
      kind: "assistant.decision",
      xml: "<Decision><answer>我先检查配置。</answer></Decision>",
      metadata: { run: { modelProvider: { id: "model" } } },
    },
    { kind: "tool_preface", text: "我先检查配置。" },
  );

  expect(message).toMatchObject({
    id: `${TestRequestId}-tool-preface-assistant-entry-preface`,
    kind: "AssistantToolPreface",
    content: "我先检查配置。",
  });
});

test("history projection preserves ordinary user messages with metadata", () => {
  const message = projectEntryToMessage({
    id: "user-turn-2:user",
    requestId: "user-turn-2",
    timestamp: "2026-08-25T03:00:00.000Z",
    kind: "user.message",
    content: "继续这个任务",
    metadata: {
      queue: {
        mode: "follow_up",
        parentRequestId: TestRequestId,
      },
    },
  });

  expect(message).toMatchObject({ role: "user", content: "继续这个任务" });
});

test("history projection hides legacy internal background-task inputs", () => {
  const message = projectEntryToMessage({
    id: "background-child-1:user",
    requestId: "background-child-1-1",
    timestamp: "2026-08-25T03:00:00.000Z",
    kind: "user.message",
    content: "Senera background task update.",
    metadata: { backgroundTask: { taskId: "child-1", runId: "child-1" } },
  });

  expect(message).toBeNull();
});

test("history projection keeps the assistant reply from a legacy background-task input visible", () => {
  const message = projectEntryToMessage(
    {
      id: "background-child-1:assistant",
      requestId: "background-child-1-1",
      timestamp: "2026-08-25T03:00:01.000Z",
      kind: "assistant.decision",
      xml: "<response><answer>Child task finished.</answer></response>",
      metadata: { run: { modelProvider: { id: "model" } } },
    },
    { kind: "final_answer", text: "Child task finished." },
  );

  expect(message).toMatchObject({
    role: "assistant",
    kind: "AssistantFinal",
    requestId: "background-child-1-1",
    content: "Child task finished.",
  });
});

test("history projection preserves a scheduled delivery after refresh", () => {
  const message = projectEntryToMessage(
    {
      id: "scheduled-run-1:assistant",
      requestId: "scheduled-run-1",
      timestamp: "2026-08-05T00:02:00.000Z",
      kind: "assistant.decision",
      xml: "<response><answer>It is time to start work.</answer></response>",
      metadata: { scheduledTask: { taskId: "task-1", runId: "scheduled-run-1" } },
    },
    { kind: "final_answer", text: "It is time to start work." },
  );

  expect(message).toMatchObject({
    role: "assistant",
    kind: "AssistantFinal",
    requestId: "scheduled-run-1",
    content: "It is time to start work.",
  });
});

test("restores a pending deletion when the backend reports a structured close failure", () => {
  const state = createTestState({
    sessions: {
      [TestSessionId]: {
        sessionId: TestSessionId,
        title: "Pending deletion",
        status: "ready",
        createdAt: TestTimestamp,
        updatedAt: TestTimestamp,
        entryCount: 1,
        messageCount: 1,
        messages: [{ id: "message-1", role: "user", content: "keep", createdAt: TestTimestamp }],
        runs: [],
      },
    },
    sessionOrder: [],
    activeSessionId: null,
    pendingDeletedSessionIds: { [TestSessionId]: true },
    historyLoadingIds: { [TestSessionId]: true },
  });

  applyEvent(
    state,
    createEvent(
      EventKinds.RequestInvalid,
      {
        code: "session_close_failed",
        message: "close failed",
        details: { requestType: "session.close", sessionId: TestSessionId },
      },
      { layer: "error", phase: "request" },
    ),
  );

  expect(state.pendingDeletedSessionIds[TestSessionId]).toBeUndefined();
  expect(state.sessionOrder).toEqual([TestSessionId]);
  expect(state.activeSessionId).toBe(TestSessionId);
  expect(state.sessions[TestSessionId].messages).toHaveLength(1);
  expect(state.historyLoadingIds[TestSessionId]).toBe(false);
});

test("history replay buffers chunks and materializes messages on completion", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionSnapshot,
      {
        sessionId: TestSessionId,
        status: "ready",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
        entryCount: 0,
        messageCount: 0,
        turnCount: 0,
      },
      { requestId: undefined, phase: "session" },
    ),
  );

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: TestSessionId,
        totalEntries: 2,
        messageCount: 2,
      },
      { requestId: undefined, sequence: 2, phase: "session" },
    ),
  );

  const userEntry = {
    id: "entry_user",
    requestId: TestRequestId,
    timestamp: "2026-07-09T00:00:01.000Z",
    kind: "user.message",
    content: "你好",
  };
  const assistantEntry = {
    id: "entry_assistant",
    requestId: TestRequestId,
    timestamp: "2026-07-09T00:00:02.000Z",
    kind: "assistant.decision",
    xml: "你好，我在。",
    metadata: {
      run: {
        modelProvider: {
          id: "model",
          kind: "OpenAICompatible",
          endpoint: "ChatCompletions",
          baseUrl: "https://example.invalid/v1",
          model: "test-model",
        },
      },
    },
  };

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: TestSessionId,
        entries: [
          { entry: userEntry },
          { entry: assistantEntry, visible: { kind: "final_answer", text: "你好，我在。" } },
        ],
      },
      { requestId: undefined, sequence: 3, phase: "session" },
    ),
  );

  expect(state.sessions[TestSessionId]?.messages.length).toBe(0);
  expect(state.historyReplayBuffers[TestSessionId]?.flat().length).toBe(2);

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistorySteps,
      {
        sessionId: TestSessionId,
        runs: [
          {
            requestId: TestRequestId,
            input: "你好",
            startedAt: "2026-07-09T00:00:01.000Z",
            endedAt: "2026-07-09T00:00:02.000Z",
            status: "completed",
            traces: [
              {
                step: 1,
                seq: 0,
                kind: "answer",
                decisionKind: "final_answer",
                status: "done",
              },
            ],
          },
        ],
      },
      { requestId: undefined, sequence: 4, phase: "session" },
    ),
  );

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryCompleted,
      {
        sessionId: TestSessionId,
      },
      { requestId: undefined, sequence: 5, phase: "session" },
    ),
  );

  const session = state.sessions[TestSessionId];
  expect(session).toBeTruthy();
  expect(session.messages.map((message) => [message.role, message.content])).toEqual([
    ["user", "你好"],
    ["assistant", "你好，我在。"],
  ]);
  expect(session.runs.length).toBe(1);
  expect(session.runs[0]?.requestId).toBe(TestRequestId);
  expect(session.runs[0]?.steps[0]?.kind).toBe("answer");
  expect(state.historyLoadedIds[TestSessionId]).toBe(true);
  expect(state.historyLoadingIds[TestSessionId]).toBe(false);
  expect(state.historyReplayBuffers[TestSessionId]).toBe(undefined);
});

test("history replay ignores request ids removed by an authoritative truncation", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionSnapshot,
      {
        sessionId: TestSessionId,
        status: "ready",
        createdAt: TestTimestamp,
        updatedAt: TestTimestamp,
        entryCount: 1,
        messageCount: 1,
        turnCount: 1,
      },
      { requestId: undefined, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 1, messageCount: 1 },
      { requestId: undefined, sequence: 2, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionTruncated,
      {
        sessionId: TestSessionId,
        fromRequestId: TestRequestId,
        removedEntries: 1,
        removedRequestIds: [TestRequestId],
      },
      { requestId: undefined, sequence: 3, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: TestSessionId,
        entries: [
          {
            entry: {
              id: "stale-user",
              requestId: TestRequestId,
              timestamp: TestTimestamp,
              kind: "user.message",
              content: "旧分支",
            },
          },
        ],
      },
      { requestId: undefined, sequence: 4, phase: "session" },
    ),
  );

  expect(state.historyReplayBuffers[TestSessionId]?.flat()).toEqual([]);
});

test("history replay preserves every tool preface while reconciling the durable final answer", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionSnapshot,
      {
        sessionId: TestSessionId,
        status: "ready",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
        entryCount: 2,
        messageCount: 2,
        turnCount: 1,
      },
      { requestId: undefined, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      {
        sessionId: TestSessionId,
        totalEntries: 2,
        messageCount: 2,
      },
      { requestId: undefined, sequence: 2, phase: "session" },
    ),
  );

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: TestSessionId,
        entries: [
          {
            entry: {
              id: "entry_user",
              requestId: TestRequestId,
              timestamp: "2026-07-09T00:00:01.000Z",
              kind: "user.message",
              content: "检查项目配置",
            },
          },
          {
            entry: {
              id: "entry_final",
              requestId: TestRequestId,
              timestamp: "2026-07-09T00:00:05.000Z",
              kind: "assistant.decision",
              xml: "配置检查完成。",
              metadata: {
                run: {
                  modelProvider: {
                    id: "model",
                    kind: "OpenAICompatible",
                    endpoint: "ChatCompletions",
                    baseUrl: "https://example.invalid/v1",
                    model: "test-model",
                  },
                },
              },
            },
            visible: { kind: "final_answer", text: "配置检查完成。" },
          },
        ],
      },
      { requestId: undefined, sequence: 3, phase: "session" },
    ),
  );

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: TestSessionId,
        events: [
          createEvent(
            EventKinds.RunStarted,
            {
              input: "检查项目配置",
            },
            { sequence: 4 },
          ),
          createEvent(
            EventKinds.AssistantMessageCreated,
            {
              messageId: "preface_read",
              kind: "tool_preface",
              content: "我先读取项目配置。",
              terminal: false,
              toolCount: 1,
              batchId: "batch_read",
              toolCallIds: ["call_read"],
            },
            { sequence: 5, timestamp: "2026-07-09T00:00:02.000Z" },
          ),
          createEvent(
            EventKinds.AssistantMessageCreated,
            {
              messageId: "preface_verify",
              kind: "tool_preface",
              content: "配置已读取，我再核对依赖关系。",
              terminal: false,
              toolCount: 1,
              batchId: "batch_verify",
              toolCallIds: ["call_verify"],
            },
            { sequence: 6, timestamp: "2026-07-09T00:00:03.000Z" },
          ),
          createEvent(
            EventKinds.AssistantMessageCreated,
            {
              messageId: "final_event",
              kind: "final_answer",
              content: "配置检查完成。",
              terminal: true,
            },
            { sequence: 7, timestamp: "2026-07-09T00:00:05.000Z" },
          ),
          createEvent(
            EventKinds.RunCompleted,
            {},
            {
              sequence: 8,
              timestamp: "2026-07-09T00:00:05.001Z",
            },
          ),
        ],
      },
      { requestId: undefined, sequence: 4, phase: "session" },
    ),
  );

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryCompleted,
      {
        sessionId: TestSessionId,
      },
      { requestId: undefined, sequence: 5, phase: "session" },
    ),
  );

  const session = state.sessions[TestSessionId];
  expect(session?.messages.map((message) => [message.id, message.kind, message.content])).toEqual([
    [`${TestRequestId}-user`, undefined, "检查项目配置"],
    ["preface_read", "AssistantToolPreface", "我先读取项目配置。"],
    ["preface_verify", "AssistantToolPreface", "配置已读取，我再核对依赖关系。"],
    [`${TestRequestId}-answer`, "AssistantFinal", "配置检查完成。"],
  ]);
  expect(session?.messages.filter((message) => message.kind === "AssistantFinal")).toHaveLength(1);
  expect(session?.messageCount).toBe(4);
});

test("history replay preserves a recovered run that the server still reports active", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionSnapshot,
      {
        sessionId: TestSessionId,
        status: "running",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:01.000Z",
        entryCount: 1,
        messageCount: 1,
        turnCount: 1,
        activeRequestId: TestRequestId,
      },
      { requestId: TestRequestId, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 1, messageCount: 1 },
      { requestId: undefined, sequence: 2, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: TestSessionId,
        events: [createEvent(EventKinds.RunStarted, { input: "wait for approval" }, { sequence: 3 })],
      },
      { requestId: undefined, sequence: 3, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryCompleted,
      { sessionId: TestSessionId },
      { requestId: undefined, sequence: 4, phase: "session" },
    ),
  );

  const session = state.sessions[TestSessionId];
  expect(session?.activeRequestId).toBe(TestRequestId);
  expect(session?.runs).toEqual([
    expect.objectContaining({
      requestId: TestRequestId,
      status: "running",
    }),
  ]);
  expect(session?.runs[0]?.steps.some((step) => step.id.endsWith("history-interrupted"))).toBe(false);
});

test("history replay interrupts recovered runs that are no longer active on the server", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionSnapshot,
      {
        sessionId: TestSessionId,
        status: "idle",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:01.000Z",
        entryCount: 1,
        messageCount: 1,
        turnCount: 1,
      },
      { requestId: undefined, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 1, messageCount: 1 },
      { requestId: undefined, sequence: 2, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: TestSessionId,
        events: [
          createEvent(EventKinds.RunStarted, { input: "orphaned run" }, { sequence: 3 }),
          createEvent(
            EventKinds.ApprovalRequested,
            {
              approvalId: "approval-orphaned",
              approvalKind: "tool_call",
              status: "pending",
              title: "Approve shell",
              reason: "high impact",
              availableDecisions: ["approve_once", "deny", "deny_and_interrupt"],
              subject: {
                kind: "tool_call",
                toolName: "ShellCommandTool",
                arguments: { mode: "shell", dialect: "posix-sh", script: "pwd", workspaceEffect: "read" },
              },
              createdAt: "2026-07-09T00:00:02.000Z",
            },
            { sequence: 4, phase: "approval" },
          ),
          createEvent(
            EventKinds.InteractionInputRequested,
            {
              interactionId: "interaction-orphaned",
              mode: "form",
              status: "pending",
              message: "Choose a target",
              toolName: "AskUserTool",
              toolCallId: "call-ask-user",
              createdAt: "2026-07-09T00:00:03.000Z",
              schema: { type: "object", properties: {} },
            },
            { sequence: 5, phase: "approval" },
          ),
        ],
      },
      { requestId: undefined, sequence: 3, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryCompleted,
      { sessionId: TestSessionId },
      { requestId: undefined, sequence: 4, phase: "session" },
    ),
  );

  const run = state.sessions[TestSessionId]?.runs[0];
  expect(run?.status).toBe("cancelled");
  expect(run?.recoverySource).toBe("history");
  expect(run?.activeFlags).toBeUndefined();
  expect(run?.approvals).toEqual([
    expect.objectContaining({
      approvalId: "approval-orphaned",
      status: "cancelled",
      disposition: "interrupt",
      resolvedAt: expect.any(String),
      resolutionPending: false,
    }),
  ]);
  expect(run?.interactionInputs).toEqual([
    expect.objectContaining({
      interactionId: "interaction-orphaned",
      status: "resolved",
      action: "cancel",
      resolvedAt: expect.any(String),
      resolutionPending: false,
    }),
  ]);
  expect(run?.steps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "approval-approval-orphaned", status: "failed" }),
      expect.objectContaining({ id: "interaction-input-interaction-orphaned", status: "failed" }),
      expect.objectContaining({
        id: `${TestRequestId}-history-interrupted`,
        status: "failed",
      }),
    ]),
  );
});

test("history replay does not erase a locally completed run while reconciling", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "检查并回答" }, { sessionId: TestSessionId, requestId: TestRequestId }),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.AssistantMessageCreated,
      { messageId: "live-answer", kind: "final_answer", content: "实时答案", terminal: true },
      { sessionId: TestSessionId, requestId: TestRequestId },
    ),
  );
  applyEvent(state, createEvent(EventKinds.RunCompleted, {}, { sessionId: TestSessionId, requestId: TestRequestId }));

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 2, messageCount: 2 },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryChunk,
      {
        sessionId: TestSessionId,
        entries: [
          {
            entry: {
              id: "history-user",
              requestId: TestRequestId,
              timestamp: "2026-07-09T00:00:01.000Z",
              kind: "user.message",
              content: "检查并回答",
            },
          },
          {
            entry: {
              id: "history-answer",
              requestId: TestRequestId,
              timestamp: "2026-07-09T00:00:02.000Z",
              kind: "assistant.decision",
              xml: "<FinalAnswer><answer>历史答案</answer></FinalAnswer>",
            },
            visible: { kind: "final_answer", text: "历史答案" },
          },
        ],
      },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistorySteps,
      {
        sessionId: TestSessionId,
        runs: [
          {
            requestId: TestRequestId,
            input: "检查并回答",
            startedAt: "2026-07-09T00:00:01.000Z",
            endedAt: "2026-07-09T00:00:02.000Z",
            status: "completed",
            traces: [],
          },
        ],
      },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }, { sessionId: TestSessionId }),
  );

  const session = state.sessions[TestSessionId];
  expect(session?.messages.map((message) => message.content)).toEqual(["检查并回答", "历史答案"]);
  expect(session?.runs[0]?.status).toBe("completed");
  expect(state.historyLoadedIds[TestSessionId]).toBe(true);
});

test("history traces restore raw tool results omitted from durable event replay", () => {
  const state = createTestState();
  const toolCallId = "call_image";

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 0, messageCount: 0 },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: TestSessionId,
        // Result-detail events are intentionally absent from persisted event history.
        events: [
          createEvent(EventKinds.RunStarted, { input: "分析界面" }),
          createEvent(EventKinds.ToolCallStarted, {
            index: 0,
            toolName: "ImageAnalyze",
            callId: toolCallId,
            arguments: { task: "question" },
          }),
          createEvent(EventKinds.ToolCallCompleted, {
            index: 0,
            toolName: "ImageAnalyze",
            callId: toolCallId,
          }),
          createEvent(EventKinds.RunCompleted, {}),
        ],
      },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistorySteps,
      {
        sessionId: TestSessionId,
        runs: [
          {
            requestId: TestRequestId,
            input: "分析界面",
            startedAt: "2026-07-09T00:00:01.000Z",
            endedAt: "2026-07-09T00:00:02.000Z",
            status: "completed",
            traces: [
              {
                step: 1,
                seq: 0,
                kind: "tool",
                toolName: "ImageAnalyze",
                callId: toolCallId,
                status: "done",
                toolArgs: { task: "question" },
                toolResult: { answer: "界面分析结果" },
              },
            ],
          },
        ],
      },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }, { sessionId: TestSessionId }),
  );

  const step = state.sessions[TestSessionId]?.runs[0]?.steps.find((item) => item.callId === toolCallId);
  expect(step?.toolArgs).toEqual({ task: "question" });
  expect(step?.toolResult).toEqual({ answer: "界面分析结果" });
});

test("failed history attaches a tool result when run.started is absent", () => {
  const state = createTestState();
  const toolCallId = "call_failed_read";

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 0, messageCount: 0 },
      { sessionId: TestSessionId },
    ),
  );
  // An interrupted writer can persist the tool lifecycle after the initial
  // run-start record was lost. The useful result must still survive replay.
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: TestSessionId,
        events: [
          createEvent(EventKinds.ToolCallStarted, {
            index: 0,
            toolName: "WorkspaceRead",
            callId: toolCallId,
            arguments: { path: "missing.yaml" },
          }),
          createEvent(EventKinds.ToolCallResultDetail, {
            detailId: "detail_failed_read",
            index: 0,
            toolName: "WorkspaceRead",
            callId: toolCallId,
            value: { path: "missing.yaml", exists: false },
          }),
          createEvent(EventKinds.ToolCallFailed, {
            index: 0,
            toolName: "WorkspaceRead",
            callId: toolCallId,
            message: "找不到文件 missing.yaml。",
          }),
        ],
      },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistorySteps,
      {
        sessionId: TestSessionId,
        runs: [
          {
            requestId: TestRequestId,
            input: "读取配置",
            startedAt: "2026-07-09T00:00:01.000Z",
            endedAt: "2026-07-09T00:00:02.000Z",
            status: "failed",
            traces: [],
          },
        ],
      },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }, { sessionId: TestSessionId }),
  );

  const run = state.sessions[TestSessionId]?.runs.find((candidate) => candidate.requestId === TestRequestId);
  const step = run?.steps.find((candidate) => candidate.callId === toolCallId);
  expect(run?.status).toBe("failed");
  expect(step).toMatchObject({
    status: "failed",
    toolArgs: { path: "missing.yaml" },
    toolResult: { path: "missing.yaml", exists: false },
    toolErrorMessage: "找不到文件 missing.yaml。",
  });
});

test("appends repeated history step chunks before completing replay", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 0, messageCount: 0 },
      { sessionId: TestSessionId },
    ),
  );
  for (const [requestId, offset] of [
    ["request-step-a", 1],
    ["request-step-b", 2],
  ]) {
    applyEvent(
      state,
      createEvent(
        EventKinds.SessionHistorySteps,
        {
          sessionId: TestSessionId,
          runs: [
            {
              requestId,
              input: requestId,
              startedAt: `2026-07-09T00:00:0${offset}.000Z`,
              endedAt: `2026-07-09T00:00:0${offset + 1}.000Z`,
              status: "completed",
              traces: [],
            },
          ],
        },
        { sessionId: TestSessionId },
      ),
    );
  }
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }, { sessionId: TestSessionId }),
  );

  expect(state.sessions[TestSessionId]?.runs.map((run) => run.requestId)).toEqual(["request-step-a", "request-step-b"]);
});
