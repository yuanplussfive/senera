import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { EventKinds, EventSpecs } from "../../../Frontend/src/api/generatedEventCatalog.ts";
import { RuntimeDiagnosticPanel } from "../../../Frontend/src/features/observability/RuntimeDiagnosticPanel.tsx";
import {
  projectRuntimeConversationSpans,
  projectRuntimeDiagnosticFromRun,
} from "../../../Frontend/src/features/observability/runtimeDiagnosticProjection.ts";
import { rebuildRunFromHistory } from "../../../Frontend/src/store/session/historyRunProjection.ts";
import { useEventJournalStore } from "../../../Frontend/src/features/observability/eventJournalStore.ts";

beforeEach(() => {
  useEventJournalStore.setState({
    records: [],
    totalBytes: 0,
    recording: true,
    wireCapture: false,
    viewPausedAt: undefined,
    selectedId: undefined,
  });
});

afterEach(() => cleanup());

test("renders a linear Vinyasa event stream with one tool card per call", async () => {
  useEventJournalStore.setState({
    records: [
      projected(EventKinds.RunActivityChanged, 1, {
        activityId: "activity-1",
        activity: "running_agent_turn",
        state: "completed",
        startedAt: "2026-08-04T00:00:00.000Z",
        durationMs: 1200,
      }),
      projected(EventKinds.ToolCallStarted, 2, {
        index: 0,
        toolName: "search",
        callId: "call-1",
        startedAt: "2026-08-04T00:00:00.200Z",
      }),
      projected(EventKinds.ToolCallCompleted, 3, {
        index: 0,
        toolName: "search",
        callId: "call-1",
        startedAt: "2026-08-04T00:00:00.200Z",
        durationMs: 400,
      }),
    ],
    totalBytes: 384,
  });

  renderWithFrontendProviders(React.createElement(RuntimeDiagnosticPanel));

  expect(screen.getByRole("region", { name: "运行控制台" })).toBeVisible();
  expect(screen.getByRole("log")).toBeVisible();
  expect(screen.getByRole("button", { name: /search/ })).toBeVisible();
  expect(screen.getByRole("region", { name: "运行记录" })).toBeVisible();
  expect(document.querySelectorAll("[data-runtime-tool-call]")).toHaveLength(1);
  expect(document.querySelectorAll("[data-runtime-span-detail]")).toHaveLength(0);
  expect(document.querySelectorAll("[data-node-id]")).toHaveLength(0);

  const toolCard = screen.getByRole("button", { name: /search/ });
  expect(toolCard).toBeDisabled();
  expect(toolCard).not.toHaveAttribute("aria-expanded");
});

test("rebuilds a completed historical run from the durable run projection", () => {
  const model = projectRuntimeDiagnosticFromRun(
    {
      requestId: "request-history",
      revision: 2,
      startedAt: "2026-08-04T00:00:00.000Z",
      endedAt: "2026-08-04T00:00:02.000Z",
      status: "completed",
      outputState: "committed",
      input: "读取项目",
      activities: [],
      steps: [
        {
          id: "understand",
          kind: "understand",
          title: "理解请求",
          status: "done",
          startedAt: "2026-08-04T00:00:00.000Z",
          endedAt: "2026-08-04T00:00:00.100Z",
        },
        {
          id: "planned-tool",
          kind: "tool",
          title: "读取文件",
          status: "done",
          startedAt: "2026-08-04T00:00:00.200Z",
          endedAt: "2026-08-04T00:00:00.200Z",
          toolName: "WorkspaceRead",
          toolBatch: { id: "batch-1", size: 1, executionMode: "sequential" },
        },
        {
          id: "tool-1",
          kind: "tool",
          title: "读取文件",
          status: "done",
          startedAt: "2026-08-04T00:00:00.200Z",
          endedAt: "2026-08-04T00:00:01.000Z",
          durationMs: 800,
          toolName: "WorkspaceRead",
          callId: "call-1",
        },
        {
          id: "answer",
          kind: "answer",
          title: "生成回复",
          status: "done",
          startedAt: "2026-08-04T00:00:01.100Z",
          endedAt: "2026-08-04T00:00:02.000Z",
        },
      ],
      streamingRaw: "",
      xmlPreview: "",
      visibleText: "",
      displayText: "",
      visibleKind: "final_answer",
      expectedOutputMode: "final_text",
      decisionMode: "final_text",
    },
    { nowEpoch: Date.parse("2026-08-04T00:00:02.000Z") },
  );

  expect(model.requestId).toBe("request-history");
  expect(model.spans.map((span) => span.id)).toEqual([
    "run:request-history:understand",
    "run:request-history:tool-1",
    "run:request-history:answer",
  ]);
  expect(model.spans.every((span) => span.status !== "running")).toBe(true);
});

