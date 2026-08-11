import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

test("child-run lifecycle and snapshots project back to the owning parent run", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "Review the workspace" }));
  const scope = childScope("child-run-1");

  applyEvent(
    state,
    createEvent(
      EventKinds.ChildRunStarted,
      {
        childRunId: "child-run-1",
        childSessionId: "child-session-1",
        agentName: "reviewer",
        status: "running",
        contextMode: "fresh",
      },
      { sessionId: TestSessionId, requestId: TestRequestId, phase: "orchestration", scope },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ChildRunSnapshotUpdated,
      {
        childRunId: "child-run-1",
        childSessionId: "child-session-1",
        agentName: "reviewer",
        status: "running",
        checkpointAvailable: true,
        snapshot: {
          version: 1,
          capturedAt: "2026-07-09T00:01:00.000Z",
          lastActivityAt: "2026-07-09T00:01:00.000Z",
          lastModelOutputAt: "2026-07-09T00:00:59.000Z",
          modelOutputCharacters: 420,
          assistantTurns: 2,
          toolCalls: { planned: 3, started: 3, completed: 2, failed: 0 },
          activeTools: ["WorkspaceRead"],
          artifactUris: ["senera://artifact/art_child"],
          deadline: {
            softDeadlineAt: "2026-07-09T00:25:00.000Z",
            grantedExtensionMs: 60000,
          },
        },
      },
      {
        sessionId: "child-session-1",
        requestId: "child-request-1",
        phase: "orchestration",
        sequence: 2,
        scope,
      },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ChildRunWrappingUp,
      {
        childRunId: "child-run-1",
        childSessionId: "child-session-1",
        agentName: "reviewer",
        status: "wrapping_up",
        hardDeadlineAt: "2026-07-09T00:30:00.000Z",
      },
      {
        sessionId: "child-session-1",
        requestId: "child-request-1",
        phase: "orchestration",
        sequence: 3,
        scope,
      },
    ),
  );

  const parentRun = state.sessions[TestSessionId].runs.find((run) => run.requestId === TestRequestId);
  const childStep = parentRun.steps.find((step) => step.id === "child-run:child-run-1");
  expect(state.sessions["child-session-1"]).toBeUndefined();
  expect(childStep).toMatchObject({
    kind: "delegation",
    status: "running",
    scope: { parentSessionId: TestSessionId, childRunId: "child-run-1" },
    childRun: {
      id: "child-run-1",
      status: "wrapping_up",
      checkpointAvailable: true,
      modelOutputCharacters: 420,
      activeTools: ["WorkspaceRead"],
      artifactCount: 1,
      grantedExtensionMs: 60000,
      hardDeadlineAt: "2026-07-09T00:30:00.000Z",
    },
  });
});

