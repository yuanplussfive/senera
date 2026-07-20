import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

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
  expect(state.historyReplayBuffers[TestSessionId]?.length).toBe(2);

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
              subject: { kind: "tool_call", toolName: "ShellCommandTool", arguments: { command: "pwd" } },
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
  applyEvent(
    state,
    createEvent(EventKinds.RunCompleted, {}, { sessionId: TestSessionId, requestId: TestRequestId }),
  );

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
  applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }, { sessionId: TestSessionId }));

  const session = state.sessions[TestSessionId];
  expect(session?.messages.map((message) => message.content)).toEqual(["检查并回答", "历史答案"]);
  expect(session?.runs[0]?.status).toBe("completed");
  expect(state.historyLoadedIds[TestSessionId]).toBe(true);
});

test("terminal run snapshots win when the event outbox has only persisted run.started", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "快速完成" }, { sessionId: TestSessionId, requestId: TestRequestId }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.RunCompleted, {}, { sessionId: TestSessionId, requestId: TestRequestId }),
  );
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
      EventKinds.SessionHistorySteps,
      {
        sessionId: TestSessionId,
        runs: [
          {
            requestId: TestRequestId,
            input: "快速完成",
            startedAt: "2026-07-09T00:00:01.000Z",
            endedAt: "2026-07-09T00:00:02.000Z",
            status: "completed",
            traces: [
              {
                step: 1,
                seq: 1,
                kind: "answer",
                status: "done",
                title: "回答完成",
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
    createEvent(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: TestSessionId,
        events: [createEvent(EventKinds.RunStarted, { input: "快速完成" }, { sequence: 1 })],
      },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }, { sessionId: TestSessionId }),
  );

  const run = state.sessions[TestSessionId]?.runs[0];
  expect(run?.status).toBe("completed");
  expect(run?.endedAt).toBe("2026-07-09T00:00:02.000Z");
  expect(run?.steps).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "answer", status: "done" })]));
  expect(run?.steps.some((step) => step.id.endsWith("history-interrupted"))).toBe(false);
});

test("history events can hydrate a session before a snapshot arrives", () => {
  const state = createTestState();
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
    createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }, { sessionId: TestSessionId }),
  );

  expect(state.sessions[TestSessionId]).toBeTruthy();
  expect(state.historyLoadedIds[TestSessionId]).toBe(true);
});