test("orders the user request before a same-time final response", () => {
  const model = projectRuntimeDiagnosticFromRun(
    {
      requestId: "request-order",
      revision: 1,
      startedAt: "2026-08-04T00:00:00.000Z",
      endedAt: "2026-08-04T00:00:01.000Z",
      status: "completed",
      outputState: "committed",
      input: "展示顺序",
      activities: [],
      steps: [
        {
          id: "answer",
          kind: "answer",
          title: "生成回复",
          status: "done",
          eventSequence: 2,
          startedAt: "2026-08-04T00:00:00.000Z",
          endedAt: "2026-08-04T00:00:01.000Z",
          description: "最终结果",
        },
        {
          id: "understand",
          kind: "understand",
          title: "理解请求",
          status: "done",
          startedAt: "2026-08-04T00:00:00.000Z",
          endedAt: "2026-08-04T00:00:00.000Z",
        },
      ],
      streamingRaw: "",
      xmlPreview: "",
      visibleText: "最终结果",
      displayText: "最终结果",
      visibleKind: "final_answer",
      expectedOutputMode: "final_text",
      decisionMode: "final_text",
    },
    { nowEpoch: Date.parse("2026-08-04T00:00:01.000Z") },
  );

  expect(model.spans.map((span) => span.kind)).toEqual(["understand", "answer"]);
});

test("deduplicates live and durable final answer projections", () => {
  const run = {
    requestId: "request-duplicate-answer",
    revision: 2,
    startedAt: "2026-08-04T00:00:00.000Z",
    endedAt: "2026-08-04T00:00:03.000Z",
    status: "completed",
    outputState: "committed",
    input: "展示最终回复",
    activities: [],
    steps: [
      {
        id: "request-duplicate-answer-understand",
        kind: "understand",
        title: "理解请求",
        status: "done",
        startedAt: "2026-08-04T00:00:00.000Z",
        endedAt: "2026-08-04T00:00:00.100Z",
      },
      {
        id: "request-duplicate-answer-assistant-message-message-1",
        kind: "answer",
        decisionKind: "final_answer",
        title: "生成回复",
        description: "最终结果",
        detailJson: { messageId: "message-1", kind: "final_answer", content: "最终结果" },
        status: "done",
        startedAt: "2026-08-04T00:00:02.000Z",
        endedAt: "2026-08-04T00:00:02.100Z",
      },
      {
        id: "1-answer-0",
        kind: "answer",
        decisionKind: "final_answer",
        title: "生成回复",
        status: "done",
        startedAt: "2026-08-04T00:00:00.000Z",
        endedAt: "2026-08-04T00:00:03.000Z",
      },
    ],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "最终结果",
    displayText: "最终结果",
    visibleKind: "final_answer",
    expectedOutputMode: "final_text",
    decisionMode: "final_text",
  };

  const spans = projectRuntimeConversationSpans([], [run], { activeSessionId: "session-1" });

  expect(spans.filter((span) => span.kind === "answer")).toHaveLength(1);
  expect(spans.find((span) => span.kind === "answer")).toMatchObject({
    id: "run:request-duplicate-answer:request-duplicate-answer-assistant-message-message-1",
    startedAtEpoch: Date.parse("2026-08-04T00:00:02.000Z"),
  });
});

test("anchors a durable answer trace to its terminal timestamp", () => {
  const run = rebuildRunFromHistory({
    requestId: "request-answer-time",
    startedAt: "2026-08-04T00:00:00.000Z",
    endedAt: "2026-08-04T00:00:03.000Z",
    status: "completed",
    input: "检查回复时间",
    traces: [
      {
        step: 1,
        seq: 0,
        kind: "answer",
        decisionKind: "final_answer",
        status: "done",
        endedAt: "2026-08-04T00:00:03.000Z",
      },
    ],
  });

  expect(run.steps[0]).toMatchObject({
    kind: "answer",
    startedAt: "2026-08-04T00:00:03.000Z",
    endedAt: "2026-08-04T00:00:03.000Z",
  });
});

test("projects native reasoning blocks as ordered thinking events", () => {
  const model = projectRuntimeDiagnosticFromRun(
    {
      requestId: "request-thinking",
      revision: 1,
      startedAt: "2026-08-04T00:00:00.000Z",
      status: "running",
      outputState: "streaming",
      input: "读取项目",
      steps: [
        {
          id: "model-0",
          kind: "model",
          agentStep: 0,
          modelMessageIndex: 0,
          eventSequence: 1,
          title: "调用模型",
          status: "running",
          startedAt: "2026-08-04T00:00:00.000Z",
        },
      ],
      thinkingBlocks: [
        {
          id: "step:0:message:0:content:0",
          step: 0,
          messageIndex: 0,
          contentIndex: 0,
          eventSequence: 2,
          content: "先检查项目结构。",
          status: "streaming",
        },
        {
          id: "step:0:message:0:content:1",
          step: 0,
          messageIndex: 0,
          contentIndex: 1,
          eventSequence: 3,
          content: "随后读取配置。",
          status: "streaming",
        },
      ],
      streamingRaw: "",
      xmlPreview: "",
      visibleText: "",
      displayText: "",
      visibleKind: "unknown",
      expectedOutputMode: "unknown",
      decisionMode: "none",
    },
    { nowEpoch: Date.parse("2026-08-04T00:00:01.000Z") },
  );

  expect(model.spans.map((span) => span.id)).toEqual([
    "run:request-thinking:model-0",
    "run:request-thinking:thinking:0:0",
  ]);
  expect(model.spans[1]).toMatchObject({
    isThinking: true,
    status: "running",
    label: "先检查项目结构。...",
    description: "先检查项目结构。 随后读取配置。",
  });
});

