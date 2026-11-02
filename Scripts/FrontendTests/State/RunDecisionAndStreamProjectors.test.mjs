import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";
import { projectAgentContinuitySnapshot } from "../../../Source/AgentSystem/Continuity/AgentContinuitySnapshot.ts";

test("interleaved agent sessions retain independent channel messages and tools-only terminal turns", () => {
  const state = createTestState();
  const lanes = ["agent-a-session", "agent-b-session"];
  for (const sessionId of lanes) {
    applyEvent(
      state,
      createEvent(
        EventKinds.RunStarted,
        {
          input: "你们两个呢",
          title: "测试群 · 10/25 12:23",
        },
        { sessionId, requestId: sessionId, sequence: 1, scope: { channel: "onebot11" } },
      ),
    );
  }
  for (const sessionId of [...lanes].reverse()) {
    for (const [sequence, kind] of [
      [2, EventKinds.ToolCallStarted],
      [3, EventKinds.ToolCallCompleted],
    ]) {
      applyEvent(
        state,
        createEvent(
          kind,
          {
            index: 0,
            toolName: "ChannelSendMessage",
            callId: `send-${sessionId}`,
          },
          { sessionId, requestId: sessionId, sequence, phase: "tool", step: 1 },
        ),
      );
    }
  }
  for (const sessionId of lanes) {
    applyEvent(
      state,
      createEvent(
        EventKinds.AssistantMessageCreated,
        {
          id: `empty-${sessionId}`,
          content: "",
          terminal: true,
        },
        { sessionId, requestId: sessionId, sequence: 4 },
      ),
    );
    applyEvent(state, createEvent(EventKinds.RunCompleted, {}, { sessionId, requestId: sessionId, sequence: 5 }));
    const { messages, runs, title } = state.sessions[sessionId];
    expect(title).toBe("测试群 · 10/25 12:23");
    expect(messages).toEqual([expect.objectContaining({ role: "user", requestId: sessionId, content: "你们两个呢" })]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      requestId: sessionId,
      status: "completed",
      steps: expect.arrayContaining([expect.objectContaining({ callId: `send-${sessionId}`, status: "done" })]),
    });
    expect(runs[0].steps.some((step) => step.callId === `send-${lanes.find((id) => id !== sessionId)}`)).toBe(false);
  }
});

test("regeneration truncation acknowledgement preserves the optimistic replacement request", () => {
  const state = createTestState();
  const originalRequestId = "request-original";
  const replacementRequestId = "request-replacement";

  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "Original input" }, { requestId: originalRequestId, sequence: 1 }),
  );
  state.sessions[TestSessionId].messages.push(
    {
      id: `${originalRequestId}-user`,
      role: "user",
      content: "Original input",
      createdAt: "2026-07-09T00:00:00.000Z",
      requestId: originalRequestId,
    },
    {
      id: `${originalRequestId}-assistant`,
      role: "assistant",
      content: "Original answer",
      createdAt: "2026-07-09T00:00:01.000Z",
      requestId: originalRequestId,
    },
    {
      id: `${replacementRequestId}-user`,
      role: "user",
      content: "Original input",
      createdAt: "2026-07-09T00:00:02.000Z",
      requestId: replacementRequestId,
    },
  );
  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "Original input" }, { requestId: replacementRequestId, sequence: 2 }),
  );

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionTruncated,
      {
        sessionId: TestSessionId,
        fromRequestId: originalRequestId,
        removedEntries: 2,
        replacementRequestId,
      },
      { requestId: undefined, sequence: 3, phase: "session" },
    ),
  );

  expect(state.sessions[TestSessionId].messages).toEqual([
    expect.objectContaining({ id: `${replacementRequestId}-user`, requestId: replacementRequestId }),
  ]);
  expect(state.sessions[TestSessionId].runs).toEqual([
    expect.objectContaining({ requestId: replacementRequestId, status: "running" }),
  ]);
  expect(state.sessions[TestSessionId].activeRequestId).toBe(replacementRequestId);
});

test("queued user input receives an authoritative queue status without creating a second run", () => {
  const state = createTestState();
  const parentRequestId = "request-active";
  const queuedRequestId = "request-queued";
  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "Long task" }, { requestId: parentRequestId, sequence: 1 }),
  );
  state.sessions[TestSessionId].messages.push({
    id: `${queuedRequestId}-user`,
    role: "user",
    content: "Change direction",
    createdAt: "2026-07-09T00:00:01.000Z",
    requestId: queuedRequestId,
    queueAdmission: { mode: "steer", status: "pending" },
  });

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionMessageQueued,
      {
        sessionId: TestSessionId,
        requestId: queuedRequestId,
        parentRequestId,
        mode: "steer",
      },
      { requestId: queuedRequestId, sequence: 2, phase: "session" },
    ),
  );

  const queued = state.sessions[TestSessionId].messages.find((message) => message.requestId === queuedRequestId);
  expect(queued).toMatchObject({
    metadata: { queue: { parentRequestId, mode: "steer" } },
  });
  expect(queued?.queueAdmission).toBeUndefined();
  expect(state.sessions[TestSessionId].runs.map((run) => run.requestId)).toEqual([parentRequestId]);
});

