import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

test("tool preface and final answer are preserved as separate assistant messages", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "查一下天气" }));
  applyEvent(
    state,
    createEvent(EventKinds.AssistantMessageCreated, {
      messageId: "msg_preface",
      kind: "tool_preface",
      content: "我先查北京和上海的天气。",
      terminal: false,
      toolCount: 2,
      batchId: "batch_weather",
      toolCallIds: ["call_beijing", "call_shanghai"],
    }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.AssistantMessageCreated, {
      messageId: "msg_final",
      kind: "final_answer",
      content: "北京晴，上海多云。",
      terminal: true,
    }),
  );

  const session = state.sessions[TestSessionId];
  expect(session).toBeTruthy();
  expect(session.messages.map((message) => message.kind)).toEqual(["AssistantToolPreface", "AssistantFinal"]);
  expect(session.messages.map((message) => message.content)).toEqual([
    "我先查北京和上海的天气。",
    "北京晴，上海多云。",
  ]);

  const run = session.runs.find((item) => item.requestId === TestRequestId);
  expect(run).toBeTruthy();
  expect(run.visibleText).toBe("北京晴，上海多云。");
  expect(run.visibleKind).toBe("final_answer");
  expect(run.expectedOutputMode).toBe("final_text");
  expect(
    run.steps.some(
      (step) =>
        step.kind === "decision" && step.decisionKind === "tool_preface" && step.toolBatch?.id === "batch_weather",
    ),
  ).toBe(true);
  expect(run.steps.some((step) => step.kind === "answer" && step.decisionKind === "final_answer")).toBe(true);
});

test("tool.call.result.detail attaches structured result to the matching tool call", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "读取文件" }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallsPlanned,
      {
        toolCount: 1,
        tools: ["WorkspaceReadFile"],
        status: "planned",
        executionMode: "parallel",
        batchId: "batch_read",
      },
      { step: 1, phase: "tool" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallStarted,
      {
        index: 0,
        toolName: "WorkspaceReadFile",
        callId: "call_read",
        batchId: "batch_read",
      },
      { step: 1, sequence: 2, phase: "tool" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallCompleted,
      {
        index: 0,
        toolName: "WorkspaceReadFile",
        callId: "call_read",
        batchId: "batch_read",
        presentation: {
          type: "senera.tool_result_presentation.v1",
          version: 1,
          status: "success",
          headline: "README.md 已读取",
          summary: "包含项目说明。",
          facts: [],
          evidence: [],
          changes: [],
        },
      },
      { step: 1, sequence: 3, phase: "tool" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallResultDetail,
      {
        detailId: "detail_read",
        index: 0,
        toolName: "WorkspaceReadFile",
        callId: "call_read",
        batchId: "batch_read",
        value: {
          callId: "call_read",
          name: "WorkspaceReadFile",
          result: { text: "file content" },
          presentation: {
            type: "senera.tool_result_presentation.v1",
            version: 1,
            status: "success",
            headline: "README.md 已读取",
            facts: [],
            evidence: [],
            changes: [],
          },
        },
      },
      { step: 1, sequence: 4, phase: "tool" },
    ),
  );

  const run = state.sessions[TestSessionId]?.runs.find((item) => item.requestId === TestRequestId);
  expect(run).toBeTruthy();
  const toolStep = run.steps.find((step) => step.id === "tool-call_read");
  expect(toolStep).toBeTruthy();
  expect(toolStep.status).toBe("done");
  expect(toolStep.toolPreview).toBe("README.md 已读取");
  expect(toolStep.toolPresentation?.summary).toBe("包含项目说明。");
  expect(toolStep.toolBatch?.id).toBe("batch_read");
  expect(toolStep.toolBatch?.index).toBe(0);
  expect(toolStep.toolResult).toEqual({
    callId: "call_read",
    name: "WorkspaceReadFile",
    result: { text: "file content" },
    presentation: {
      type: "senera.tool_result_presentation.v1",
      version: 1,
      status: "success",
      headline: "README.md 已读取",
      facts: [],
      evidence: [],
      changes: [],
    },
  });
});
