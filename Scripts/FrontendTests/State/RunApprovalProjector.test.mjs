import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

test("approval events create an approval step without replacing running tool steps", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "搜索资料" }));
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallStarted,
      {
        index: 0,
        toolName: "TavilySearchTool",
        callId: "call_search",
        batchId: "batch_search",
      },
      { step: 1, sequence: 2, phase: "tool" },
    ),
  );

  applyEvent(
    state,
    createEvent(
      EventKinds.ApprovalRequested,
      {
        approvalId: "approval_search",
        approvalKind: "tool_call",
        title: "需要确认搜索",
        reason: "工具权限包含高影响操作",
        rule: "tool.high_impact",
        riskSignals: ["network"],
        toolCallId: "call_search",
        availableDecisions: ["approve_once", "deny", "deny_and_interrupt"],
        subject: {
          kind: "tool_call",
          toolName: "TavilySearchTool",
          arguments: { query: "senera pi tools" },
        },
        createdAt: "2026-07-09T00:00:03.000Z",
        status: "pending",
      },
      { step: 1, sequence: 3, phase: "approval" },
    ),
  );

  const run = state.sessions[TestSessionId]?.runs.find((item) => item.requestId === TestRequestId);
  expect(run).toBeTruthy();
  expect(run.steps.find((step) => step.id === "tool-call_search")?.status).toBe("running");
  const approvalStep = run.steps.find((step) => step.id === "approval-approval_search");
  expect(approvalStep).toBeTruthy();
  expect(approvalStep.status).toBe("pending");
  expect(approvalStep.toolName).toBe("TavilySearchTool");
  expect(approvalStep.toolArgs).toEqual({ query: "senera pi tools" });
  expect(run.approvals?.[0]?.status).toBe("pending");
  expect(run.activeFlags).toEqual(["waiting_for_approval"]);

  applyEvent(
    state,
    createEvent(
      EventKinds.ApprovalResolved,
      {
        approvalId: "approval_search",
        approvalKind: "tool_call",
        title: "需要确认搜索",
        reason: "工具权限包含高影响操作",
        rule: "tool.high_impact",
        riskSignals: ["network"],
        toolCallId: "call_search",
        availableDecisions: ["approve_once", "deny", "deny_and_interrupt"],
        subject: {
          kind: "tool_call",
          toolName: "TavilySearchTool",
          arguments: { query: "senera pi tools" },
        },
        createdAt: "2026-07-09T00:00:03.000Z",
        status: "approved",
        decision: "approve_once",
        disposition: "proceed",
        message: "已允许",
        resolvedAt: "2026-07-09T00:00:04.000Z",
      },
      { step: 1, sequence: 4, phase: "approval" },
    ),
  );

  expect(run.steps.find((step) => step.id === "tool-call_search")?.status).toBe("running");
  const resolvedStep = run.steps.find((step) => step.id === "approval-approval_search");
  expect(resolvedStep).toBeTruthy();
  expect(resolvedStep.status).toBe("done");
  expect(resolvedStep.title).toBe("工具审批已通过");
  expect(resolvedStep.endedAt).toBe("2026-07-09T00:00:04.000Z");
  expect(run.approvals?.[0]?.status).toBe("approved");
  expect(run.approvals?.[0]?.message).toBe("已允许");
  expect(run.activeFlags).toBeUndefined();
});

test("fallback approval and execution audit remain visible in the run timeline", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "查询天气" }));
  const subject = {
    kind: "execution_fallback",
    pluginName: "WeatherPlugin",
    pluginTitle: "天气插件",
    pluginVersion: "1.0.0",
    manifestDigest: "b".repeat(64),
    rootKind: "User",
    trustLevel: "External",
    toolName: "WeatherTool",
    boundary: "SandboxPreferred",
    network: "Allow",
    workspace: "ReadOnly",
    permissions: ["network:http"],
    fromBackend: "microsandbox",
    toBackend: "node",
    failureReason: "sandbox_unavailable",
  };

  applyEvent(
    state,
    createEvent(
      EventKinds.ApprovalRequested,
      {
        approvalId: "approval_fallback",
        approvalKind: "execution_fallback",
        title: "允许天气插件在本机运行",
        reason: "沙箱不可用",
        rule: "execution.fallback.external_approval",
        availableDecisions: ["approve_once", "approve_session", "deny", "deny_and_interrupt"],
        subject,
        createdAt: "2026-07-09T00:00:01.000Z",
        status: "pending",
      },
      { step: 1, sequence: 2, phase: "approval" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ApprovalResolved,
      {
        approvalId: "approval_fallback",
        approvalKind: "execution_fallback",
        title: "允许天气插件在本机运行",
        reason: "沙箱不可用",
        rule: "execution.fallback.external_approval",
        availableDecisions: ["approve_once", "approve_session", "deny", "deny_and_interrupt"],
        subject,
        createdAt: "2026-07-09T00:00:01.000Z",
        resolvedAt: "2026-07-09T00:00:02.000Z",
        status: "approved",
        decision: "approve_session",
        disposition: "proceed",
        scope: "session",
      },
      { step: 1, sequence: 3, phase: "approval" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ExecutionFallbackStarted,
      {
        toolCallId: "call_weather",
        pluginName: "WeatherPlugin",
        pluginVersion: "1.0.0",
        toolName: "WeatherTool",
        manifestDigest: "b".repeat(64),
        fromBackend: "microsandbox",
        toBackend: "node",
        reason: "sandbox_unavailable",
        rule: "execution.fallback.external_approval",
        approvalId: "approval_fallback",
        scope: "session",
      },
      {
        step: 1,
        sequence: 4,
        phase: "approval",
        timestamp: "2026-07-09T00:00:04.000Z",
      },
    ),
  );

  const run = state.sessions[TestSessionId]?.runs.find((item) => item.requestId === TestRequestId);
  expect(run.approvals?.[0]).toMatchObject({
    approvalKind: "execution_fallback",
    scope: "session",
    subject,
  });
  expect(run.steps.find((step) => step.id === "execution-fallback-call_weather")).toMatchObject({
    title: "已切换到本机执行",
    status: "done",
    startedAt: "2026-07-09T00:00:04.000Z",
    endedAt: "2026-07-09T00:00:04.000Z",
    toolName: "WeatherTool",
  });
});