test("another client receives queued content, attachments, and terminal state under its own request identity", () => {
  const state = createTestState();
  const entry = {
    kind: "user.message",
    id: "supplement:user",
    requestId: "supplement",
    timestamp: "2026-07-09T00:00:01.000Z",
    content: "Use the image",
    attachments: [
      { resourceUri: "senera://resource/a1b2c3", name: "image.png", mime: "image/png", size: 12, status: "uploaded" },
    ],
  };
  for (const [index, status] of ["pending", "delivered", "failed"].entries()) {
    applyEvent(
      state,
      createEvent(
        EventKinds.SessionMessageQueued,
        {
          sessionId: TestSessionId,
          requestId: entry.requestId,
          parentRequestId: TestRequestId,
          mode: "steer",
          status,
          entry,
          ...(status === "failed" ? { message: "Provider disconnected" } : {}),
        },
        { requestId: TestRequestId, sequence: index + 1 },
      ),
    );
  }
  const messages = state.sessions[TestSessionId].messages.filter((message) => message.requestId === entry.requestId);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    content: entry.content,
    attachments: entry.attachments,
    metadata: {
      queue: {
        parentRequestId: TestRequestId,
        status: "failed",
        message: "Provider disconnected",
      },
    },
  });
  expect(state.sessions[TestSessionId].runs.some((run) => run.requestId === entry.requestId)).toBe(false);
});

test("a queued submission becomes a normal thinking turn when the host opens a fresh run", () => {
  const state = createTestState();
  const requestId = "request-raced-into-new-run";
  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "Long task" }, { requestId: "request-active", sequence: 1 }),
  );
  state.sessions[TestSessionId].messages.push({
    id: `${requestId}-user`,
    role: "user",
    content: "Continue separately",
    createdAt: "2026-07-09T00:00:01.000Z",
    requestId,
    queueAdmission: { mode: "follow_up", status: "pending" },
  });

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "Continue separately" }, { requestId, sequence: 2 }));

  const message = state.sessions[TestSessionId].messages.find((item) => item.requestId === requestId);
  expect(message?.queueAdmission).toBeUndefined();
  expect(state.sessions[TestSessionId].runs).toEqual(
    expect.arrayContaining([expect.objectContaining({ requestId, status: "running" })]),
  );
});

test("a rejected queued submission keeps a visible state on its user message", () => {
  const state = createTestState();
  const requestId = "request-queue-rejected";
  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "Long task" }, { requestId: "request-active", sequence: 1 }),
  );
  state.sessions[TestSessionId].messages.push({
    id: `${requestId}-user`,
    role: "user",
    content: "Change direction",
    createdAt: "2026-07-09T00:00:01.000Z",
    requestId,
    queueAdmission: { mode: "steer", status: "pending" },
  });

  applyEvent(
    state,
    createEvent(
      EventKinds.RequestInvalid,
      { code: "request_execution_failed", message: "Queue unavailable" },
      { requestId, sequence: 2, phase: "request", layer: "error" },
    ),
  );

  expect(
    state.sessions[TestSessionId].messages.find((message) => message.requestId === requestId)?.queueAdmission,
  ).toEqual({
    mode: "steer",
    status: "rejected",
    message: "Queue unavailable",
  });
});

test("user cancellation keeps the current message and completed tool evidence", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "检查当前配置" }, { sequence: 1 }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallStarted,
      { index: 0, toolName: "WorkspaceReadFile", callId: "call-read", arguments: { path: "senera.config.json" } },
      { sequence: 2, step: 1, phase: "tool" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallCompleted,
      { index: 0, toolName: "WorkspaceReadFile", callId: "call-read" },
      { sequence: 3, step: 1, phase: "tool" },
    ),
  );
  applyEvent(state, createEvent(EventKinds.RunCancelled, {}, { sequence: 4 }));

  const session = state.sessions[TestSessionId];
  const run = readTestRun(state);
  expect(session.messages).toEqual([expect.objectContaining({ id: `${TestRequestId}-user` })]);
  expect(run.status).toBe("cancelled");
  expect(run.steps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "tool-call-read", status: "done", toolName: "WorkspaceReadFile" }),
      expect.objectContaining({ id: `${TestRequestId}-cancelled`, status: "cancelled" }),
    ]),
  );
  expect(run.steps.some((step) => step.status === "failed")).toBe(false);
  expect(run.activities?.every((activity) => activity.status !== "running")).toBe(true);
});

