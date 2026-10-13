import { expect, test } from "vitest";

const { projectAssistantTurns, readAssistantTurnActionMessage } =
  await import("../../../Frontend/src/features/chat/assistantTurnProjection.ts");
const { projectAssistantTurnStages } =
  await import("../../../Frontend/src/features/chat/assistantTurnStageProjection.ts");
const { splitStageChildRuns } = await import("../../../Frontend/src/features/workflow/feedModel.ts");
const { createApproval, createMessage, createRun, stageMarker, stageTool } =
  await import("./chatCoreComponentFixtures.mjs");
test("assistant turn stages group consecutive tool batches until the next assistant message", () => {
  const requestId = "request-batches-without-prefaces";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const preface = createMessage({
    id: "first-batch-preface",
    requestId,
    kind: "AssistantToolPreface",
    content: "先搜索官方资料。",
    createdAt: startedAt,
  });
  const answer = createMessage({
    id: "batch-answer",
    requestId,
    kind: "AssistantFinal",
    content: "调查完成。",
    createdAt: "2026-01-01T00:00:03.000Z",
  });
  const run = createRun({
    requestId,
    status: "completed",
    steps: [
      stageMarker(requestId, preface, "decision", "tool_preface", startedAt),
      {
        ...stageTool("search-first", "WebSearch", startedAt),
        toolBatch: { id: "search-round-one", index: 0, size: 1, executionMode: "parallel" },
      },
      {
        ...stageTool("search-second", "WebSearch", "2026-01-01T00:00:01.000Z"),
        toolBatch: { id: "search-round-two", index: 0, size: 1, executionMode: "parallel" },
      },
      {
        ...stageTool("fetch-third", "WebFetch", "2026-01-01T00:00:02.000Z"),
        toolBatch: { id: "fetch-round-three", index: 0, size: 1, executionMode: "parallel" },
      },
      stageMarker(requestId, answer, "answer", "final_answer", answer.createdAt),
    ],
  });

  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: startedAt,
    messages: [preface, answer],
    run,
    streaming: false,
  });

  expect(stages).toHaveLength(2);
  expect(stages[0]).toMatchObject({ kind: "execution", message: preface, current: false });
  expect(stages[0].run?.steps.map((step) => step.id)).toEqual(["search-first", "search-second", "fetch-third"]);
  expect(stages[1]).toMatchObject({ kind: "final", message: answer, current: false, run: undefined });
});

test("model thinking does not create separate assistant stages", () => {
  const requestId = "request-thinking-stages";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const preface = createMessage({
    id: "thinking-preface",
    requestId,
    kind: "AssistantToolPreface",
    content: "先读取相关文件。",
    createdAt: startedAt,
  });
  const answer = createMessage({
    id: "thinking-answer",
    requestId,
    kind: "AssistantFinal",
    content: "检查完成。",
    createdAt: "2026-01-01T00:00:02.000Z",
  });
  const run = createRun({
    requestId,
    status: "completed",
    steps: [
      { id: `${requestId}-model-1`, kind: "model", agentStep: 1, title: "model 1", status: "done", startedAt },
      { ...stageMarker(requestId, preface, "decision", "tool_preface", startedAt), agentStep: 1 },
      stageTool("thinking-read", "WorkspaceRead", "2026-01-01T00:00:01.000Z"),
      {
        id: `${requestId}-model-2`,
        kind: "model",
        agentStep: 2,
        title: "model 2",
        status: "done",
        startedAt: answer.createdAt,
      },
      { ...stageMarker(requestId, answer, "answer", "final_answer", answer.createdAt), agentStep: 2 },
    ],
    thinkingBlocks: [
      { id: "thought-1", step: 1, messageIndex: 0, contentIndex: 0, content: "第一阶段思考。", status: "complete" },
      { id: "thought-2", step: 2, messageIndex: 0, contentIndex: 0, content: "第二阶段思考。", status: "complete" },
    ],
  });

  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: startedAt,
    messages: [preface, answer],
    run,
    streaming: false,
  });

  expect(stages).toHaveLength(2);
  expect(stages.map((stage) => stage.message)).toEqual([preface, answer]);
  expect(stages.every((stage) => !("thinkingBlocks" in stage))).toBe(true);
});

