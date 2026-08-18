import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { AssistantMessageBody } = await import("../../../Frontend/src/features/chat/AssistantMessageBody.tsx");
const { AssistantTurnRow } = await import("../../../Frontend/src/features/chat/AssistantTurnRow.tsx");
const { StreamingRow } = await import("../../../Frontend/src/features/chat/StreamingRow.tsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("tool preface keeps its progress text without rendering a redundant badge", () => {
  renderWithFrontendProviders(
    React.createElement(AssistantMessageBody, {
      message: {
        kind: "AssistantToolPreface",
        content: "我先读取项目配置。",
      },
    }),
  );

  expect(screen.getByText("我先读取项目配置。")).toBeInTheDocument();
  expect(screen.queryByText("工具调用前回复")).not.toBeInTheDocument();
});

test("streaming assistant content uses the same readable body and caret for prefaces and answers", () => {
  renderWithFrontendProviders(
    React.createElement(AssistantMessageBody, {
      message: {
        kind: "AssistantFinal",
        content: "正在生成的回答",
      },
      streaming: true,
    }),
  );

  expect(document.querySelector("[data-assistant-streaming-body]")).toBeInTheDocument();
  expect(screen.getByText("正在生成的回答")).toBeInTheDocument();
  expect(document.querySelector("[data-assistant-streaming-body] .caret-blink")).toBeInTheDocument();
});

test("a live turn shows the quiet Thinking indicator before its first tool call", async () => {
  renderWithFrontendProviders(
    React.createElement(StreamingRow, {
      sessionId: "session-1",
      run: createRun(),
    }),
  );

  expect(await screen.findByText("Thinking...")).toBeInTheDocument();
  expect(document.querySelector("[data-ui-chrome] .motion-safe\\:animate-spin")).toBeInTheDocument();
  expect(screen.queryByText("Senera 正在思考…")).not.toBeInTheDocument();
});

test("live tool preface follows its execution status inside one assistant turn", async () => {
  renderWithFrontendProviders(
    React.createElement(StreamingRow, {
      run: createRun({
        visibleKind: "tool_preface",
        displayText: "搜索当前已加载的工具目录……",
        steps: [
          {
            id: "tool-step",
            kind: "tool",
            title: "搜索工作区",
            status: "running",
            startedAt: "2026-01-01T00:00:00.000Z",
            toolName: "WorkspaceGrep",
            callId: "call-workspace-grep",
          },
        ],
      }),
    }),
  );

  const turn = document.querySelector("[data-assistant-turn='request-1']");
  expect(turn).toBeInTheDocument();
  expect(turn).toContainElement(screen.getByText("搜索当前已加载的工具目录……"));
  expect(turn.querySelector("[data-assistant-streaming-body]")).toHaveTextContent("搜索当前已加载的工具目录……");
  expect(turn.querySelector("[data-assistant-turn-execution]")).toBeInTheDocument();
  const stage = turn.querySelector("[data-assistant-turn-stage='execution']");
  const body = turn.querySelector("[data-assistant-streaming-body]");
  const execution = stage.querySelector("[data-execution-stage-feed]") ?? stage.querySelector("[aria-hidden='true']");
  expect(execution).not.toBeNull();
  expect(body.compareDocumentPosition(execution) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(turn.querySelectorAll("[data-message-avatar='assistant']")).toHaveLength(1);
  expect(document.querySelectorAll(".conversation-frame--wide")).toHaveLength(1);
  expect(screen.getAllByText("搜索当前已加载的工具目录……")).toHaveLength(1);
  expect(screen.getByText("Thinking...")).toBeInTheDocument();
});

test("live tool activity remains visible while a later answer is streaming", async () => {
  renderWithFrontendProviders(
    React.createElement(StreamingRow, {
      sessionId: "session-1",
      run: createRun({
        visibleKind: "final_answer",
        displayText: "我正在整理结果。",
        steps: [
          {
            id: "tool-step",
            kind: "tool",
            title: "搜索工作区",
            status: "done",
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: "2026-01-01T00:00:01.000Z",
            toolName: "WorkspaceGrep",
            callId: "call-workspace-grep",
          },
        ],
      }),
    }),
  );

  expect(await screen.findByText("我正在整理结果。")).toBeInTheDocument();
  await waitFor(() => expect(document.querySelector("[data-tool-batch-activity]")).toBeInTheDocument());
  expect(document.querySelector("[data-tool-batch-activity-trigger]")).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Thinking...")).toBeInTheDocument();
  const execution = document.querySelector("[data-tool-batch-activity]");
  const answer = screen.getByText("我正在整理结果。");
  expect(execution.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
});

test("a persisted tool preface owns the live tool chain while the final answer streams", async () => {
  const preface = {
    id: "preface-1",
    requestId: "request-1",
    role: "assistant",
    kind: "AssistantToolPreface",
    content: "我先检查网页内容。",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const run = createRun({
    visibleKind: "final_answer",
    displayText: "页面内容已经整理完成。",
    steps: [
      {
        id: "request-1-assistant-message-preface-1",
        kind: "decision",
        title: preface.content,
        status: "done",
        startedAt: preface.createdAt,
        endedAt: preface.createdAt,
        decisionKind: "tool_preface",
      },
      {
        id: "tool-step",
        kind: "tool",
        title: "读取网页",
        status: "done",
        startedAt: "2026-01-01T00:00:01.000Z",
        endedAt: "2026-01-01T00:00:02.000Z",
        toolName: "BrowserRead",
        callId: "call-browser-read",
      },
    ],
  });

  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-1",
      turn: {
        __assistantTurn: true,
        key: "assistant-turn:request-1:0",
        requestId: "request-1",
        createdAt: preface.createdAt,
        messages: [preface],
        run,
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  const answer = await screen.findByText("页面内容已经整理完成。");
  await waitFor(() => expect(document.querySelectorAll("[data-tool-batch-activity]")).toHaveLength(1));
  const execution = document.querySelector("[data-tool-batch-activity]");
  expect(execution.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(screen.getByText("Thinking...")).toBeInTheDocument();
});

function createRun(overrides = {}) {
  return {
    requestId: "request-1",
    status: "running",
    input: "run input",
    startedAt: "2026-01-01T00:00:00.000Z",
    steps: [],
    displayText: "",
    displayTarget: "",
    displayedChars: 0,
    expectedOutputMode: "open",
    ...overrides,
  };
}