test("terminal run usage is projected once as the authoritative message metric source", () => {
  const state = createTestState();
  const requestId = TestRequestId;
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "统计本轮用量" }, { requestId, sequence: 1 }));
  applyEvent(
    state,
    createEvent(
      EventKinds.RunCompleted,
      {
        usage: {
          source: "provider_reported",
          inputTokens: 120,
          outputTokens: 36,
          totalTokens: 156,
          cacheReadTokens: 80,
        },
      },
      { requestId, sequence: 2 },
    ),
  );

  expect(readTestRun(state)).toEqual(
    expect.objectContaining({
      status: "completed",
      usage: expect.objectContaining({ inputTokens: 120, outputTokens: 36, totalTokens: 156 }),
    }),
  );
});

test("prompt summary projects deterministic preparation metrics", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "检查项目测试" }, { sequence: 1 }));
  applyEvent(
    state,
    createEvent(
      EventKinds.PromptSummary,
      {
        chars: 1200,
        lines: 42,
        tokenCount: 330,
      },
      { step: 1, sequence: 2, phase: "prompt" },
    ),
  );
  const run = readTestRun(state);
  expect(run.expectedOutputMode).toBe("unknown");
  expect(run.steps.map((step) => [step.kind, step.status])).toEqual([
    ["understand", "done"],
    ["prompt", "done"],
  ]);
  expect(run.steps.find((step) => step.kind === "prompt")).toMatchObject({
    promptChars: 1200,
    promptLines: 42,
    promptTokenCount: 330,
  });
});

test("native memory snapshots remain attached to their run", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "偏好" }, { sequence: 1 }));
  const count = readTestRun(state).steps.length;
  applyEvent(
    state,
    createEvent(
      EventKinds.ContinuitySnapshot,
      {
        enabled: true,
        eventCandidates: [
          {
            id: "1",
            uri: "memos:1",
            revision: "v1",
            type: "preference",
            summary: "先给结论。",
            occurredAt: "2026-08-22T08:00:00Z",
            score: 0.91,
            matchedBy: ["memos"],
          },
        ],
        selection: {
          events: { available: 1, matched: 1, selected: 1 },
          usedTokens: 24,
          maxTokens: 2048,
        },
      },
      { step: 1, sequence: 2, phase: "prompt", layer: "snapshot" },
    ),
  );
  expect(readTestRun(state).steps).toHaveLength(count);
  expect(readTestRun(state).continuity).toMatchObject({ eventCandidates: [{ uri: "memos:1", summary: "先给结论。" }] });
});

test.each(["live", "history"])(
  "current memory producer retains task records, quality and diagnostics in %s projection",
  (mode) => {
    const state = createTestState();
    const snapshot = projectAgentContinuitySnapshot({
      enabled: true,
      query: "Continue debugging",
      snapshotGeneration: 2,
      eventCandidates: [
        {
          id: "fact",
          uri: "memos:fact",
          revision: "v1",
          type: "fact",
          summary: "Verified fact",
          occurredAt: "2026-10-27T00:00:00Z",
          score: 0.4,
          matchedBy: ["memos", "relevance_assessment"],
          scores: { relevance: 0.8 },
          quality: {
            weight: 50,
            recallCount: 0,
            helpfulCount: 0,
            unhelpfulCount: 0,
            unusedCount: 0,
            uncertainCount: 0,
            pendingCount: 0,
          },
          dedupeKeys: ["private"],
        },
      ],
      taskCandidates: [
        {
          id: "task",
          uri: "memos:task",
          revision: "v2",
          type: "context",
          summary: "Current finding",
          occurredAt: "2026-10-27T00:01:00Z",
          score: 0.7,
          matchedBy: ["task"],
          scores: { relevance: 0.8, recency: 0.9 },
        },
      ],
      diagnostics: {
        unassigned: 3,
        otherSubject: 2,
        irrelevant: 1,
        snapshotReused: false,
        relevanceStatus: "completed",
      },
      selection: {
        events: { available: 2, matched: 1, selected: 1 },
        tasks: { available: 2, matched: 2, selected: 1 },
        usedTokens: 100,
        maxTokens: 2048,
      },
    });
    const events = [
      createEvent(EventKinds.RunStarted, { input: "Continue debugging" }, { sequence: 1 }),
      createEvent(EventKinds.ContinuitySnapshot, snapshot, { sequence: 2, phase: "prompt", layer: "snapshot" }),
    ];
    if (mode === "live") for (const event of events) applyEvent(state, event);
    else {
      applyEvent(
        state,
        createEvent(EventKinds.SessionHistoryStarted, { sessionId: TestSessionId, totalEntries: 0, messageCount: 0 }),
      );
      applyEvent(state, createEvent(EventKinds.SessionRunHistoryChunk, { sessionId: TestSessionId, events }));
      applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }));
    }
    expect(readTestRun(state).continuity).toEqual(snapshot);
    expect(readTestRun(state).continuity.eventCandidates[0]).not.toHaveProperty("dedupeKeys");
  },
);

