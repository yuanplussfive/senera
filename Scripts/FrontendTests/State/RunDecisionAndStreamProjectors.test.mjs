import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

test("decision events project prompt, route, planner stage, and fallback plan state", () => {
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
  applyEvent(
    state,
    createEvent(
      EventKinds.InteractionRouted,
      {
        mode: "tool_agent_loop",
        objective: "检查项目测试",
        needsFreshEvidence: true,
        needsWorkspaceRead: true,
        needsSideEffect: false,
        risk: "low",
        preferredTools: ["WorkspaceReadFile"],
        discoveryQueries: ["tests"],
        reason: "需要读取仓库证据",
        loadedTools: "all",
        expectedOutputMode: "open",
      },
      { step: 1, sequence: 3, phase: "decision" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ActionPlannerStageStarted,
      {
        stage: "understandUserTurn",
      },
      { step: 1, sequence: 4, phase: "decision" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ActionPlannerStageCompleted,
      {
        stage: "understandUserTurn",
        selectedAction: "CallTools",
        repaired: false,
        turnUnderstanding: {
          rawUserTurn: "检查项目测试",
          standaloneRequest: "检查项目测试覆盖情况",
          contextMode: "Used",
          contextBasis: "当前会话",
          missingContext: "",
        },
      },
      { step: 1, sequence: 5, phase: "decision" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.ActionPlanned,
      {
        status: "fallback",
        preferredTools: [],
        toolSearchQueries: [],
        loadedTools: [],
        reason: "planner unavailable",
      },
      { step: 2, sequence: 6, phase: "decision" },
    ),
  );

  const run = readTestRun(state);
  expect(run.expectedOutputMode).toBe("unknown");
  expect(run.steps.map((step) => [step.kind, step.status])).toEqual([
    ["understand", "done"],
    ["prompt", "done"],
    ["decision", "done"],
    ["decision", "done"],
    ["decision", "done"],
  ]);
  expect(run.steps.find((step) => step.kind === "prompt")).toMatchObject({
    promptChars: 1200,
    promptLines: 42,
    promptTokenCount: 330,
  });
  expect(run.steps.find((step) => step.id.includes("understandUserTurn"))).toMatchObject({
    status: "done",
    decisionKind: "CallTools",
  });
  expect(run.steps.at(-1)).toMatchObject({
    title: "规划行动 · 回退",
    decisionKind: undefined,
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

test("pi trace lifecycle merges started and completed events into one scoped step", () => {
  const state = createTestState();

  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "查上下文" }, { sequence: 1 }));
  applyEvent(
    state,
    createEvent(
      EventKinds.PiTrace,
      {
        source: "session",
        eventType: "message.started",
        summary: "pi started",
        payload: { phase: "start" },
      },
      {
        step: 1,
        sequence: 2,
        phase: "model",
        scope: { workflowName: "root", agentName: "pi" },
      },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.PiTrace,
      {
        source: "session",
        eventType: "message.completed",
        summary: "pi completed",
        payload: { phase: "done" },
      },
      {
        step: 1,
        sequence: 3,
        phase: "model",
        scope: { workflowName: "root", agentName: "pi" },
      },
    ),
  );

  const run = readTestRun(state);
  const piSteps = run.steps.filter((step) => step.kind === "pi");
  expect(piSteps).toHaveLength(1);
  expect(piSteps[0]).toMatchObject({
    id: "pi:session:message",
    status: "done",
    description: "pi completed",
    traceSource: "session",
    eventType: "message.completed",
    scope: { workflowName: "root", agentName: "pi" },
  });
});

function readTestRun(state) {
  const run = state.sessions[TestSessionId]?.runs.find((item) => item.requestId === TestRequestId);
  expect(run).toBeTruthy();
  return run;
}