test("child-run messages remain in the delegation step and deduplicate by message id", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "Review the workspace" }));
  const scope = childScope("child-run-messages");
  const identity = {
    childRunId: "child-run-messages",
    ownerRunId: TestRequestId,
    nodeId: "review-node",
    childSessionId: "child-session-messages",
    agentName: "reviewer",
    status: "running",
  };

  applyEvent(
    state,
    createEvent(
      EventKinds.ChildRunMessageCreated,
      {
        ...identity,
        messageId: "message-parent",
        direction: "parent_to_child",
        messageKind: "follow_up",
        content: "请先检查配置入口。",
      },
      {
        scope,
        timestamp: "2026-07-09T00:00:02.000Z",
        eventId: "event-parent-message",
      },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.AssistantMessageCreated,
      {
        messageId: "assistant-child-final",
        kind: "final_answer",
        content: "完整结果已整理。",
        terminal: true,
      },
      {
        scope,
        timestamp: "2026-07-09T00:00:05.000Z",
        eventId: "event-child-assistant-final",
      },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ChildRunMessageCreated,
      {
        ...identity,
        messageId: "message-child",
        direction: "child_to_parent",
        messageKind: "response",
        content: "配置入口位于 Source/AgentSystem。",
      },
      {
        scope,
        timestamp: "2026-07-09T00:00:03.000Z",
        eventId: "event-child-message",
      },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ChildRunMessageCreated,
      {
        ...identity,
        messageId: "message-child",
        direction: "child_to_parent",
        messageKind: "response",
        content: "配置入口位于 Source/AgentSystem，已确认。",
      },
      {
        scope,
        timestamp: "2026-07-09T00:00:04.000Z",
        eventId: "event-child-message-replay",
      },
    ),
  );

  const run = state.sessions[TestSessionId].runs[0];
  const step = run.steps.find((entry) => entry.id === "child-run:child-run-messages");
  expect(state.childSessionParentIds).toEqual({ "child-session-messages": TestSessionId });
  expect(step?.childRun?.messages).toEqual([
    {
      id: "message-parent",
      direction: "parent_to_child",
      kind: "follow_up",
      content: "请先检查配置入口。",
      createdAt: "2026-07-09T00:00:02.000Z",
    },
    {
      id: "message-child",
      direction: "child_to_parent",
      kind: "response",
      content: "配置入口位于 Source/AgentSystem，已确认。",
      createdAt: "2026-07-09T00:00:04.000Z",
    },
    {
      id: "assistant:assistant-child-final",
      direction: "child_to_parent",
      kind: "response",
      content: "完整结果已整理。",
      createdAt: "2026-07-09T00:00:05.000Z",
    },
  ]);
  expect(step?.description).toContain("完整结果已整理。");
});

test("child-run cancellation progress remains visible while the runtime settles in the background", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "Stop the delegated review" }));
  const scope = childScope("child-run-cancelling");
  const identity = {
    childRunId: "child-run-cancelling",
    childSessionId: "child-session-cancelling",
    agentName: "reviewer",
    status: "cancelling",
    contextMode: "fresh",
  };

  applyEvent(
    state,
    createEvent(EventKinds.ChildRunCancelling, identity, {
      sessionId: "child-session-cancelling",
      requestId: "child-request-cancelling",
      scope,
    }),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.RunCancellationProgress,
      { stage: "settlement_delayed", component: "pi_session", durationMs: 15000 },
      {
        sessionId: "child-session-cancelling",
        requestId: "child-request-cancelling",
        scope,
        timestamp: "2026-07-09T00:00:15.000Z",
      },
    ),
  );

  const step = state.sessions[TestSessionId].runs[0].steps.find(
    (entry) => entry.id === "child-run:child-run-cancelling",
  );
  expect(step).toMatchObject({
    kind: "delegation",
    status: "cancelling",
    childRun: {
      status: "cancelling",
      cancellation: {
        stage: "settlement_delayed",
        component: "pi_session",
        durationMs: 15000,
        updatedAt: "2026-07-09T00:00:15.000Z",
      },
    },
  });
  expect(step?.description).toContain("正在后台安全回收");
});

test("an out-of-order child assistant event cannot become a parent chat answer", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "Review the workspace" }));

  applyEvent(
    state,
    createEvent(
      EventKinds.AssistantMessageCreated,
      {
        messageId: "assistant-child-first",
        kind: "final_answer",
        content: "子代理先到达的结果。",
        terminal: true,
      },
      {
        scope: childScope("child-run-out-of-order"),
        timestamp: "2026-07-09T00:00:05.000Z",
        eventId: "event-child-assistant-first",
      },
    ),
  );

  const run = state.sessions[TestSessionId].runs[0];
  expect(run.steps).toHaveLength(2);
  expect(run.steps.find((step) => step.kind === "answer")).toBeUndefined();
  expect(run.steps.find((step) => step.id === "child-run:child-run-out-of-order")).toMatchObject({
    kind: "delegation",
    status: "done",
    childRun: {
      status: "completed",
      messages: [
        expect.objectContaining({
          direction: "child_to_parent",
          content: "子代理先到达的结果。",
        }),
      ],
    },
  });
});

function childScope(childRunId) {
  return {
    parentSessionId: TestSessionId,
    parentRequestId: TestRequestId,
    childRunId,
    agentName: "reviewer",
    role: "childAgent",
  };
}
