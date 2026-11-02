import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { WorkspaceResourceProvider } from "../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { AssistantMessageBody } = await import("../../../Frontend/src/features/chat/AssistantMessageBody.tsx");
const { AssistantTurnRow } = await import("../../../Frontend/src/features/chat/AssistantTurnRow.tsx");
const { MessageRow } = await import("../../../Frontend/src/features/chat/MessageRow.tsx");
const { RunThinkingPresentation } = await import("../../../Frontend/src/features/chat/ModelThinkingDisclosure.tsx");
const { StreamingRow } = await import("../../../Frontend/src/features/chat/StreamingRow.tsx");
const { preloadMarkdownRenderer } = await import("../../../Frontend/src/shared/code/LazyMarkdownRenderer.tsx");

// The lazy Markdown chunk is shared per worker. Resolve it during file setup so
// assertions never race a cold, contended module transform in the full suite.
await preloadMarkdownRenderer();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test.each([
  [{ actorName: "用户", targetName: "玉米" }, "用户 戳了戳 玉米"],
  [{}, "user-1 戳了戳 agent-1"],
  [{ actorName: "<b>用户</b>", targetName: "**玉米**" }, "<b>用户</b> 戳了戳 **玉米**"],
])("native poke events render as events without an empty editable user bubble: %j", (names, expected) => {
  const onClickBubble = vi.fn();
  renderWithFrontendProviders(
    React.createElement(MessageRow, {
      message: {
        id: "poke-user",
        role: "user",
        content: "",
        createdAt: "2026-10-25T03:46:37.000Z",
        requestId: "poke-request",
        metadata: {
          channelEvent: {
            id: "poke-1",
            type: "poke",
            actorId: "user-1",
            targetId: "agent-1",
            sentAt: "2026-10-25T03:46:37.000Z",
            ...names,
          },
        },
      },
      uploadUrl: "",
      userProfile: {},
      showInlineActions: true,
      onClickBubble,
      onFork: vi.fn(),
      onRegenerate: vi.fn(),
      onDelete: vi.fn(),
      onViewWorkflow: vi.fn(),
    }),
  );
  expect(screen.getByText(expected)).toBeVisible();
  expect(document.querySelector('[data-channel-event="poke"]')).toBeInTheDocument();
  expect(document.querySelector("[data-user-message-bubble]")).not.toBeInTheDocument();
  expect(document.querySelector('[data-message-avatar="user"]')).not.toBeInTheDocument();
  expect(screen.queryByText(/0 tokens/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "复制" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(expected));
  expect(onClickBubble).not.toHaveBeenCalled();
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

  expect(await screen.findByRole("link", { name: "查看来源：example.test/senera" })).toHaveAttribute(
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
  expect(await screen.findByRole("link", { name: "查看来源：example.test/senera" })).toBeInTheDocument();
});

test("streaming Markdown keeps settled blocks and its live plain-text node mounted while the tail advances", async () => {
  const initialContent = "## 已确认\n\n正在整理结果";
  const nextContent = `${initialContent}，准备输出结论`;
  const user = userEvent.setup();

  function StreamHarness() {
    const [content, setContent] = React.useState(initialContent);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("button", { type: "button", onClick: () => setContent(nextContent) }, "追加流内容"),
      React.createElement(AssistantMessageBody, {
        message: { kind: "AssistantFinal", content },
        streaming: true,
      }),
    );
  }

  renderWithFrontendProviders(React.createElement(StreamHarness));

  await screen.findByRole("heading", { level: 2, name: "已确认" });
  const prefix = document.querySelector("[data-streaming-markdown-prefix]");
  expect(prefix).toHaveTextContent("已确认");
  expect(document.querySelector("[data-streaming-markdown-tail]")).toHaveTextContent("正在整理结果");
  const liveText = document.querySelector("[data-streaming-markdown-live-text]");
  expect(liveText).toHaveTextContent("正在整理结果");

  await user.click(screen.getByRole("button", { name: "追加流内容" }));

  await waitFor(() =>
    expect(document.querySelector("[data-streaming-markdown-tail]")).toHaveTextContent("正在整理结果，准备输出结论"),
  );
  const updatedLiveText = document.querySelector("[data-streaming-markdown-live-text]");
  expect(updatedLiveText).toBe(liveText);
  expect(updatedLiveText).toHaveTextContent("正在整理结果，准备输出结论");
  expect(prefix).not.toContainElement(updatedLiveText);
});

test("streaming Markdown does not settle a fenced block before its closing fence arrives", async () => {
  const initialContent = "```ts\nconst answer = 42;";
  const nextContent = `${initialContent}\n\`\`\`\n\n结论已准备好。`;
  const user = userEvent.setup();

  function StreamHarness() {
    const [content, setContent] = React.useState(initialContent);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("button", { type: "button", onClick: () => setContent(nextContent) }, "闭合代码块"),
      React.createElement(AssistantMessageBody, {
        message: { kind: "AssistantFinal", content },
        streaming: true,
      }),
    );
  }

  renderWithFrontendProviders(React.createElement(StreamHarness));
  expect(document.querySelector("[data-streaming-markdown-prefix]")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "闭合代码块" }));

  await waitFor(() =>
    expect(document.querySelector("[data-streaming-markdown-prefix]")).toHaveTextContent("const answer = 42;"),
  );
  expect(document.querySelector("[data-streaming-markdown-tail]")).toHaveTextContent("结论已准备好。");
});

