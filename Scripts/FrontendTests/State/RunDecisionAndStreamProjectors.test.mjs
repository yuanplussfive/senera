import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

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

test("user cancellation keeps the current message and completed tool evidence", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "检查当前配置" }, { sequence: 1 }));
  state.sessions[TestSessionId].messages.push({
    id: `${TestRequestId}-user`,
    role: "user",
    content: "检查当前配置",
    createdAt: "2026-07-09T00:00:00.000Z",
    requestId: TestRequestId,
  });
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
        periodDigests: [],
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
          digests: { available: 0, matched: 0, selected: 0 },
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
  expect(run.displayText).toBe("");
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