test("malformed historical continuity snapshots are rejected at the projection boundary", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "旧回合" }, { sequence: 1 }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ContinuitySnapshot,
      {
        enabled: true,
        residentProfile: [{ subject: "system" }],
        factCatalog: [],
        selection: {
          profiles: { available: 0, matched: 0, selected: 0 },
          facts: { available: 0, matched: 0, selected: 0 },
          events: { available: 0, matched: 0, selected: 0 },
          evidence: { available: 0, matched: 0, selected: 0 },
          usedTokens: 0,
          maxTokens: 2048,
        },
        evidenceCandidates: [],
        eventCandidates: [],
        rules: [],
        signals: [],
      },
      { step: 1, sequence: 2, phase: "prompt", layer: "snapshot" },
    ),
  );

  expect(readTestRun(state).continuity).toBeUndefined();
});

test("model stream events keep visible answer text while closing the model step", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "写总结" }, { sequence: 1 }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ModelStarted,
      {
        model: "mistral-large-latest",
        provider: {
          id: "provider_pi",
          kind: "OpenAICompatible",
          endpoint: "ChatCompletions",
          baseUrl: "https://example.test/v1",
          model: "mistral-large-latest",
        },
      },
      { step: 1, sequence: 2, phase: "model" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ModelDelta,
      {
        text: "第一段",
      },
      { step: 1, sequence: 3, phase: "model" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ModelDelta,
      {
        text: "，第二段。",
      },
      { step: 1, sequence: 4, phase: "model" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ModelCompleted,
      {
        text: "第一段，第二段。",
      },
      { step: 1, sequence: 5, phase: "model" },
    ),
  );

  const run = readTestRun(state);
  expect(run.streamingRaw).toBe("第一段，第二段。");
  expect(run.visibleText).toBe("第一段，第二段。");
  expect(run.visibleKind).toBe("final_answer");
  expect(run.displayText).toBe("第一段，第二段。");
  expect(run.modelProvider?.id).toBe("provider_pi");
  expect(run.steps.find((step) => step.kind === "model")).toMatchObject({
    status: "done",
    modelName: "mistral-large-latest",
  });
});

test("native thinking events stream independently from answer text and keep a final transcript", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "解释问题" }, { sequence: 1 }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ModelThinkingDelta,
      { messageIndex: 0, contentIndex: 1, delta: "先确认" },
      { step: 2, sequence: 2, phase: "model" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ModelThinkingDelta,
      { messageIndex: 0, contentIndex: 1, delta: "事件来源。" },
      { step: 2, sequence: 3, phase: "model" },
    ),
  );

  let run = readTestRun(state);
  expect(run.thinkingBlocks).toEqual([
    {
      id: "step:2:message:0:content:1",
      step: 2,
      messageIndex: 0,
      contentIndex: 1,
      eventSequence: 2,
      content: "先确认事件来源。",
      status: "streaming",
    },
  ]);
  expect(run.streamingRaw).toBe("");

  applyEvent(
    state,
    createEvent(
      EventKinds.ModelThinkingCompleted,
      { messageIndex: 0, contentIndex: 1, content: "先确认事件来源。", status: "complete" },
      { step: 2, sequence: 4, phase: "model", layer: "snapshot" },
    ),
  );
  applyEvent(state, createEvent(EventKinds.ModelDelta, { text: "结论。" }, { step: 2, sequence: 5, phase: "model" }));

  run = readTestRun(state);
  expect(run.thinkingBlocks[0]).toMatchObject({ content: "先确认事件来源。", status: "complete" });
  expect(run.streamingRaw).toBe("结论。");
});