test("model thinking messages remain in the same assistant turn regardless of message index", () => {
  const requestId = "request-thinking-message-index";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const preface = createMessage({
    id: "indexed-thinking-preface",
    requestId,
    kind: "AssistantToolPreface",
    content: "读取文件。",
    createdAt: startedAt,
  });
  const answer = createMessage({
    id: "indexed-thinking-answer",
    requestId,
    kind: "AssistantFinal",
    content: "检查完成。",
    createdAt: "2026-01-01T00:00:02.000Z",
  });
  const run = createRun({
    requestId,
    status: "completed",
    steps: [
      { id: `${requestId}-model-1`, kind: "model", agentStep: 1, title: "model 1", status: "done", startedAt },
      { ...stageMarker(requestId, preface, "decision", "tool_preface", startedAt), agentStep: 1, modelMessageIndex: 0 },
      stageTool("indexed-read", "WorkspaceRead", "2026-01-01T00:00:01.000Z"),
      {
        id: `${requestId}-model-2`,
        kind: "model",
        agentStep: 1,
        title: "model 2",
        status: "done",
        startedAt: answer.createdAt,
      },
      {
        ...stageMarker(requestId, answer, "answer", "final_answer", answer.createdAt),
        agentStep: 1,
        modelMessageIndex: 1,
      },
    ],
    thinkingBlocks: [
      {
        id: "thought-preface",
        step: 1,
        messageIndex: 0,
        contentIndex: 0,
        content: "第一条模型回复。",
        status: "complete",
      },
      {
        id: "thought-answer",
        step: 1,
        messageIndex: 1,
        contentIndex: 0,
        content: "第二条模型回复。",
        status: "complete",
      },
    ],
  });

  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: startedAt,
    messages: [preface, answer],
    run,
    streaming: false,
  });

  expect(stages).toHaveLength(2);
  expect(stages.map((stage) => stage.message)).toEqual([preface, answer]);
  expect(stages.every((stage) => !("thinkingBlocks" in stage))).toBe(true);
});