test("keeps the total stream complete without journal echoes", () => {
  const run = {
    requestId: "request-session",
    revision: 3,
    startedAt: "2026-08-04T00:00:00.000Z",
    endedAt: "2026-08-04T00:00:03.000Z",
    status: "completed",
    outputState: "committed",
    input: "查询苏州天气",
    modelProvider: { provider: "local", model: "ternlight-mini-cn" },
    steps: [
      {
        id: "understand",
        kind: "understand",
        title: "理解请求",
        status: "done",
        startedAt: "2026-08-04T00:00:00.000Z",
        endedAt: "2026-08-04T00:00:00.100Z",
      },
      {
        id: "model-0",
        kind: "model",
        title: "调用模型",
        modelName: "ternlight-mini-cn",
        agentStep: 0,
        modelMessageIndex: 0,
        eventSequence: 2,
        status: "done",
        startedAt: "2026-08-04T00:00:00.200Z",
        endedAt: "2026-08-04T00:00:01.000Z",
      },
      {
        id: "pre-response",
        kind: "decision",
        title: "预回复",
        description: "将要查询天气……",
        detailJson: { content: "我先确认苏州的天气数据，再给出简洁的结果。" },
        status: "done",
        startedAt: "2026-08-04T00:00:01.050Z",
        endedAt: "2026-08-04T00:00:01.100Z",
      },
      {
        id: "answer",
        kind: "answer",
        title: "生成回复",
        description: "苏州今天晴……",
        detailJson: { content: "苏州今天晴，气温适中。建议携带薄外套。" },
        status: "done",
        startedAt: "2026-08-04T00:00:01.100Z",
        endedAt: "2026-08-04T00:00:03.000Z",
      },
    ],
    thinkingBlocks: [
      {
        id: "step:0:message:0:content:0",
        step: 0,
        messageIndex: 0,
        contentIndex: 0,
        eventSequence: 3,
        content: "先确认城市。",
        status: "complete",
      },
    ],
    displayText: "苏州今天晴，气温适中。",
    visibleText: "苏州今天晴，气温适中。",
  };
  const records = [
    projected(EventKinds.RunStarted, 1, {}),
    projected(EventKinds.PromptSummary, 2, { chars: 12, lines: 1, tokenCount: 8 }),
    projected(EventKinds.ContinuitySnapshot, 3, { enabled: true }),
    projected(EventKinds.ToolCallStarted, 4, { toolName: "weather", callId: "call-1" }),
    projected(EventKinds.ToolCallCompleted, 5, { toolName: "weather", callId: "call-1" }),
  ];
  const spans = projectRuntimeConversationSpans(records, [run], { activeSessionId: "session-1" });

  expect(spans.filter((span) => span.eventKind === EventKinds.ToolCallStarted)).toHaveLength(0);
  expect(spans.filter((span) => span.eventKind === EventKinds.ToolCallCompleted)).toHaveLength(0);
  expect(spans.some((span) => span.eventKind === EventKinds.PromptSummary)).toBe(true);
  expect(spans.some((span) => span.eventKind === EventKinds.ContinuitySnapshot)).toBe(true);
  expect(spans.filter((span) => span.isThinking)).toHaveLength(1);
  expect(spans.filter((span) => span.kind === "decision")).toHaveLength(1);
  expect(spans.find((span) => span.kind === "decision")).toMatchObject({
    description: "我先确认苏州的天气数据，再给出简洁的结果。",
  });
  expect(spans.find((span) => span.kind === "answer")).toMatchObject({
    description: "苏州今天晴，气温适中。建议携带薄外套。",
  });
});

function projected(kind, sequence, data) {
  const timestamp = "2026-08-04T00:00:00.000Z";
  return {
    id: `journal-${sequence}`,
    localSequence: sequence,
    connectionId: "ws-1",
    observedAt: timestamp,
    observedAtEpoch: Date.parse(timestamp),
    direction: "inbound",
    stage: "projected",
    kind,
    layer: EventSpecs[kind].layer,
    phase: EventSpecs[kind].phase,
    sequence,
    sessionId: "session-1",
    requestId: "request-1",
    step: 1,
    retainedByteLength: 128,
    projection: { data },
    projectionOmitted: false,
  };
}
