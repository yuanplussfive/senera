import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

test("interaction input events suspend and resume the owning run", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "部署服务" }));
  const requested = {
    interactionId: "interaction_deploy",
    mode: "form",
    message: "选择部署环境",
    schema: {
      type: "object",
      properties: {
        environment: { type: "string", enum: ["staging", "production"] },
        replicas: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["environment", "replicas"],
    },
    toolName: "DeployTool",
    toolCallId: "call_deploy",
    createdAt: "2026-07-17T01:00:00.000Z",
    status: "pending",
  };
  applyEvent(
    state,
    createEvent(EventKinds.InteractionInputRequested, requested, { step: 2, sequence: 2, phase: "tool" }),
  );

  const run = state.sessions[TestSessionId].runs.find((item) => item.requestId === TestRequestId);
  expect(run.interactionInputs[0]).toMatchObject({ interactionId: "interaction_deploy", status: "pending" });
  expect(run.activeFlags).toEqual(["waiting_for_input"]);
  expect(run.steps.find((step) => step.id === "interaction-input-interaction_deploy")).toMatchObject({
    status: "pending",
    toolName: "DeployTool",
    callId: "call_deploy",
  });

  applyEvent(
    state,
    createEvent(
      EventKinds.InteractionInputResolved,
      {
        ...requested,
        status: "resolved",
        action: "accept",
        content: { environment: "production", replicas: 3 },
        resolvedAt: "2026-07-17T01:00:02.000Z",
      },
      { step: 2, sequence: 3, phase: "tool" },
    ),
  );

  expect(run.interactionInputs[0]).toMatchObject({
    status: "resolved",
    action: "accept",
    content: { environment: "production", replicas: 3 },
  });
  expect(run.activeFlags).toBeUndefined();
  expect(run.steps.find((step) => step.id === "interaction-input-interaction_deploy")).toMatchObject({
    status: "done",
    title: "已提交输入",
  });
});

test("approval and interaction waiting flags are composed independently", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "运行工具" }));
  applyEvent(
    state,
    createEvent(EventKinds.InteractionInputRequested, {
      interactionId: "interaction_one",
      mode: "form",
      message: "输入名称",
      schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      toolName: "Tool",
      toolCallId: "call_one",
      createdAt: "2026-07-17T01:00:00.000Z",
      status: "pending",
    }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.ApprovalRequested, {
      approvalId: "approval_one",
      approvalKind: "tool_call",
      title: "需要审批",
      reason: "写入工作区",
      availableDecisions: ["approve_once", "deny"],
      subject: { kind: "tool_call", toolName: "Tool", arguments: {} },
      createdAt: "2026-07-17T01:00:01.000Z",
      status: "pending",
    }),
  );

  const run = state.sessions[TestSessionId].runs[0];
  expect(run.activeFlags).toEqual(["waiting_for_approval", "waiting_for_input"]);
});

test("URL interaction remains active until external completion is projected", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "连接服务" }));
  const requested = {
    interactionId: "interaction_oauth",
    mode: "url",
    externalId: "oauth-login",
    url: "https://accounts.example.com/oauth/authorize",
    hostname: "accounts.example.com",
    message: "登录后继续",
    toolName: "OAuthTool",
    toolCallId: "call_oauth",
    createdAt: "2026-07-17T01:00:00.000Z",
    status: "pending",
  };
  applyEvent(state, createEvent(EventKinds.InteractionInputRequested, requested));
  const run = state.sessions[TestSessionId].runs[0];

  applyEvent(
    state,
    createEvent(EventKinds.InteractionInputResolved, {
      ...requested,
      status: "external_pending",
      action: "accept",
      resolvedAt: "2026-07-17T01:00:01.000Z",
    }),
  );
  expect(run.activeFlags).toEqual(["waiting_for_input"]);
  expect(run.steps.find((step) => step.id === "interaction-input-interaction_oauth")).toMatchObject({
    status: "running",
    title: "等待外部完成",
  });

  applyEvent(
    state,
    createEvent(EventKinds.InteractionInputResolved, {
      ...requested,
      status: "resolved",
      action: "accept",
      resolvedAt: "2026-07-17T01:00:02.000Z",
    }),
  );
  expect(run.activeFlags).toBeUndefined();
  expect(run.steps.find((step) => step.id === "interaction-input-interaction_oauth")).toMatchObject({ status: "done" });
});