test("assistant stages preserve thinking, tool execution, later thinking, and final answer order", () => {
  const requestId = "request-interleaved-response-order";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const answer = createMessage({
    id: "ordered-final-answer",
    requestId,
    kind: "AssistantFinal",
    content: "两次检查都完成。",
    createdAt: "2026-01-01T00:00:08.000Z",
  });
  const run = createRun({
    requestId,
    status: "completed",
    steps: [
      {
        id: `${requestId}-model-7-0`,
        kind: "model",
        agentStep: 7,
        modelMessageIndex: 0,
        eventSequence: 1,
        title: "model response 0",
        status: "done",
        startedAt,
      },
      {
        id: "tool-plan-a",
        kind: "tool",
        agentStep: 7,
        modelMessageIndex: 0,
        modelContentIndex: 1,
        eventSequence: 3,
        title: "plan A",
        status: "done",
        startedAt,
      },
      {
        ...stageTool("tool-a", "WorkspaceRead", "2026-01-01T00:00:01.000Z"),
        agentStep: 7,
        modelMessageIndex: 0,
        modelContentIndex: 1,
        eventSequence: 4,
        startedSequence: 4,
      },
      {
        id: `${requestId}-model-7-1`,
        kind: "model",
        agentStep: 7,
        modelMessageIndex: 1,
        eventSequence: 5,
        title: "model response 1",
        status: "done",
        startedAt: "2026-01-01T00:00:02.000Z",
      },
      {
        id: "tool-plan-b",
        kind: "tool",
        agentStep: 7,
        modelMessageIndex: 1,
        modelContentIndex: 1,
        eventSequence: 7,
        title: "plan B",
        status: "done",
        startedAt: "2026-01-01T00:00:02.000Z",
      },
      {
        ...stageTool("tool-b", "WorkspaceGrep", "2026-01-01T00:00:03.000Z"),
        agentStep: 7,
        modelMessageIndex: 1,
        modelContentIndex: 1,
        eventSequence: 8,
        startedSequence: 8,
      },
      {
        id: `${requestId}-model-7-2`,
        kind: "model",
        agentStep: 7,
        modelMessageIndex: 2,
        eventSequence: 9,
        title: "model response 2",
        status: "done",
        startedAt: "2026-01-01T00:00:07.000Z",
      },
      {
        ...stageMarker(requestId, answer, "answer", "final_answer", answer.createdAt),
        agentStep: 7,
        modelMessageIndex: 2,
        modelContentIndex: 1,
        eventSequence: 11,
      },
    ],
    thinkingBlocks: [
      {
        id: "thinking-a",
        step: 7,
        messageIndex: 0,
        contentIndex: 0,
        eventSequence: 2,
        content: "先检查文件结构。",
        status: "complete",
      },
      {
        id: "thinking-b",
        step: 7,
        messageIndex: 1,
        contentIndex: 0,
        eventSequence: 6,
        content: "再搜索引用位置。",
        status: "complete",
      },
      {
        id: "thinking-c",
        step: 7,
        messageIndex: 2,
        contentIndex: 0,
        eventSequence: 10,
        content: "汇总检查结果。",
        status: "complete",
      },
    ],
  });

  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: startedAt,
    messages: [answer],
    run,
    streaming: false,
  });

  expect(stages.map((stage) => [stage.agentStep, stage.modelMessageIndex])).toEqual([
    [7, 0],
    [7, 1],
    [7, 2],
  ]);
  expect(stages[0]?.run?.steps.map((step) => step.id)).toEqual(["tool-plan-a", "tool-a"]);
  expect(stages[1]?.run?.steps.map((step) => step.id)).toEqual(["tool-plan-b", "tool-b"]);
  expect(
    stages.flatMap((stage) =>
      (stage.responseItems ?? []).flatMap((item) =>
        item.kind === "thinking"
          ? item.blocks.map((block) => `thinking:${block.id}`)
          : item.kind === "message"
            ? [`message:${item.message.id}`]
            : item.run.steps.filter((step) => step.toolName).map((step) => `tool:${step.id}`),
      ),
    ),
  ).toEqual([
    "thinking:thinking-a",
    "tool:tool-a",
    "thinking:thinking-b",
    "tool:tool-b",
    "thinking:thinking-c",
    `message:${answer.id}`,
  ]);
});

test("response stages aggregate calls by tool batch and keep the activity identity stable as calls arrive", () => {
  const requestId = "request-parallel-tool-batch";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const project = (tools) =>
    projectAssistantTurnStages({
      __assistantTurn: true,
      key: `assistant-turn:${requestId}:0`,
      requestId,
      createdAt: startedAt,
      messages: [],
      streaming: true,
      run: createRun({
        requestId,
        status: "running",
        activeModelRequest: { agentStep: 3, modelMessageIndex: 0, eventSequence: 1 },
        steps: [
          {
            id: `${requestId}-model-3-0`,
            kind: "model",
            agentStep: 3,
            modelMessageIndex: 0,
            eventSequence: 1,
            title: "model response",
            status: "running",
            startedAt,
          },
          ...tools.map(({ id, toolName, batchId, index, sequence }) => ({
            ...stageTool(id, toolName, startedAt, "running"),
            agentStep: 3,
            modelMessageIndex: 0,
            modelContentIndex: 1,
            eventSequence: sequence,
            startedSequence: sequence,
            toolBatch: { id: batchId, index, size: 2, executionMode: "parallel" },
          })),
        ],
      }),
    });
  const firstOnly = project([
    { id: "read-one", toolName: "WorkspaceRead", batchId: "inspect-files", index: 0, sequence: 2 },
  ]);
  const completeBatch = project([
    { id: "read-one", toolName: "WorkspaceRead", batchId: "inspect-files", index: 0, sequence: 2 },
    { id: "read-two", toolName: "WorkspaceRead", batchId: "inspect-files", index: 1, sequence: 3 },
    { id: "list-three", toolName: "WorkspaceList", batchId: "list-files", index: 0, sequence: 4 },
  ]);
  const executions = (stages) => stages[0]?.responseItems?.filter((item) => item.kind === "execution") ?? [];
  const firstExecution = executions(firstOnly)[0];
  const groupedExecutions = executions(completeBatch);

  expect(firstExecution?.id).toBe("execution:batch:inspect-files");
  expect(groupedExecutions.map((item) => item.id)).toEqual([
    "execution:batch:inspect-files",
    "execution:batch:list-files",
  ]);
  expect(groupedExecutions[0]?.run.steps.map((step) => step.id)).toEqual(["read-one", "read-two"]);
  expect(groupedExecutions[1]?.run.steps.map((step) => step.id)).toEqual(["list-three"]);
});