test("run activity updates the left-side live status without creating workflow steps", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "检查项目" }, { sequence: 1 }));
  const initialStepCount = readTestRun(state).steps.length;
  applyEvent(
    state,
    createEvent(
      EventKinds.RunActivityChanged,
      {
        activityId: "activity-model",
        activity: "running_agent_turn",
        state: "started",
      },
      { step: 1, sequence: 2, phase: "run" },
    ),
  );

  let run = readTestRun(state);
  expect(run.liveActivity).toBe("running_agent_turn");
  expect(run.steps).toHaveLength(initialStepCount);
  expect(run.activities).toEqual([
    expect.objectContaining({
      id: "activity-model",
      activity: "running_agent_turn",
      status: "running",
      step: 1,
      eventSequence: 2,
    }),
  ]);

  applyEvent(
    state,
    createEvent(
      EventKinds.RunActivityChanged,
      {
        activityId: "activity-model",
        activity: "running_agent_turn",
        state: "completed",
      },
      { step: 1, sequence: 3, phase: "run" },
    ),
  );
  run = readTestRun(state);
  expect(run.liveActivity).toBeUndefined();
  expect(run.activities?.[0]).toMatchObject({ status: "done", endedAt: expect.any(String) });
  expect(run.steps).toHaveLength(initialStepCount);

  applyEvent(state, createEvent(EventKinds.RunCompleted, {}, { sequence: 4, phase: "run" }));
  expect(readTestRun(state).liveActivity).toBeUndefined();
});

test("late terminal events cannot clear a newer active run", () => {
  const state = createTestState();
  const olderRequestId = "request-older";
  const newerRequestId = "request-newer";

  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "旧任务" }, { requestId: olderRequestId, sequence: 1 }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "新任务" }, { requestId: newerRequestId, sequence: 2 }),
  );

  applyEvent(state, createEvent(EventKinds.RunCompleted, {}, { requestId: olderRequestId, sequence: 3 }));
  expect(state.sessions[TestSessionId].activeRequestId).toBe(newerRequestId);

  applyEvent(state, createEvent(EventKinds.RunCancelled, {}, { requestId: olderRequestId, sequence: 4 }));
  expect(state.sessions[TestSessionId].activeRequestId).toBe(newerRequestId);
});

test("run activity restores the parent phase after nested context compaction completes", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "检查项目" }, { sequence: 1 }));
  applyEvent(
    state,
    createEvent(
      EventKinds.RunActivityChanged,
      {
        activityId: "activity-turn",
        activity: "running_agent_turn",
        state: "started",
      },
      { step: 1, sequence: 2, phase: "run" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.RunActivityChanged,
      {
        activityId: "activity-compaction",
        parentActivityId: "activity-turn",
        activity: "compacting_context",
        state: "started",
      },
      { step: 1, sequence: 3, phase: "run" },
    ),
  );

  expect(readTestRun(state).liveActivity).toBe("compacting_context");

  applyEvent(
    state,
    createEvent(
      EventKinds.RunActivityChanged,
      {
        activityId: "activity-compaction",
        parentActivityId: "activity-turn",
        activity: "compacting_context",
        state: "completed",
      },
      { step: 1, sequence: 4, phase: "run" },
    ),
  );

  expect(readTestRun(state).liveActivity).toBe("running_agent_turn");
});

test("authoritative assistant events classify a tool preface and the following answer", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "搜索工作区工具" }, { sequence: 1 }));
  applyEvent(
    state,
    createEvent(
      EventKinds.AssistantMessageCreated,
      {
        messageId: "tool-preface",
        kind: "tool_preface",
        content: "我先搜索当前已加载的工具。",
        terminal: false,
      },
      { step: 1, sequence: 2, phase: "decision" },
    ),
  );

  let run = readTestRun(state);
  expect(run.visibleKind).toBe("tool_calls");
  expect(run.decisionMode).toBe("tool_candidate");

  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallsPlanned,
      {
        toolCount: 1,
        tools: ["AgentToolSearch"],
        status: "planned",
        executionMode: "sequential",
        batchId: "batch-search",
      },
      { step: 1, sequence: 3, phase: "tool" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallStarted,
      { index: 0, toolName: "AgentToolSearch", callId: "call-search" },
      { step: 1, sequence: 4, phase: "tool" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.AssistantMessageCreated,
      {
        messageId: "final-answer",
        kind: "final_answer",
        content: "工具结果已经足够。",
        terminal: true,
      },
      { step: 1, sequence: 5, phase: "model" },
    ),
  );

  run = readTestRun(state);
  expect(run.visibleKind).toBe("final_answer");
  expect(run.decisionMode).toBe("final_text");
});

function readTestRun(state) {
  const run = state.sessions[TestSessionId]?.runs.find((item) => item.requestId === TestRequestId);
  expect(run).toBeTruthy();
  return run;
}