test("streaming Markdown keeps ambiguous list continuations in the active tail", async () => {
  const initialContent = "- 第一项\n\n  这仍是第一项的说明。";
  const nextContent = `${initialContent}\n\n## 下一节\n\n独立内容。`;
  const user = userEvent.setup();

  function StreamHarness() {
    const [content, setContent] = React.useState(initialContent);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("button", { type: "button", onClick: () => setContent(nextContent) }, "追加独立章节"),
      React.createElement(AssistantMessageBody, {
        message: { kind: "AssistantFinal", content },
        streaming: true,
      }),
    );
  }

  renderWithFrontendProviders(React.createElement(StreamHarness));
  expect(document.querySelector("[data-streaming-markdown-prefix]")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "追加独立章节" }));

  await waitFor(() =>
    expect(document.querySelector("[data-streaming-markdown-prefix]")).toHaveTextContent("这仍是第一项的说明。"),
  );
  expect(document.querySelector("[data-streaming-markdown-prefix]")).toHaveTextContent("下一节");
  expect(document.querySelector("[data-streaming-markdown-tail]")).toHaveTextContent("独立内容。");
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
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl: "https://example.test" },
      React.createElement(AssistantMessageBody, {
        message: {
          kind: "AssistantFinal",
          content: "![diagram.png](https://example.test/diagram.png)",
        },
      }),
    ),
  );

  await user.click(await screen.findByRole("button", { name: "查看图片：diagram.png" }));
  await user.click(await screen.findByRole("button", { name: "下载文件" }));

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

test("an empty response stage delegates its only Thinking placeholder to the current model stage", async () => {
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
  expect(document.querySelector("[data-live-activity-fallback]")).not.toBeInTheDocument();
});