test("delegated execution stays in its parent response stage and inside the child-run card", () => {
  const requestId = "request-child-run-stage-scope";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const answer = createMessage({
    id: "child-run-stage-answer",
    requestId,
    kind: "AssistantFinal",
    content: "子代理检查完成。",
    createdAt: "2026-01-01T00:00:05.000Z",
  });
  const childRunId = "child-run-stage-1";
  const unrelatedChildRunId = "child-run-stage-2";
  const run = createRun({
    requestId,
    status: "completed",
    steps: [
      {
        id: `${requestId}-model-1-0`,
        kind: "model",
        agentStep: 1,
        modelMessageIndex: 0,
        eventSequence: 1,
        title: "model response",
        status: "done",
        startedAt,
      },
      {
        ...stageMarker(requestId, answer, "answer", "final_answer", answer.createdAt),
        agentStep: 1,
        modelMessageIndex: 1,
        modelContentIndex: 2,
        eventSequence: 12,
      },
      {
        id: `child-run:${childRunId}`,
        kind: "delegation",
        agentStep: 1,
        modelMessageIndex: 0,
        eventSequence: 3,
        title: "reviewer",
        status: "done",
        startedAt: "2026-01-01T00:00:01.000Z",
        scope: {
          parentAgentStep: 1,
          parentModelMessageIndex: 0,
          parentModelContentIndex: 0,
          parentToolCallId: "spawn-call-1",
          childRunId,
        },
        childRun: {
          id: childRunId,
          status: "completed",
          messages: [],
          toolCalls: { planned: 1, started: 1, completed: 1, failed: 0 },
        },
      },
      {
        id: "child-tool-1",
        kind: "tool",
        title: "WorkspaceRead",
        status: "done",
        toolName: "WorkspaceRead",
        eventSequence: 5,
        startedAt: "2026-01-01T00:00:02.000Z",
        scope: { parentAgentStep: 1, parentModelMessageIndex: 0, childRunId },
      },
      {
        id: `child-run:${unrelatedChildRunId}`,
        kind: "delegation",
        agentStep: 1,
        modelMessageIndex: 1,
        eventSequence: 9,
        title: "scout",
        status: "done",
        startedAt: "2026-01-01T00:00:03.000Z",
        scope: {
          parentAgentStep: 1,
          parentModelMessageIndex: 1,
          parentModelContentIndex: 0,
          parentToolCallId: "spawn-call-2",
          childRunId: unrelatedChildRunId,
        },
        childRun: { id: unrelatedChildRunId, status: "completed", messages: [] },
      },
      {
        ...stageTool("spawn-call-1", "AgentSpawn", "2026-01-01T00:00:00.500Z"),
        agentStep: 1,
        modelMessageIndex: 0,
        modelContentIndex: 0,
        eventSequence: 2,
        startedSequence: 2,
      },
      {
        ...stageTool("spawn-call-2", "AgentSpawn", "2026-01-01T00:00:02.500Z"),
        agentStep: 1,
        modelMessageIndex: 1,
        modelContentIndex: 0,
        eventSequence: 8,
        startedSequence: 8,
      },
      {
        id: "parent-tool-1",
        kind: "tool",
        agentStep: 1,
        modelMessageIndex: 1,
        modelContentIndex: 1,
        title: "WorkspaceRead",
        status: "done",
        toolName: "WorkspaceRead",
        eventSequence: 10,
        startedAt: "2026-01-01T00:00:04.000Z",
      },
    ],
  });

  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: startedAt,
    messages: [answer],
    run,
    streaming: false,
  });

  expect(stages).toHaveLength(2);
  const spawnStage = stages[0];
  expect(spawnStage?.modelMessageIndex).toBe(0);
  expect(spawnStage?.run?.steps.map((step) => step.id)).toEqual([
    "spawn-call-1",
    `child-run:${childRunId}`,
    "child-tool-1",
  ]);
  expect(stages[1]?.run?.steps.map((step) => step.id)).toEqual([
    "spawn-call-2",
    `child-run:${unrelatedChildRunId}`,
    "parent-tool-1",
  ]);
  expect(spawnStage?.responseItems?.map((item) => [item.kind, item.modelContentIndex, item.eventSequence])).toEqual([
    ["execution", 0, 2],
    ["execution", 0, 3],
  ]);
  expect(stages[1]?.responseItems?.map((item) => [item.kind, item.modelContentIndex, item.eventSequence])).toEqual([
    ["execution", 0, 8],
    ["execution", 0, 9],
    ["execution", 1, 10],
    ["message", 2, 12],
  ]);

  const split = splitStageChildRuns(spawnStage.run.steps);
  expect(split.childRuns).toHaveLength(1);
  expect(split.childRuns[0]?.childRun.id).toBe(childRunId);
  expect(split.childRuns[0]?.childToolSteps.map((step) => step.id)).toEqual(["child-tool-1"]);
  expect(split.rootToolSteps.map((step) => step.id)).toEqual(["spawn-call-1"]);
});

