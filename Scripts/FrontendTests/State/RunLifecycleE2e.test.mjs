import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import {
  createEvent,
  createTestState,
  TestRequestId,
  TestSessionId,
} from "./sessionProjectorTestUtils.mjs";

test("complete tool-assisted run projects chat messages, approvals, tool details, and completion state", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "查北京天气" }, { sequence: 1 }));
  applyEvent(state, createEvent(EventKinds.AssistantMessageCreated, {
    messageId: "msg_preface",
    kind: "tool_preface",
    content: "我先查询北京天气。",
    terminal: false,
    toolCount: 1,
    batchId: "batch_weather",
    toolCallIds: ["call_weather"],
  }, { sequence: 2 }));
  applyEvent(state, createEvent(EventKinds.ApprovalRequested, {
    approvalId: "approval_weather",
    approvalKind: "tool_call",
    title: "需要确认天气查询",
    reason: "外部网络请求",
    subject: {
      kind: "tool_call",
      toolName: "WeatherTool",
      arguments: { city: "北京" },
    },
    createdAt: "2026-07-09T00:00:01.000Z",
    status: "pending",
  }, { step: 1, sequence: 3, phase: "approval" }));
  applyEvent(state, createEvent(EventKinds.ApprovalResolved, {
    approvalId: "approval_weather",
    approvalKind: "tool_call",
    title: "需要确认天气查询",
    reason: "外部网络请求",
    subject: {
      kind: "tool_call",
      toolName: "WeatherTool",
      arguments: { city: "北京" },
    },
    createdAt: "2026-07-09T00:00:01.000Z",
    status: "approved",
    resolvedAt: "2026-07-09T00:00:02.000Z",
    message: "允许",
  }, { step: 1, sequence: 4, phase: "approval" }));
  applyEvent(state, createEvent(EventKinds.ToolCallsPlanned, {
    toolCount: 1,
    tools: ["WeatherTool"],
    status: "planned",
    executionMode: "parallel",
    batchId: "batch_weather",
  }, { step: 1, sequence: 5, phase: "tool" }));
  applyEvent(state, createEvent(EventKinds.ToolCallStarted, {
    index: 0,
    toolName: "WeatherTool",
    callId: "call_weather",
    batchId: "batch_weather",
  }, { step: 1, sequence: 6, phase: "tool" }));
  applyEvent(state, createEvent(EventKinds.ToolCallCompleted, {
    index: 0,
    toolName: "WeatherTool",
    callId: "call_weather",
    batchId: "batch_weather",
    presentation: {
      type: "senera.tool_result_presentation.v1",
      version: 1,
      status: "success",
      headline: "北京 28C 晴",
      facts: [],
      evidence: [],
      changes: [],
    },
  }, { step: 1, sequence: 7, phase: "tool" }));
  applyEvent(state, createEvent(EventKinds.ToolCallResultDetail, {
    detailId: "detail_weather",
    index: 0,
    toolName: "WeatherTool",
    callId: "call_weather",
    batchId: "batch_weather",
    value: {
      city: "北京",
      temperature: "28C",
      condition: "晴",
    },
  }, { step: 1, sequence: 8, phase: "tool" }));
  applyEvent(state, createEvent(EventKinds.AssistantMessageCreated, {
    messageId: "msg_final",
    kind: "final_answer",
    content: "北京现在 28C，天气晴。",
    terminal: true,
  }, { sequence: 9 }));
  applyEvent(state, createEvent(EventKinds.RunCompleted, {}, { sequence: 10, phase: "run" }));

  const session = state.sessions[TestSessionId];
  expect(session).toBeTruthy();
  expect(session.activeRequestId).toBe(undefined);
  expect(session.messages.map((message) => [message.kind, message.content])).toEqual([
    ["AssistantToolPreface", "我先查询北京天气。"],
    ["AssistantFinal", "北京现在 28C，天气晴。"],
  ]);

  const run = session.runs.find((item) => item.requestId === TestRequestId);
  expect(run).toBeTruthy();
  expect(run.status).toBe("completed");
  expect(run.visibleText).toBe("北京现在 28C，天气晴。");
  expect(run.approvals?.[0]?.status).toBe("approved");
  expect(run.steps.find((step) => step.id === "approval-approval_weather")?.status).toBe("done");
  const toolStep = run.steps.find((step) => step.id === "tool-call_weather");
  expect(toolStep).toBeTruthy();
  expect(toolStep.status).toBe("done");
  expect(toolStep.toolResult).toEqual({
    city: "北京",
    temperature: "28C",
    condition: "晴",
  });
});