test("an empty current response keeps a foreground runtime activity visible without a waiting duplicate", async () => {
  const requestId = "request-empty-foreground-activity";
  const startedAt = "2026-01-01T00:00:01.000Z";

  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-empty-foreground-activity",
      turn: {
        __assistantTurn: true,
        key: `assistant-turn:${requestId}:0`,
        requestId,
        createdAt: startedAt,
        messages: [],
        run: createRun({
          requestId,
          liveActivity: "compacting_context",
          activeModelRequest: { agentStep: 0, modelMessageIndex: 0, eventSequence: 1 },
          steps: [
            {
              id: `${requestId}-model-0-0`,
              kind: "model",
              title: "运行模型",
              status: "running",
              startedAt,
              agentStep: 0,
              modelMessageIndex: 0,
              eventSequence: 1,
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

  await waitFor(() => expect(document.querySelector("[data-execution-stage-feed]")).toBeInTheDocument());
  expect(document.querySelector("[data-initial-thinking]")).not.toBeInTheDocument();
  expect(document.querySelectorAll("[data-live-activity-status]")).toHaveLength(0);
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

test("provider target text does not remove the placeholder before a displayable projection arrives", () => {
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

test("live thinking exposes an expanded readable transcript with a concise status line", async () => {
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
    }),
  );

  await waitFor(() =>
    expect(document.querySelector("[data-model-thinking-first-preview]")).toHaveTextContent("我先检查用户的问题。"),
  );
  expect(
    document.querySelector("[data-model-thinking-disclosure] [data-thinking-status-icon][data-live-activity-icon] svg"),
  ).toBeInTheDocument();
  expect(
    document.querySelector("[data-thinking-preview-connector] [data-thinking-preview-paperclip]"),
  ).toBeInTheDocument();
  expect(screen.getByText("正在思考")).toBeInTheDocument();
  expect(document.querySelector("[data-model-thinking-toggle-row]")).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelector("[data-model-thinking-transcript]")).toHaveTextContent("我先检查用户的问题。");
});

test("thinking follows the latest reasoning line and collapses after the model response completes", async () => {
  const blocks = [
    {
      id: "earlier-model-request",
      step: 0,
      messageIndex: 0,
      contentIndex: 0,
      content: "先读取现有配置。",
      status: "complete",
    },
    {
      id: "latest-model-request",
      step: 1,
      messageIndex: 0,
      contentIndex: 0,
      content: "正在整理最新结论。\n这行不应该进入紧凑摘要。",
      status: "streaming",
    },
  ];
  const view = renderWithFrontendProviders(
    React.createElement(RunThinkingPresentation, {
      blocks,
    }),
  );

  const readDisclosure = () => document.querySelector("[data-model-thinking-disclosure]");
  const disclosure = readDisclosure();
  expect(disclosure.querySelector("[data-model-thinking-preview]")).toHaveTextContent("正在整理最新结论。");
  expect(disclosure.querySelector("[data-model-thinking-toggle-row]")).toHaveAttribute("aria-expanded", "true");
  expect(disclosure.querySelectorAll("[data-model-thinking-entry]")).toHaveLength(2);
  expect(disclosure.querySelectorAll(".model-thinking-disclosure__break")).toHaveLength(1);

  view.rerender(
    React.createElement(RunThinkingPresentation, {
      blocks: blocks.map((block) => ({ ...block, status: "complete" })),
    }),
  );

  await waitFor(() =>
    expect(readDisclosure().querySelector("[data-model-thinking-toggle-row]")).toHaveAttribute(
      "aria-expanded",
      "false",
    ),
  );
  expect(readDisclosure().querySelector("[data-model-thinking-transcript]")).toBeInTheDocument();
  expect(readDisclosure().querySelector("[data-motion-disclosure-state]")).toHaveAttribute(
    "data-motion-disclosure-state",
    "closed",
  );
  expect(readDisclosure()).toHaveTextContent("已完成思考");
});

test("a manual thinking collapse is preserved for later deltas from the same reasoning block", async () => {
  const user = userEvent.setup();
  const blocks = [
    {
      id: "thinking-live",
      step: 1,
      messageIndex: 0,
      contentIndex: 0,
      content: "先检查现有状态。",
      status: "streaming",
    },
  ];
  function ThinkingHarness() {
    const [activeBlocks, setActiveBlocks] = React.useState(blocks);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => setActiveBlocks([{ ...blocks[0], content: "先检查现有状态。\n接着读取关联记录。" }]),
        },
        "继续同一思考",
      ),
      React.createElement(RunThinkingPresentation, { blocks: activeBlocks }),
    );
  }

  renderWithFrontendProviders(React.createElement(ThinkingHarness));
  const toggle = document.querySelector("[data-model-thinking-toggle-row]");

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");

  await user.click(screen.getByRole("button", { name: "继续同一思考" }));

  expect(document.querySelector("[data-model-thinking-toggle-row]")).toHaveAttribute("aria-expanded", "false");
});

test("a new thinking block resumes the disclosure after the prior block was manually collapsed", async () => {
  const user = userEvent.setup();
  const firstBlock = {
    id: "thinking-first",
    step: 1,
    messageIndex: 0,
    contentIndex: 0,
    content: "先确认第一个问题。",
    status: "streaming",
  };
  function ThinkingHarness() {
    const [activeBlocks, setActiveBlocks] = React.useState([firstBlock]);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            setActiveBlocks([
              { ...firstBlock, status: "complete" },
              {
                id: "thinking-second",
                step: 2,
                messageIndex: 0,
                contentIndex: 0,
                content: "开始处理下一步。",
                status: "streaming",
              },
            ]),
        },
        "开始下一次思考",
      ),
      React.createElement(RunThinkingPresentation, { blocks: activeBlocks }),
    );
  }

  renderWithFrontendProviders(React.createElement(ThinkingHarness));

  await user.click(document.querySelector("[data-model-thinking-toggle-row]"));
  expect(document.querySelector("[data-model-thinking-toggle-row]")).toHaveAttribute("aria-expanded", "false");

  await user.click(screen.getByRole("button", { name: "开始下一次思考" }));

  await waitFor(() =>
    expect(document.querySelector("[data-model-thinking-toggle-row]")).toHaveAttribute("aria-expanded", "true"),
  );
});