test("legacy tool steps without response indexes remain visible beside indexed thinking", () => {
  const requestId = "request-legacy-tool-association";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const preface = createMessage({
    id: "legacy-preface",
    requestId,
    kind: "AssistantToolPreface",
    content: "我先检查项目文件。",
    createdAt: startedAt,
  });
  const answer = createMessage({
    id: "legacy-answer",
    requestId,
    kind: "AssistantFinal",
    content: "检查完成。",
    createdAt: "2026-01-01T00:00:02.000Z",
  });
  const run = createRun({
    requestId,
    status: "completed",
    steps: [
      {
        id: `${requestId}-model-1-0`,
        kind: "model",
        agentStep: 1,
        modelMessageIndex: 0,
        eventSequence: 1,
        title: "model response",
        status: "done",
        startedAt,
      },
      {
        ...stageMarker(requestId, preface, "decision", "tool_preface", startedAt),
        agentStep: 1,
        modelMessageIndex: 0,
        modelContentIndex: 0,
      },
      stageTool("legacy-read", "WorkspaceRead", "2026-01-01T00:00:01.000Z"),
      {
        ...stageMarker(requestId, answer, "answer", "final_answer", answer.createdAt),
        agentStep: 1,
        modelMessageIndex: 1,
        modelContentIndex: 0,
      },
    ],
    thinkingBlocks: [
      {
        id: "legacy-thinking",
        step: 1,
        messageIndex: 0,
        contentIndex: 1,
        content: "先确认项目目录。",
        status: "complete",
      },
    ],
  });

  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: startedAt,
    messages: [preface, answer],
    run,
    streaming: false,
  });

  expect(stages[0]?.message).toBe(preface);
  expect(stages[0]?.responseItems).toBeUndefined();
  expect(stages[0]?.run?.steps.map((step) => step.id)).toEqual(["legacy-read"]);
  expect(stages[1]).toMatchObject({ message: answer });
});

