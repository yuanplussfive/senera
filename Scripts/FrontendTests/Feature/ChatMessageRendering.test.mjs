import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { AssistantMessageBody } = await import("../../../Frontend/src/features/chat/AssistantMessageBody.tsx");
const { AssistantTurnRow } = await import("../../../Frontend/src/features/chat/AssistantTurnRow.tsx");
const { MessageRow } = await import("../../../Frontend/src/features/chat/MessageRow.tsx");
const { RunThinkingPresentation } = await import("../../../Frontend/src/features/chat/ModelThinkingDisclosure.tsx");
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

test("failed runs keep the raw error in details and expose explicit retry and continue actions", async () => {
  const onRetry = vi.fn();
  const onContinue = vi.fn();
  const user = userEvent.setup();
  const detail = "Senera planning input uses 307068 tokens and exceeds the model context length.";

  renderWithFrontendProviders(
    React.createElement(MessageRow, {
      message: {
        id: "error-1",
        role: "system",
        content: detail,
        createdAt: "2026-01-01T00:00:01.000Z",
        requestId: "request-1",
      },
      run: createRun({ requestId: "request-1", status: "failed", recoveryModes: ["retry", "continue"] }),
      uploadUrl: "",
      userProfile: {},
      showInlineActions: false,
      onFork: () => undefined,
      onRegenerate: () => undefined,
      onRetryRun: onRetry,
      onContinueRun: onContinue,
      onDelete: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  expect(document.querySelector("[data-run-error]")).toBeInTheDocument();
  expect(screen.getByText("请求未完成")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /重试/ }));
  await user.click(screen.getByRole("button", { name: /继续/ }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(document.querySelector("pre")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "详情" }));
  expect(document.querySelector("pre")).toBeVisible();
  expect(document.querySelector("pre")).toHaveTextContent(detail);
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

test("streaming assistant content renders Markdown before the run completes", async () => {
  renderWithFrontendProviders(
    React.createElement(AssistantMessageBody, {
      message: {
        kind: "AssistantFinal",
        content: "## 实时标题\n\n- 第一项\n- 第二项",
      },
      streaming: true,
    }),
  );

  expect(await screen.findByRole("heading", { level: 2, name: "实时标题" }, { timeout: 5_000 })).toBeInTheDocument();
  expect(screen.getByRole("list")).toHaveTextContent("第一项");
  expect(document.querySelector("[data-streaming-markdown-renderer]")).toBeInTheDocument();
});

test("streaming Markdown updates with each new complete construct and remains parsed after completion", async () => {
  const { rerender } = renderWithFrontendProviders(
    React.createElement(AssistantMessageBody, {
      message: { kind: "AssistantFinal", content: "项目仍在生成" },
      streaming: true,
    }),
  );

  rerender(
    React.createElement(AssistantMessageBody, {
      message: {
        kind: "AssistantFinal",
        content: "项目仍在生成：[Senera 项目](https://example.test/senera)",
      },
      streaming: true,
    }),
  );

  expect(await screen.findByRole("link", { name: "查看来源：example.test" })).toHaveAttribute(
    "href",
    "https://example.test/senera",
  );

  rerender(
    React.createElement(AssistantMessageBody, {
      message: {
        kind: "AssistantFinal",
        content: "项目仍在生成：[Senera 项目](https://example.test/senera)",
      },
    }),
  );
  expect(await screen.findByRole("link", { name: "查看来源：example.test" })).toBeInTheDocument();
});

test("Markdown image previews can download the authenticated image source", async () => {
  const NativeUrl = globalThis.URL;
  class DownloadUrl extends NativeUrl {}
  DownloadUrl.createObjectURL = vi.fn(() => "blob:senera-markdown-download");
  DownloadUrl.revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", DownloadUrl);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["image"]),
    })),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const user = userEvent.setup();

  renderWithFrontendProviders(
    React.createElement(AssistantMessageBody, {
      message: {
        kind: "AssistantFinal",
        content: "![diagram.png](https://example.test/diagram.png)",
      },
    }),
  );

  await user.click(await screen.findByRole("button", { name: "查看图片：diagram.png" }));
  await user.click(screen.getByRole("button", { name: "下载原图" }));

  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith("https://example.test/diagram.png", { credentials: "include" }),
  );
  expect(DownloadUrl.createObjectURL).toHaveBeenCalledTimes(1);
});