test("a completed turn contracts its existing thinking process before showing the final response", async () => {
  const user = userEvent.setup();
  const requestId = "request-thinking-terminal-transition";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const finalMessage = {
    id: "thinking-terminal-answer",
    requestId,
    role: "assistant",
    kind: "AssistantFinal",
    content: "整理完成后的最终答复。",
    createdAt: "2026-01-01T00:00:08.000Z",
  };
  const modelStep = {
    id: `${requestId}-model-0-0`,
    kind: "model",
    title: "调用模型",
    status: "running",
    startedAt,
    agentStep: 0,
    modelMessageIndex: 0,
    eventSequence: 1,
  };
  const liveRun = createRun({
    requestId,
    activeModelRequest: { agentStep: 0, modelMessageIndex: 0, eventSequence: 1 },
    steps: [modelStep],
    thinkingBlocks: [
      {
        id: "thinking-terminal-block",
        step: 0,
        messageIndex: 0,
        contentIndex: 0,
        content: "先整理最终答复的要点。",
        status: "streaming",
        eventSequence: 1,
      },
    ],
  });
  const renderTurn = (run, messages, streaming) =>
    React.createElement(AssistantTurnRow, {
      sessionId: "session-thinking-terminal-transition",
      turn: {
        __assistantTurn: true,
        key: `assistant-turn:${requestId}:0`,
        requestId,
        createdAt: startedAt,
        messages,
        run,
        streaming,
      },
      showInlineActions: false,
      onForkFromMessage: () => undefined,
      onRegenerate: () => undefined,
      onDeleteFromMessage: () => undefined,
      onViewWorkflow: () => undefined,
    });

  function TurnHarness() {
    const [completed, setCompleted] = React.useState(false);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("button", { type: "button", onClick: () => setCompleted(true) }, "完成思考回合"),
      completed ? renderTurn(completedRun, [finalMessage], false) : renderTurn(liveRun, [], true),
    );
  }

  const completedRun = {
    ...liveRun,
    status: "completed",
    endedAt: finalMessage.createdAt,
    activeModelRequest: undefined,
    steps: [
      { ...modelStep, status: "done", endedAt: finalMessage.createdAt },
      {
        id: `${requestId}-assistant-message-${finalMessage.id}`,
        kind: "answer",
        title: finalMessage.content,
        status: "done",
        startedAt: finalMessage.createdAt,
        endedAt: finalMessage.createdAt,
        agentStep: 0,
        modelMessageIndex: 0,
        modelContentIndex: 1,
        eventSequence: 2,
      },
    ],
    thinkingBlocks: liveRun.thinkingBlocks.map((block) => ({ ...block, status: "complete" })),
  };

  renderWithFrontendProviders(React.createElement(TurnHarness));
  const transcript = await waitFor(() => {
    const node = document.querySelector("[data-model-thinking-transcript]");
    expect(node).toBeInTheDocument();
    return node;
  });

  await user.click(screen.getByRole("button", { name: "完成思考回合" }));

  await waitFor(() =>
    expect(document.querySelector("[data-model-thinking-toggle-row]")).toHaveAttribute("aria-expanded", "false"),
  );
  expect(document.querySelector("[data-model-thinking-transcript]")).toBe(transcript);
  expect(document.querySelector("[data-settled-turn-toggle]")).toBeInTheDocument();
  expect(screen.getByText(finalMessage.content)).toBeInTheDocument();
});

test("live thinking follows its tail again after markdown changes the transcript layout", async () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const observers = [];
  class TestResizeObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe() {}

    disconnect() {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });

  try {
    renderWithFrontendProviders(
      React.createElement(RunThinkingPresentation, {
        blocks: [
          {
            id: "thinking-overflow",
            step: 1,
            messageIndex: 0,
            contentIndex: 0,
            content: "正在持续整理很长的推理内容。",
            status: "streaming",
          },
        ],
      }),
    );

    const transcript = await waitFor(() => {
      const node = document.querySelector("[data-model-thinking-transcript]");
      expect(node).toBeInTheDocument();
      return node;
    });
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 240 },
      scrollHeight: { configurable: true, value: 960 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    await waitFor(() => expect(observers).not.toHaveLength(0));
    observers.forEach((observer) => observer.callback());

    await waitFor(() => expect(transcript.scrollTop).toBe(720));

    transcript.scrollTop = 96;
    fireEvent.scroll(transcript);
    Object.defineProperty(transcript, "scrollHeight", { configurable: true, value: 1200 });
    observers.forEach((observer) => observer.callback());

    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(transcript.scrollTop).toBe(96);
  } finally {
    if (originalResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalResizeObserver;
  }
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
    expectedOutputMode: "open",
    ...overrides,
  };
}