test("assistant turn stages retain tool-only activity before the first persisted preface", () => {
  const requestId = "request-leading-tool-activity";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const preface = createMessage({
    id: "late-preface",
    requestId,
    kind: "AssistantToolPreface",
    content: "我再核对公开信息。",
    createdAt: "2026-01-01T00:00:03.000Z",
  });
  const answer = createMessage({
    id: "late-preface-answer",
    requestId,
    kind: "AssistantFinal",
    content: "核对完成。",
    createdAt: "2026-01-01T00:00:05.000Z",
  });
  const run = createRun({
    requestId,
    status: "completed",
    steps: [
      stageTool("leading-open", "BrowserOpen", startedAt),
      stageTool("leading-read", "BrowserRead", "2026-01-01T00:00:01.000Z"),
      stageTool("leading-search", "WebSearch", "2026-01-01T00:00:02.000Z"),
      stageMarker(requestId, preface, "decision", "tool_preface", preface.createdAt),
      stageTool("prefaced-fetch", "WebFetch", "2026-01-01T00:00:04.000Z"),
      stageMarker(requestId, answer, "answer", "final_answer", answer.createdAt),
    ],
  });

  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: startedAt,
    messages: [preface, answer],
    run,
    streaming: false,
  });

  const executionStages = stages.filter((stage) => stage.kind === "execution");
  const projectedToolIds = executionStages.flatMap((stage) =>
    (stage.run?.steps ?? []).filter((step) => step.kind === "tool" && step.toolName).map((step) => step.id),
  );

  expect(executionStages).toHaveLength(2);
  expect(executionStages[0]).toMatchObject({ message: undefined });
  expect(executionStages[0].run?.steps.map((step) => step.id)).toEqual([
    "leading-open",
    "leading-read",
    "leading-search",
  ]);
  expect(executionStages[1]).toMatchObject({ message: preface });
  expect(executionStages[1].run?.steps.map((step) => step.id)).toEqual(["prefaced-fetch"]);
  expect(projectedToolIds).toEqual(["leading-open", "leading-read", "leading-search", "prefaced-fetch"]);
  expect(new Set(projectedToolIds)).toHaveLength(projectedToolIds.length);
});

test("live execution keeps consecutive tool batches in the current preface stage", () => {
  const requestId = "request-live-tool-only-batch";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const preface = createMessage({
    id: "live-first-batch-preface",
    requestId,
    kind: "AssistantToolPreface",
    content: "先搜索官方资料。",
    createdAt: startedAt,
  });
  const run = createRun({
    requestId,
    status: "running",
    visibleKind: "tool_calls",
    displayMessageId: preface.id,
    steps: [
      stageMarker(requestId, preface, "decision", "tool_preface", startedAt),
      {
        ...stageTool("live-search-first", "WebSearch", startedAt),
        toolBatch: { id: "live-search-round-one", index: 0, size: 1, executionMode: "parallel" },
      },
      {
        ...stageTool("live-fetch-second", "WebFetch", "2026-01-01T00:00:01.000Z", "running"),
        toolBatch: { id: "live-fetch-round-two", index: 0, size: 1, executionMode: "parallel" },
      },
    ],
  });

  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: startedAt,
    messages: [preface],
    run,
    streaming: true,
  });

  expect(stages).toHaveLength(1);
  expect(stages[0]).toMatchObject({ message: preface, current: true });
  expect(stages[0].run?.steps.map((step) => step.id)).toEqual(["live-search-first", "live-fetch-second"]);
});

test("only the active assistant stage receives live execution state", () => {
  const requestId = "request-live-stage";
  const firstPreface = createMessage({
    id: "live-preface-1",
    requestId,
    kind: "AssistantToolPreface",
    content: "先读取入口。",
  });
  const secondPreface = createMessage({
    id: "live-preface-2",
    requestId,
    kind: "AssistantToolPreface",
    content: "继续执行检查。",
    createdAt: "2026-01-01T00:00:01.000Z",
  });
  const approval = createApproval();
  const run = createRun({
    requestId,
    startedAt: "2025-12-31T23:59:00.000Z",
    displayMessageId: secondPreface.id,
    visibleKind: "tool_calls",
    approvals: [approval],
    steps: [
      stageMarker(requestId, firstPreface, "decision", "tool_preface", firstPreface.createdAt),
      stageTool("live-tool-a", "WorkspaceRead", firstPreface.createdAt, "running"),
      stageMarker(requestId, secondPreface, "decision", "tool_preface", secondPreface.createdAt),
      stageTool("live-tool-b", "WorkspaceGrep", secondPreface.createdAt, "running"),
    ],
  });
  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: firstPreface.createdAt,
    messages: [firstPreface, secondPreface],
    run,
    streaming: true,
  });

  expect(stages[0]).toMatchObject({ current: false });
  expect(stages[0].run?.startedAt).toBe(run.startedAt);
  expect(stages[0].run).toMatchObject({ status: "completed", endedAt: secondPreface.createdAt });
  expect(stages[0].run?.steps).toEqual([
    expect.objectContaining({ id: "live-tool-a", status: "done", endedAt: secondPreface.createdAt }),
  ]);
  expect(stages[0].run?.approvals).toEqual([]);
  expect(stages[1]).toMatchObject({ current: true });
  expect(stages[1].run?.startedAt).toBe(run.startedAt);
  expect(stages[1].run?.status).toBe("running");
  expect(stages[1].run?.steps.map((step) => step.id)).toEqual(["live-tool-b"]);
  expect(stages[1].run?.approvals).toEqual([approval]);
});