test("a live turn shows the quiet Thinking indicator before its first tool call", async () => {
  renderWithFrontendProviders(
    React.createElement(StreamingRow, {
      sessionId: "session-1",
      run: createRun(),
    }),
  );

  expect(await screen.findByText("Thinking")).toBeInTheDocument();
  expect(document.querySelector("[data-initial-thinking] [data-thinking-indicator]")).toBeInTheDocument();
  expect(document.querySelector("[data-initial-thinking] .shimmer-text")).toBeInTheDocument();
  expect(document.querySelector("[data-initial-thinking][data-live-activity-status]")).toHaveClass(
    "live-activity-status--thinking",
  );
  expect(document.querySelectorAll("[data-initial-thinking]")).toHaveLength(1);
  expect(document.querySelector("[data-initial-thinking] .senera-spinner")).not.toBeInTheDocument();
  expect(screen.queryByText("正在思考…")).not.toBeInTheDocument();
});

test("a live turn keeps the placeholder while thinking is between streamed blocks", () => {
  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-thinking-gap",
      turn: {
        __assistantTurn: true,
        key: "assistant-turn:request-thinking-gap:0",
        requestId: "request-thinking-gap",
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [],
        run: createRun({
          requestId: "request-thinking-gap",
          thinkingBlocks: [
            {
              id: "thought-complete",
              step: 1,
              messageIndex: 0,
              contentIndex: 0,
              content: "已经检查了输入。",
              status: "complete",
            },
          ],
        }),
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  expect(document.querySelector("[data-model-thinking-disclosure]")).toBeInTheDocument();
  expect(document.querySelector("[data-initial-thinking]")).toBeInTheDocument();
});

test("a streaming turn shows the placeholder before a run is created", () => {
  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-thinking-before-run",
      turn: {
        __assistantTurn: true,
        key: "assistant-turn:request-thinking-before-run:0",
        requestId: "request-thinking-before-run",
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [],
        run: undefined,
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  expect(document.querySelector("[data-initial-thinking]")).toBeInTheDocument();
});

test("a pending tool without presentation metadata keeps the live status visible", () => {
  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-pending-tool-metadata",
      turn: {
        __assistantTurn: true,
        key: "assistant-turn:request-pending-tool-metadata:0",
        requestId: "request-pending-tool-metadata",
        createdAt: "2026-01-01T00:00:01.000Z",
        messages: [],
        run: createRun({
          requestId: "request-pending-tool-metadata",
          steps: [
            {
              id: "pending-tool-without-name",
              kind: "tool",
              title: "",
              status: "pending",
              startedAt: "2026-01-01T00:00:01.000Z",
              toolName: "",
            },
          ],
        }),
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  const liveStatus = document.querySelector("[data-initial-thinking]");
  expect(liveStatus).toBeInTheDocument();
  expect(liveStatus).toHaveTextContent("Thinking");
});

test("a response-stage waiting execution owns the only Thinking placeholder", async () => {
  const requestId = "request-response-stage-waiting";
  const startedAt = "2026-01-01T00:00:01.000Z";

  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-response-stage-waiting",
      turn: {
        __assistantTurn: true,
        key: `assistant-turn:${requestId}:0`,
        requestId,
        createdAt: startedAt,
        messages: [],
        run: createRun({
          requestId,
          activeModelRequest: { agentStep: 0, modelMessageIndex: 0, eventSequence: 1 },
          steps: [
            {
              id: "unnamed-pending-tool",
              kind: "tool",
              title: "",
              status: "pending",
              startedAt,
              agentStep: 0,
              modelMessageIndex: 0,
              eventSequence: 2,
              toolName: "",
            },
          ],
        }),
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  await waitFor(() =>
    expect(document.querySelectorAll("[data-initial-thinking] [data-thinking-indicator]")).toHaveLength(1),
  );
  expect(screen.getAllByText("Thinking")).toHaveLength(1);
  expect(document.querySelectorAll("[data-live-activity-status]")).toHaveLength(1);
});

test("current visible turn text suppresses placeholder thinking", async () => {
  const message = {
    id: "answer-1",
    requestId: "request-1",
    role: "assistant",
    kind: "AssistantFinal",
    content: "我先把问题拆开看。",
    createdAt: "2026-01-01T00:00:01.000Z",
  };

  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-1",
      turn: {
        __assistantTurn: true,
        key: "assistant-turn:request-1:0",
        requestId: "request-1",
        createdAt: message.createdAt,
        messages: [message],
        run: createRun({
          steps: [],
          displayText: message.content,
          visibleText: message.content,
          visibleKind: "final_answer",
          outputState: "streaming",
          displayMessageId: message.id,
        }),
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  expect(await screen.findByText(message.content)).toBeInTheDocument();
  expect(document.querySelector("[data-initial-thinking]")).not.toBeInTheDocument();
  expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  expect(screen.queryByText("正在思考…")).not.toBeInTheDocument();
});

test("a visible current response suppresses a stale Thinking placeholder", () => {
  const requestId = "request-visible-response-placeholder";
  const createdAt = "2026-01-01T00:00:01.000Z";
  const answer = {
    id: "visible-response",
    requestId,
    role: "assistant",
    kind: "AssistantFinal",
    content: "我已经开始整理结果。",
    createdAt,
  };

  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-visible-response-placeholder",
      turn: {
        __assistantTurn: true,
        key: `assistant-turn:${requestId}:0`,
        requestId,
        createdAt,
        messages: [answer],
        run: createRun({
          requestId,
          liveActivity: "running_agent_turn",
          activeModelRequest: { agentStep: 0, modelMessageIndex: 0, eventSequence: 2 },
          steps: [
            {
              id: `${requestId}-assistant-message-${answer.id}`,
              kind: "answer",
              title: "",
              status: "running",
              startedAt: createdAt,
              agentStep: 0,
              modelMessageIndex: 0,
              modelContentIndex: 0,
              eventSequence: 2,
            },
          ],
        }),
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  expect(screen.getByText(answer.content)).toBeInTheDocument();
  expect(document.querySelector("[data-initial-thinking]")).not.toBeInTheDocument();
});

test("provider target text does not remove the placeholder before the display ticker paints", () => {
  const requestId = "request-target-before-display";
  const run = createRun({
    requestId,
    visibleText: "最终回答",
    displayText: "",
    visibleKind: "final_answer",
    outputState: "streaming",
    activeModelRequest: { agentStep: 0, modelMessageIndex: 0, eventSequence: 1 },
  });
  const renderTurn = (currentRun) =>
    React.createElement(AssistantTurnRow, {
      sessionId: "session-target-before-display",
      turn: {
        __assistantTurn: true,
        key: `assistant-turn:${requestId}:0`,
        requestId,
        createdAt: run.startedAt,
        messages: [],
        run: currentRun,
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    });

  const view = renderWithFrontendProviders(renderTurn(run));
  expect(document.querySelector("[data-initial-thinking]")).toBeInTheDocument();
  expect(screen.queryByText("最终回答")).not.toBeInTheDocument();

  view.rerender(renderTurn({ ...run, displayText: "最终" }));
  expect(document.querySelector("[data-initial-thinking]")).not.toBeInTheDocument();
  expect(screen.getByText("最终")).toBeInTheDocument();
});

test("a committed streamed answer stays visible until its terminal message is mounted", () => {
  const requestId = "request-committed-before-message";
  const answer = {
    id: "answer-delayed",
    requestId,
    role: "assistant",
    kind: "AssistantFinal",
    content: "完整回答",
    createdAt: "2026-01-01T00:00:01.000Z",
  };
  const run = createRun({
    requestId,
    displayText: "临时回答",
    visibleText: "完整回答",
    displayMessageId: answer.id,
    visibleKind: "final_answer",
    outputState: "committed",
  });
  const renderTurn = (messages) =>
    React.createElement(AssistantTurnRow, {
      sessionId: "session-committed-before-message",
      turn: {
        __assistantTurn: true,
        key: `assistant-turn:${requestId}:0`,
        requestId,
        createdAt: run.startedAt,
        messages,
        run,
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    });

  const view = renderWithFrontendProviders(renderTurn([]));
  expect(screen.getByText("临时回答")).toBeInTheDocument();

  view.rerender(renderTurn([answer]));
  expect(screen.getByText("完整回答")).toBeInTheDocument();
  expect(screen.queryByText("临时回答")).not.toBeInTheDocument();
});

test("earlier turn output does not hide Thinking while the current run has no visible activity", () => {
  const message = {
    id: "answer-previous",
    requestId: "request-1",
    role: "assistant",
    kind: "AssistantFinal",
    content: "我已经检查完前面的内容。",
    createdAt: "2026-01-01T00:00:01.000Z",
  };

  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-1",
      turn: {
        __assistantTurn: true,
        key: "assistant-turn:request-1:0",
        requestId: "request-1",
        createdAt: message.createdAt,
        messages: [message],
        run: createRun({ steps: [], displayText: "", visibleText: "", outputState: "pending" }),
        streaming: true,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  const liveStatus = document.querySelector("[data-assistant-turn-stage-list] [data-initial-thinking]");
  expect(liveStatus).toBeInTheDocument();
  expect(liveStatus).toHaveTextContent("Thinking");
  expect(liveStatus).toHaveClass("activity-feed-row");
  expect(screen.getByText(message.content)).toBeInTheDocument();
  expect(screen.queryByText("正在思考…")).not.toBeInTheDocument();
});

test("a visible legacy message does not add a live empty-thinking summary", () => {
  const message = {
    id: "answer-1",
    requestId: "request-1",
    role: "assistant",
    kind: "AssistantFinal",
    content: "正在输出的回答。",
    createdAt: "2026-01-01T00:00:01.000Z",
  };

  renderWithFrontendProviders(
    React.createElement(MessageRow, {
      message,
      run: createRun({ steps: [], displayText: "", visibleText: "" }),
      uploadUrl: "",
      userProfile: {},
      showInlineActions: false,
      onFork: () => undefined,
      onRegenerate: () => undefined,
      onDelete: () => undefined,
      onViewWorkflow: () => undefined,
    }),
  );

  expect(screen.getByText(message.content)).toBeInTheDocument();
  expect(document.querySelector("[data-initial-thinking]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-run-status='running']")).not.toBeInTheDocument();
  expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  expect(screen.queryByText("Senera 正在思考…")).not.toBeInTheDocument();
});

test("thinking preview keeps its brain icon without adding a Thinking label", async () => {
  renderWithFrontendProviders(
    React.createElement(RunThinkingPresentation, {
      blocks: [
        {
          id: "thinking-preview",
          step: 1,
          messageIndex: 0,
          contentIndex: 0,
          content: "我先检查用户的问题。",
          status: "streaming",
        },
      ],
      current: true,
    }),
  );

  await waitFor(() =>
    expect(document.querySelector("[data-model-thinking-first-preview]")).toHaveTextContent("我先检查用户的问题。"),
  );
  expect(
    document.querySelector("[data-model-thinking-disclosure] [data-thinking-status-icon] [data-thinking-indicator]"),
  ).toBeInTheDocument();
  expect(screen.queryByText("正在思考…")).not.toBeInTheDocument();
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
  await waitFor(() => expect(stage.querySelector("[data-execution-stage-feed]")).not.toBeNull());
  const execution = stage.querySelector("[data-execution-stage-feed]");
  expect(body.compareDocumentPosition(execution) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(turn.querySelectorAll("[data-message-avatar='assistant']")).toHaveLength(1);
  expect(document.querySelectorAll(".conversation-frame--wide")).toHaveLength(1);
  expect(screen.getAllByText("搜索当前已加载的工具目录……")).toHaveLength(1);
  expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  expect(body.closest("[data-live-activity='true']")).toBeInTheDocument();
  expect(execution.querySelector("[data-tool-batch-activity-title]")).not.toHaveClass(
    "motion-safe:animate-text-shimmer",
  );
  expect(execution.querySelector("[data-tool-action-live]")).not.toBeInTheDocument();
  expect(execution.querySelector("[data-tool-action-icon]")).not.toHaveClass("senera-live-status-icon");
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
  await waitFor(() => expect(document.querySelector("[data-tool-batch-activity]")).toBeInTheDocument(), {
    timeout: 5_000,
  });
  expect(document.querySelector("[data-tool-batch-activity-trigger]")).not.toHaveAttribute("aria-expanded");
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
  expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  const execution = document.querySelector("[data-tool-batch-activity]");
  const answer = screen.getByText("我正在整理结果。");
  expect(execution.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(answer.closest(".live-activity-markdown")).toBeNull();
  expect(execution.querySelector('[class~="motion-safe:animate-text-shimmer"]')).toBeNull();
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
  await waitFor(() => expect(document.querySelectorAll("[data-tool-batch-activity]")).toHaveLength(1), {
    timeout: 5_000,
  });
  const execution = document.querySelector("[data-tool-batch-activity]");
  expect(execution.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  expect(answer.closest(".live-activity-markdown")).toBeNull();
  expect(execution.querySelector('[class~="motion-safe:animate-text-shimmer"]')).toBeNull();
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
