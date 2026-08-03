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