test("a live execution stage keeps tools visible before its preface message is persisted", () => {
  const requestId = "request-transient-stage";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const transientMessageId = "transient-preface";
  const run = createRun({
    requestId,
    displayMessageId: transientMessageId,
    displayText: "正在检查工作区。",
    visibleKind: "tool_preface",
    steps: [
      stageMarker(
        requestId,
        { id: transientMessageId, content: "正在检查工作区。" },
        "decision",
        "tool_preface",
        startedAt,
      ),
      stageTool("transient-tool", "WorkspaceRead", startedAt, "running"),
    ],
  });

  const stages = projectAssistantTurnStages({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: startedAt,
    messages: [],
    run,
    streaming: true,
  });

  expect(stages).toHaveLength(1);
  expect(stages[0]).toMatchObject({ kind: "execution", current: true });
  expect(stages[0].message).toBeUndefined();
  expect(stages[0].run?.steps.map((step) => step.id)).toEqual(["transient-tool"]);
});

test("assistant turn projection preserves conversation boundaries and targets the terminal message", () => {
  const preface = createMessage({
    id: "projection-preface",
    requestId: "request-projection",
    kind: "AssistantToolPreface",
    content: "准备检查。",
  });
  const answer = createMessage({
    id: "projection-answer",
    requestId: "request-projection",
    kind: "AssistantFinal",
    content: "检查完成。",
  });
  const user = createMessage({
    id: "projection-user",
    requestId: "request-user",
    role: "user",
    content: "继续",
  });
  const laterPreface = createMessage({
    id: "projection-later-preface",
    requestId: "request-projection",
    kind: "AssistantToolPreface",
    content: "新的回复边界。",
  });

  const projected = projectAssistantTurns([preface, answer, user, laterPreface], []);

  expect(projected).toHaveLength(3);
  expect(projected[0]).toMatchObject({
    key: "assistant-turn:request-projection:0",
    messages: [preface, answer],
  });
  expect(projected[1]).toBe(user);
  expect(projected[2]).toMatchObject({
    key: "assistant-turn:request-projection:1",
    messages: [laterPreface],
  });
  expect(readAssistantTurnActionMessage(projected[0])).toBe(answer);
  expect(readAssistantTurnActionMessage(projected[2])).toBeUndefined();
});

test("assistant turn projection keeps an active run attached when a follow-up message is queued", () => {
  const preface = createMessage({
    id: "active-preface",
    requestId: "request-active",
    kind: "AssistantToolPreface",
    content: "仍在执行。",
  });
  const queuedUserMessage = createMessage({
    id: "queued-user",
    requestId: "request-queued",
    role: "user",
    content: "完成后继续。",
  });
  const activeRun = createRun({ requestId: "request-active" });

  const projected = projectAssistantTurns([preface, queuedUserMessage], [activeRun], activeRun);

  expect(projected).toHaveLength(2);
  expect(projected[0]).toMatchObject({ requestId: "request-active", run: activeRun, streaming: true });
  expect(projected[1]).toBe(queuedUserMessage);
});
