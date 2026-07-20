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

test("tool output and progress are projected incrementally and deduplicated by sequence", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "运行测试" }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallStarted,
      { index: 0, toolName: "ShellCommandTool", callId: "call_shell" },
      { step: 1, sequence: 2, phase: "tool" },
    ),
  );
  const firstOutput = {
    toolName: "ShellCommandTool",
    callId: "call_shell",
    stream: "stdout",
    outputSequence: 1,
    text: "running tests\n",
    byteLength: 14,
    totalBytes: 14,
  };
  applyEvent(state, createEvent(EventKinds.ToolCallOutput, firstOutput, { step: 1, sequence: 3, phase: "tool" }));
  applyEvent(state, createEvent(EventKinds.ToolCallOutput, firstOutput, { step: 1, sequence: 4, phase: "tool" }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallProgress,
      {
        toolName: "ShellCommandTool",
        callId: "call_shell",
        progressSequence: 1,
        message: "2 of 4 suites",
        completed: 2,
        total: 4,
        unit: "suite",
      },
      { step: 1, sequence: 5, phase: "tool" },
    ),
  );

  const run = state.sessions[TestSessionId]?.runs.find((item) => item.requestId === TestRequestId);
  const toolStep = run?.steps.find((step) => step.id === "tool-call_shell");
  expect(toolStep?.toolOutput?.stdout).toBe("running tests\n");
  expect(toolStep?.toolOutput?.stdoutBytes).toBe(14);
  expect(toolStep?.toolOutput?.lastSequence).toBe(1);
  expect(toolStep?.toolProgress).toEqual({
    sequence: 1,
    message: "2 of 4 suites",
    completed: 2,
    total: 4,
    unit: "suite",
  });
  expect(toolStep?.description).toBe("2 of 4 suites");
});

test("background resource events continue updating their originating tool after the start call completes", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "启动开发服务" }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallStarted,
      { index: 0, toolName: "ShellStartTool", callId: "call_server" },
      { step: 1, sequence: 2, phase: "tool" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallCompleted,
      { index: 0, toolName: "ShellStartTool", callId: "call_server" },
      { step: 1, sequence: 3, phase: "tool" },
    ),
  );
  applyEvent(state, createEvent(EventKinds.RunCompleted, { answer: "已启动" }, { sequence: 4, phase: "run" }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ExecutionResourceOutput,
      {
        resourceId: "res_0123456789abcdef0123456789abcdef",
        toolCallId: "call_server",
        toolName: "ShellStartTool",
        cursor: 2,
        stream: "stdout",
        text: "ready on 4173\n",
        byteLength: 14,
        totalBytes: 14,
      },
      { step: 1, sequence: 5, phase: "tool" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ExecutionResourceState,
      {
        resourceId: "res_0123456789abcdef0123456789abcdef",
        toolCallId: "call_server",
        toolName: "ShellStartTool",
        cursor: 3,
        state: "completed",
        exitCode: 0,
        reason: "exit:0",
      },
      { step: 1, sequence: 6, phase: "tool" },
    ),
  );

  const run = state.sessions[TestSessionId]?.runs.find((item) => item.requestId === TestRequestId);
  const toolStep = run?.steps.find((step) => step.id === "tool-call_server");
  expect(toolStep?.toolOutput?.stdout).toBe("ready on 4173\n");
  expect(toolStep?.toolProgress).toEqual(expect.objectContaining({ sequence: 3, message: "completed: exit:0" }));
});
