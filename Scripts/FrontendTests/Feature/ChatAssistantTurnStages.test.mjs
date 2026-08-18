import { expect, test } from "vitest";

const { projectAssistantTurns, readAssistantTurnActionMessage } =
  await import("../../../Frontend/src/features/chat/assistantTurnProjection.ts");
const { projectAssistantTurnStages } =
  await import("../../../Frontend/src/features/chat/assistantTurnStageProjection.ts");
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
