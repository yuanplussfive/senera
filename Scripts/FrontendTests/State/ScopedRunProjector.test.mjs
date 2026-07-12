import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

test("scoped tool events attach to parent run with scoped step ids", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "分析项目" }));

  const scope = {
    parentRequestId: TestRequestId,
    workflowName: "inspect",
    jobId: "job_frontend",
    agentName: "FrontendInspector",
    role: "childAgent",
  };

  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallStarted,
      {
        index: 0,
        toolName: "WorkspaceReadFile",
        callId: "call_child_read",
        batchId: "batch_child",
      },
      {
        requestId: "child_request",
        step: 2,
        sequence: 2,
        phase: "tool",
        scope,
      },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ToolCallResultDetail,
      {
        detailId: "detail_child",
        index: 0,
        toolName: "WorkspaceReadFile",
        callId: "call_child_read",
        batchId: "batch_child",
        value: { result: { text: "child file" } },
      },
      {
        requestId: "child_request",
        step: 2,
        sequence: 3,
        phase: "tool",
        scope,
      },
    ),
  );

  const run = state.sessions[TestSessionId]?.runs.find((item) => item.requestId === TestRequestId);
  expect(run).toBeTruthy();
  const scopedToolStep = run.steps.find((step) => step.callId === "call_child_read");
  expect(scopedToolStep).toBeTruthy();
  expect(scopedToolStep.id).toBe("inspect:childAgent:job_frontend:child_request:2:tool:call_child_read");
  expect(scopedToolStep.scope).toEqual(scope);
  expect(scopedToolStep.toolResult).toEqual({ result: { text: "child file" } });
  expect(run.steps.some((step) => step.id === "tool-call_child_read")).toBe(false);
});
