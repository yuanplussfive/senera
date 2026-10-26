import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { countTokens } from "gpt-tokenizer";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { ChatPanel, hasRenderableConversationContent } =
  await import("../../../Frontend/src/features/chat/ChatPanel.tsx");
const { ChatComposer } = await import("../../../Frontend/src/features/chat/ChatComposer.tsx");
const { ScrollToBottomButton } = await import("../../../Frontend/src/features/chat/ScrollToBottomButton.tsx");
const { MessageActions, readMessageActionIntents } =
  await import("../../../Frontend/src/features/chat/MessageActions.tsx");
const { AssistantTurnRow } = await import("../../../Frontend/src/features/chat/AssistantTurnRow.tsx");
const { preloadMarkdownRenderer } = await import("../../../Frontend/src/shared/code/LazyMarkdownRenderer.tsx");
const { MessageMetrics } = await import("../../../Frontend/src/features/chat/MessageMetrics.tsx");
const { TooltipProvider } = await import("../../../Frontend/src/shared/ui/Tooltip.tsx");
const { MessageList, readMessageListItemKey } = await import("../../../Frontend/src/features/chat/MessageList.tsx");
const { projectAssistantTurns } = await import("../../../Frontend/src/features/chat/assistantTurnProjection.ts");
const { projectAssistantTurnStages } =
  await import("../../../Frontend/src/features/chat/assistantTurnStageProjection.ts");
const { frontendMessage, FrontendLocales } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { frontendChatMessage } = await import("../../../Frontend/src/i18n/frontendChatMessageCatalog.ts");
const { setFrontendLocale } = await import("../../../Frontend/src/i18n/frontendLocaleStore.ts");
const { clearPersistedStore, useStore } = await import("../../../Frontend/src/store/sessionStore.ts");
const {
  createChatPanelProps,
  createComposerProps,
  createMessage,
  createMessageActions,
  createMessageListProps,
  createRun,
  resetChatStore,
  stageMarker,
  stageTool,
  withUploadPreviewProvider,
} = await import("./chatCoreComponentFixtures.mjs");

afterEach(() => {
  cleanup();
  setFrontendLocale(FrontendLocales.ZhCn);
  vi.clearAllMocks();
  vi.restoreAllMocks();
  clearPersistedStore();
});

test("chat composer updates its memoized hint when the frontend locale changes", async () => {
  setFrontendLocale(FrontendLocales.ZhCn);
  renderWithFrontendProviders(withUploadPreviewProvider(React.createElement(ChatComposer, createComposerProps())));

  expect(screen.getByPlaceholderText("跟 senera 说点什么")).toBeInTheDocument();

  act(() => setFrontendLocale(FrontendLocales.EnUs));

  await waitFor(() => expect(screen.getByPlaceholderText("Tell senera what to do")).toBeInTheDocument());
});

test("message metrics keep total tokens and TPS outside the assistant detail disclosure", () => {
  const run = createRun({
    requestId: "metrics-run",
    status: "completed",
    steps: [
      {
        id: "model-step",
        kind: "model",
        title: "Model",
        status: "done",
        startedAt: "2026-07-09T00:00:00.000Z",
        endedAt: "2026-07-09T00:00:02.000Z",
      },
    ],
  });
  renderWithFrontendProviders(
    React.createElement(MessageMetrics, {
      role: "assistant",
      run,
      usage: {
        source: "provider_reported",
        inputTokens: 120,
        outputTokens: 36,
        totalTokens: 156,
        cacheReadTokens: 80,
      },
    }),
  );

  const metrics = document.querySelector("[data-message-metrics-role='assistant']");
  expect(metrics).toBeInTheDocument();
  expect(metrics).toHaveTextContent("156 tokens");
  expect(metrics).toHaveTextContent("18 tok/s");
  expect(metrics.querySelector("[data-message-metrics-usage]")).toBeInTheDocument();
  expect(metrics.querySelector("[data-message-metrics-total]")).toHaveTextContent("156 tokens");
  expect(metrics.querySelector("[data-message-metrics-throughput]")).toHaveTextContent("18 tok/s");
  expect(metrics.querySelector("[data-message-metrics-feedback]")).toBeNull();
  expect(metrics).not.toHaveTextContent("36 tokens");
  expect(metrics).not.toHaveTextContent("平均");
  expect(metrics).not.toHaveTextContent("gpt-6-luna");
});

test("assistant total tokens use compact Chinese units while details keep the full value", () => {
  renderWithFrontendProviders(
    React.createElement(MessageMetrics, {
      role: "assistant",
      run: createRun({ requestId: "metrics-compact", status: "completed" }),
      usage: { source: "provider_reported", totalTokens: 125_000 },
    }),
  );

  const metrics = document.querySelector("[data-message-metrics-role='assistant']");
  expect(metrics).toHaveTextContent("12.5w tokens");
  expect(metrics).not.toHaveTextContent("125,000 tokens");
});

test("assistant metrics stay hidden until the run is completed", () => {
  const run = createRun({
    requestId: "metrics-running",
    status: "running",
    modelProvider: {
      id: "provider-pi",
      kind: "OpenAICompatible",
      endpoint: "Responses",
      baseUrl: "https://example.test/v1",
      model: "gpt-6-luna",
    },
  });

  renderWithFrontendProviders(
    React.createElement(MessageMetrics, {
      role: "assistant",
      run,
      modelProvider: run.modelProvider,
      usage: { source: "provider_reported", outputTokens: 24 },
    }),
  );

  expect(document.querySelector("[data-message-metrics-role='assistant']")).toBeNull();
});

test("message metrics do not leak the model name into the compact assistant row", () => {
  const run = createRun({
    requestId: "metrics-model-fallback",
    status: "completed",
    steps: [
      {
        id: "model-step",
        kind: "model",
        modelName: "gpt-6-luna",
        title: "Model",
        status: "done",
        startedAt: "2026-07-09T00:00:00.000Z",
        endedAt: "2026-07-09T00:00:02.000Z",
      },
    ],
  });

  renderWithFrontendProviders(
    React.createElement(MessageMetrics, {
      role: "assistant",
      run,
      usage: { source: "provider_reported", outputTokens: 12, totalTokens: 12 },
    }),
  );

  const metrics = document.querySelector("[data-message-metrics-role='assistant']");
  expect(metrics).toHaveTextContent("12 tokens");
  expect(metrics).toHaveTextContent("6 tok/s");
  expect(metrics).not.toHaveTextContent("gpt-6-luna");
  expect(metrics?.querySelector("[data-message-metrics-model]")).toBeNull();
});

test("user message metrics count only the visible message text locally", () => {
  const text = "你好，读取项目";
  renderWithFrontendProviders(
    React.createElement(MessageMetrics, {
      role: "user",
      text,
      usage: {
        source: "provider_reported",
        inputTokens: 999_999,
        outputTokens: 12,
        totalTokens: 1_000_011,
      },
    }),
  );

  const metrics = document.querySelector("[data-message-metrics-role='user']");
  expect(metrics).toBeInTheDocument();
  expect(metrics).toHaveTextContent(`${countTokens(text).toLocaleString("zh-CN")} tokens`);
  expect(metrics).not.toHaveTextContent("999,999 tokens");
});

test("chat composer exposes the selected execution approval mode", async () => {
  const user = userEvent.setup();
  const onSelectMode = vi.fn();
  renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(ChatComposer, createComposerProps({ approvalConfig: { mode: "agent", onSelectMode } })),
    ),
  );

  await user.click(await screen.findByRole("button", { name: "替我审批" }));
  await user.click(await screen.findByText("完全访问"));

  expect(onSelectMode).toHaveBeenCalledWith("full_access");
});

test("chat composer shows the current context usage in the compact progress indicator", () => {
  const { rerender } = renderWithFrontendProviders(
    withUploadPreviewProvider(React.createElement(ChatComposer, createComposerProps())),
  );

  expect(screen.queryByRole("progressbar", { name: "背景信息窗口" })).not.toBeInTheDocument();

  rerender(
    withUploadPreviewProvider(
      React.createElement(
        ChatComposer,
        createComposerProps({
          runtimeUsage: {
            contextUsage: {
              tokens: 10_073,
              contextWindow: 100_000,
              percent: 10.073245614035088,
            },
          },
        }),
      ),
    ),
  );

  const populatedIndicator = screen.getByRole("progressbar", { name: "背景信息窗口" });
  expect(populatedIndicator).not.toHaveTextContent("10.07%");
  expect(populatedIndicator).toHaveAttribute("aria-valuetext", "10%");
  expect(populatedIndicator.parentElement).toContainElement(document.querySelector("[data-composer-model-selector]"));
  expect(document.querySelector("[data-composer-model-selector]")).not.toHaveClass("border-line-subtle");
});

test("chat composer sends trimmed text and switches queue mode while a run is active", async () => {
  const onSend = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();

  const { rerender } = renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(
        ChatComposer,
        createComposerProps({
          onSend,
          onCancel,
        }),
      ),
    ),
  );

  const composer = screen.getByRole("textbox", { name: "输入消息" });
  expect(composer).not.toHaveClass("focus-visible:ring-2");
  expect(document.querySelector("[data-chat-composer]")).toHaveClass("bg-surface-raised");
  expect(document.querySelector("[data-chat-composer]")).not.toHaveClass(
    "focus-within:border-accent-border-strong",
    "focus-within:bg-[var(--theme-chat-composer-focus-bg)]",
    "focus-within:ring-2",
  );
  await user.type(composer, "  hello project  ");
  await user.click(screen.getByRole("button", { name: "send" }));
  expect(onSend).toHaveBeenLastCalledWith("hello project", undefined, undefined);

  rerender(
    withUploadPreviewProvider(
      React.createElement(
        ChatComposer,
        createComposerProps({
          running: true,
          onSend,
          onCancel,
        }),
      ),
    ),
  );

  expect(screen.getByRole("button", { name: frontendMessage("chat.composer.cancelRunning") })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "inject-current-run" })).not.toBeInTheDocument();

  await user.type(screen.getByRole("textbox", { name: "输入消息" }), "steer now");
  await user.keyboard("{Enter}");
  expect(onSend).toHaveBeenLastCalledWith("steer now", undefined, "steer");

  await user.type(screen.getByRole("textbox", { name: "输入消息" }), "follow later");
  await user.keyboard("{Alt>}{Enter}{/Alt}");
  expect(onSend).toHaveBeenLastCalledWith("follow later", undefined, "follow_up");

  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("scroll-to-bottom stays compact while retaining an accessible label", () => {
  renderWithFrontendProviders(React.createElement(ScrollToBottomButton, { visible: true, onClick: vi.fn() }));

  const button = screen.getByRole("button", { name: frontendMessage("chat.scrollToBottom") });
  expect(button).toHaveClass("h-8", "w-8", "rounded-full", "bg-surface-raised", "text-content-secondary");
  expect(button).not.toHaveClass("bg-ink-900", "text-paper-50");
  expect(button).not.toHaveTextContent(frontendMessage("chat.backToBottom"));
});

test("chat composer preserves a failed draft and leaves Escape to active interaction layers", async () => {
  const onSend = vi.fn(() => false);
  const onCancel = vi.fn();
  const user = userEvent.setup();
  const { rerender } = renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ChatComposer, createComposerProps({ running: true, onSend, onCancel })),
        React.createElement("div", { role: "dialog", "aria-label": "Open dialog" }, "Dialog content"),
      ),
    ),
  );

  const composer = screen.getByRole("textbox", { name: "输入消息" });
  await user.type(composer, "preserve this draft");
  await user.keyboard("{Enter}");
  expect(composer).toHaveValue("preserve this draft");

  await user.keyboard("{Escape}");
  expect(onCancel).not.toHaveBeenCalled();

  rerender(
    withUploadPreviewProvider(
      React.createElement(ChatComposer, createComposerProps({ running: true, onSend, onCancel })),
    ),
  );
  const preventedEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  preventedEscape.preventDefault();
  window.dispatchEvent(preventedEscape);
  expect(onCancel).not.toHaveBeenCalled();
});

test("chat composer opens prompt settings only after the tools menu releases interaction ownership", async () => {
  const onOutsideClick = vi.fn();
  const onOpenSettings = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(
      React.Fragment,
      null,
      withUploadPreviewProvider(React.createElement(ChatComposer, createComposerProps({ onOpenSettings }))),
      React.createElement("button", { type: "button", onClick: onOutsideClick }, "外部操作"),
    ),
  );

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(screen.getByRole("menuitem", { name: frontendChatMessage("chat.composer.toolkit.persona") }));

  await waitFor(() => expect(onOpenSettings).toHaveBeenCalledWith("prompt"));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
  await user.click(screen.getByRole("button", { name: "外部操作" }));
  expect(onOutsideClick).toHaveBeenCalledTimes(1);
});

test("settling composer queues follow-up messages without exposing run interruption", async () => {
  const onSend = vi.fn(() => true);
  const user = userEvent.setup();
  renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(ChatComposer, createComposerProps({ running: true, settling: true, onSend })),
    ),
  );

  await user.type(screen.getByRole("textbox", { name: "输入消息" }), "继续检查");
  await user.click(screen.getByRole("button", { name: "queue-follow-up" }));

  expect(onSend).toHaveBeenCalledWith("继续检查", undefined, "follow_up");
  expect(screen.queryByRole("button", { name: "cancel" })).not.toBeInTheDocument();
});

test("chat panel fills the composer from an empty-state suggestion without sending", async () => {
  const onSend = vi.fn();
  const user = userEvent.setup();
  resetChatStore({
    activeSessionId: "session-empty",
    sessionOrder: ["session-empty"],
    sessions: {
      "session-empty": {
        sessionId: "session-empty",
        title: "空会话",
        status: "ready",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        entryCount: 0,
        messageCount: 0,
        messages: [],
        runs: [],
      },
    },
  });

  renderWithFrontendProviders(
    React.createElement(
      ChatPanel,
      createChatPanelProps({
        messageActions: {
          ...createMessageActions(),
          onSend,
        },
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "整理日志" }));

  expect(screen.getByText("空会话")).toBeInTheDocument();
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveValue("整理日志");
});

test("a cancelled run with execution events folds its settled process", async () => {
  const user = userEvent.setup();
  const cancelledRun = createRun({
    requestId: "request-cancelled-empty-chat",
    status: "cancelled",
    steps: [
      {
        ...stageTool("cancelled-empty-tool", "WorkspaceRead", "2026-01-01T00:00:00.000Z"),
        agentStep: 0,
        modelMessageIndex: 0,
      },
    ],
  });

  expect(hasRenderableConversationContent([], [cancelledRun])).toBe(true);

  resetChatStore({
    activeSessionId: "session-cancelled-empty-chat",
    sessionOrder: ["session-cancelled-empty-chat"],
    sessions: {
      "session-cancelled-empty-chat": {
        sessionId: "session-cancelled-empty-chat",
        title: "已取消任务",
        status: "ready",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:10.000Z",
        entryCount: 0,
        messageCount: 0,
        messages: [],
        runs: [cancelledRun],
      },
    },
  });

  renderWithFrontendProviders(React.createElement(ChatPanel, createChatPanelProps()));

  expect(screen.queryByRole("button", { name: "整理日志" })).not.toBeInTheDocument();
  // The virtualizer loads lazily behind a Suspense boundary, so the settled
  // turn only reaches the document after the chunk resolves.
  await waitFor(() =>
    expect(document.querySelector("[data-assistant-turn='request-cancelled-empty-chat']")).toBeInTheDocument(),
  );
  const processToggle = await waitFor(() => {
    const element = document.querySelector("[data-settled-turn-toggle]");
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element;
  });
  expect(processToggle).toHaveAttribute("aria-expanded", "false");
  expect(document.querySelector("[data-settled-turn-status='cancelled']")).toHaveTextContent("已取消");
  expect(document.querySelector("[data-settled-turn-process]")).not.toBeInTheDocument();

  await user.click(processToggle);
  await waitFor(() => expect(processToggle).toHaveAttribute("aria-expanded", "true"));
  expect(document.querySelector("[data-settled-turn-process]")).toBeInTheDocument();
  await waitFor(() => expect(document.querySelector("[data-execution-stage-fold]")).toBeInTheDocument());
});

test("chat panel shows the conversation skeleton before history loading is marked", () => {
  resetChatStore({
    activeSessionId: "session-history-pending",
    sessionOrder: ["session-history-pending"],
    sessions: {
      "session-history-pending": {
        sessionId: "session-history-pending",
        title: "待恢复会话",
        status: "ready",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        entryCount: 8,
        messageCount: 6,
        messages: [],
        runs: [],
      },
    },
    historyLoadedIds: {},
    historyLoadingIds: {},
    historyFailedIds: {},
  });

  renderWithFrontendProviders(React.createElement(ChatPanel, createChatPanelProps()));

  expect(screen.getByRole("status", { name: "正在恢复 6 条历史消息" })).toBeVisible();
  expect(document.querySelector("[data-history-skeleton]")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "整理日志" })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "输入消息" })).toBeDisabled();
});

test("chat panel does not own the application catalog loading barrier", () => {
  resetChatStore({
    activeSessionId: null,
    sessionOrder: [],
    sessions: {},
    catalogSynced: { sessions: false },
  });

  renderWithFrontendProviders(React.createElement(ChatPanel, createChatPanelProps()));

  expect(document.querySelector("[data-session-catalog-loading]")).not.toBeNull();
  expect(document.querySelector("[data-chat-loading-surface]")).toBeNull();
  expect(screen.queryByText("今天想做点什么？")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "输入消息" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
});

test("chat panel mounts and updates aggregate state without external-store warnings", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const initialMessage = createMessage({ id: "message-selector", content: "Initial selector message" });
  const updatedMessage = { ...initialMessage, content: "Updated selector message" };
  resetChatStore({
    activeSessionId: "session-selector",
    sessionOrder: ["session-selector"],
    sessions: {
      "session-selector": {
        sessionId: "session-selector",
        title: "Selector session",
        status: "ready",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        entryCount: 1,
        messageCount: 1,
        messages: [initialMessage],
        runs: [],
      },
    },
  });

  renderWithFrontendProviders(React.createElement(ChatPanel, createChatPanelProps()));
  await waitFor(() => expect(screen.getByText("Initial selector message")).toBeInTheDocument());

  act(() => {
    useStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        "session-selector": {
          ...state.sessions["session-selector"],
          messageCount: 2,
          messages: [updatedMessage],
        },
      },
    }));
  });

  await waitFor(() => expect(screen.getByText("Updated selector message")).toBeInTheDocument());
  expect(
    consoleError.mock.calls.some(([message]) =>
      /maximum update depth|getSnapshot should be cached|external store/i.test(String(message)),
    ),
  ).toBe(false);
});

test("message overflow keeps workflow and mutation actions reachable", async () => {
  const user = userEvent.setup();
  const onViewWorkflow = vi.fn();
  const onRegenerate = vi.fn();
  const onDelete = vi.fn();

  renderWithFrontendProviders(
    React.createElement(MessageActions, {
      content: "answer",
      placement: "left",
      hasRequestId: true,
      hasWorkflow: true,
      onViewWorkflow,
      onRegenerate,
      onDelete,
    }),
  );

  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "查看工作流" }));
  expect(onViewWorkflow).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "从此处重新回答" }));
  expect(onRegenerate).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "从此处删除" }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

test("a running turn keeps its non-mutating fork boundary available", async () => {
  const onFork = vi.fn();
  const intents = readMessageActionIntents({
    hasRequestId: true,
    hasWorkflow: true,
    allowFork: true,
    allowMutation: false,
    allowCopy: false,
  });
  expect(intents).toEqual(["viewWorkflow", "fork"]);

  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(MessageActions, {
      content: "",
      placement: "left",
      hasRequestId: true,
      hasWorkflow: true,
      allowFork: true,
      allowMutation: false,
      allowCopy: false,
      onFork,
      onViewWorkflow: vi.fn(),
      onRegenerate: vi.fn(),
      onDelete: vi.fn(),
    }),
  );

  await user.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.getByRole("menuitem", { name: "从此处创建分支" })).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "从此处重新回答" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "从此处删除" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "从此处创建分支" }));
  expect(onFork).toHaveBeenCalledTimes(1);
});

test("a live assistant turn forks from its request boundary before a final reply exists", async () => {
  const requestId = "request-live-fork";
  const onForkFromMessage = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-live-fork",
      turn: {
        __assistantTurn: true,
        key: `assistant-turn:${requestId}:0`,
        requestId,
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [],
        run: createRun({ requestId, status: "running" }),
        streaming: true,
      },
      showInlineActions: true,
      onForkFromMessage,
      onRegenerate: vi.fn(),
      onDeleteFromMessage: vi.fn(),
      onViewWorkflow: vi.fn(),
    }),
  );

  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "从此处创建分支" }));
  expect(onForkFromMessage).toHaveBeenCalledWith({ requestId });
});

test("model thinking stays grouped within each response and keeps response order", async () => {
  const user = userEvent.setup();
  const requestId = "request-inline-thinking";
  await preloadMarkdownRenderer();
  const makeTurn = (latestContent, latestStatus = "streaming") => ({
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    run: createRun({
      requestId,
      status: latestStatus === "streaming" ? "running" : "completed",
      steps: [
        {
          id: `${requestId}-model-1`,
          kind: "model",
          agentStep: 1,
          title: "Calling model",
          status: "running",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      thinkingBlocks: [
        {
          id: "thought-latest-first-in-array",
          step: 2,
          messageIndex: 0,
          contentIndex: 1,
          content: latestContent,
          status: latestStatus,
        },
        {
          id: "thought-earlier",
          step: 1,
          messageIndex: 0,
          contentIndex: 0,
          content: "Inspect the available image tools.",
          status: "complete",
        },
        {
          id: "thought-middle",
          step: 2,
          messageIndex: 0,
          contentIndex: 0,
          content: "Check `ImageGenerate` capability.",
          status: "complete",
        },
      ],
    }),
    streaming: latestStatus === "streaming",
  });
  const renderTurn = (turn) =>
    React.createElement(AssistantTurnRow, {
      sessionId: "session-inline-thinking",
      turn,
      showInlineActions: false,
      onForkFromMessage: vi.fn(),
      onRegenerate: vi.fn(),
      onDeleteFromMessage: vi.fn(),
      onViewWorkflow: vi.fn(),
    });
  const view = renderWithFrontendProviders(renderTurn(makeTurn("**Checking bitmap generation capability**")));

  const readDisclosures = () => [...document.querySelectorAll("[data-model-thinking-disclosure]")];
  const readDisclosure = () => readDisclosures().at(-1);
  const disclosures = readDisclosures();
  expect(disclosures).toHaveLength(2);
  expect(disclosures[0]?.querySelector("[data-model-thinking-preview]")).toHaveTextContent(
    "Inspect the available image tools.",
  );
  const disclosure = readDisclosure();
  expect(disclosure.closest("[data-assistant-turn-stage]")).not.toBeNull();
  const toggle = disclosure.querySelector("[data-model-thinking-toggle-row]");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(disclosure.querySelector("[data-model-thinking-rail]")).toBeNull();
  expect(disclosure.querySelector("[data-thinking-step]")).toBeNull();
  expect(disclosure.querySelector("[data-model-thinking-preview]")).toHaveTextContent(
    "Checking bitmap generation capability",
  );
  await waitFor(() =>
    expect(disclosure.querySelector("[data-model-thinking-preview] strong")).toHaveTextContent(
      "Checking bitmap generation capability",
    ),
  );
  const transcript = await waitFor(() => {
    const element = disclosure.querySelector("[data-model-thinking-transcript]");
    expect(element).not.toBeNull();
    return element;
  });
  expect(transcript.querySelector("code")).toHaveTextContent("ImageGenerate");
  expect(transcript.querySelector("strong")).toHaveTextContent("Checking bitmap generation capability");
  expect(transcript.querySelectorAll("[data-model-thinking-entry]")).toHaveLength(2);
  expect(transcript.querySelectorAll(".model-thinking-disclosure__break")).toHaveLength(0);
  const transcriptText = transcript.textContent;
  expect(transcriptText.indexOf("ImageGenerate")).toBeLessThan(
    transcriptText.indexOf("Checking bitmap generation capability"),
  );

  view.rerender(
    React.createElement(TooltipProvider, { delayDuration: 0 }, renderTurn(makeTurn("**Generating the preview now**"))),
  );
  await waitFor(() =>
    expect(readDisclosure().querySelector("[data-model-thinking-preview] strong")).toHaveTextContent(
      "Generating the preview now",
    ),
  );
  expect(readDisclosure().querySelector("[data-model-thinking-transcript] strong")).toHaveTextContent(
    "Generating the preview now",
  );
  await user.click(readDisclosure().querySelector("[data-model-thinking-toggle-row]"));
  await waitFor(() => expect(readDisclosure().querySelector("[data-model-thinking-transcript]")).toBeNull());

  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      renderTurn(makeTurn("**Still generating the preview**")),
    ),
  );
  await waitFor(() =>
    expect(readDisclosure().querySelector("[data-model-thinking-preview]")).toHaveTextContent(
      "Still generating the preview",
    ),
  );
  expect(readDisclosure().querySelector("[data-model-thinking-toggle-row]")).toHaveAttribute("aria-expanded", "false");

  view.rerender(
    React.createElement(TooltipProvider, { delayDuration: 0 }, renderTurn(makeTurn("Final thought", "complete"))),
  );
  await waitFor(() =>
    expect(readDisclosure().querySelector("[data-model-thinking-toggle-row]")).toHaveAttribute(
      "aria-expanded",
      "false",
    ),
  );
  expect(readDisclosure()).toHaveTextContent("已完成思考");
});

test("the latest feedback and unfinished work in an earlier response animate together", async () => {
  const requestId = "request-waiting-for-next-response";
  const turn = {
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    run: createRun({
      requestId,
      status: "running",
      steps: [
        {
          id: "unfinished-tool-in-prior-response",
          kind: "tool",
          title: "Read workspace",
          status: "running",
          toolName: "WorkspaceRead",
          callId: "unfinished-call",
          agentStep: 1,
          modelMessageIndex: 0,
          modelContentIndex: 1,
          eventSequence: 5,
          startedSequence: 5,
        },
      ],
      thinkingBlocks: [
        {
          id: "thought-previous-response",
          step: 1,
          messageIndex: 0,
          contentIndex: 2,
          eventSequence: 6,
          content: "Checking the selected tool result.",
          status: "complete",
        },
      ],
      activeModelRequest: { agentStep: 1, modelMessageIndex: 1, eventSequence: 9 },
    }),
    streaming: true,
  };

  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-waiting-for-next-response",
      turn,
      showInlineActions: false,
      onForkFromMessage: vi.fn(),
      onRegenerate: vi.fn(),
      onDeleteFromMessage: vi.fn(),
      onViewWorkflow: vi.fn(),
    }),
  );

  await waitFor(() => expect(document.querySelector("[data-tool-batch-activity-title]")).toBeInTheDocument());
  const activityTitle = document.querySelector("[data-tool-batch-activity-title]");
  expect(activityTitle).not.toHaveClass("motion-safe:animate-text-shimmer");
  expect(document.querySelector("[data-tool-action-live]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-action-icon]")).not.toHaveClass("senera-live-status-icon");
  expect(document.querySelector("[data-run-status='running'] [data-thinking-status-text]")).toBeNull();
});

test("cancelled Pi turns keep each response's thinking blocks in its ordered transcript", async () => {
  const user = userEvent.setup();
  const requestId = "request-cancelled-image-generation";
  renderWithFrontendProviders(
    React.createElement(AssistantTurnRow, {
      sessionId: "session-cancelled-image-generation",
      turn: {
        __assistantTurn: true,
        key: `assistant-turn:${requestId}:0`,
        requestId,
        createdAt: "2026-09-25T19:00:33.758Z",
        messages: [],
        run: createRun({
          requestId,
          status: "cancelled",
          thinkingBlocks: [
            {
              id: "step:1:message:0:content:0",
              step: 1,
              messageIndex: 0,
              contentIndex: 0,
              content: "**我正在查找位图生成选项**\n\n**我正在确认白色机枪动画方案**\n\n**我正在准备纯位图动画**",
              status: "complete",
            },
            {
              id: "step:1:message:0:content:1",
              step: 1,
              messageIndex: 0,
              contentIndex: 1,
              content: "**Preparing bitmap animation**\n\n**正在查找位图生成工具**",
              status: "complete",
            },
            {
              id: "step:1:message:1:content:0",
              step: 1,
              messageIndex: 1,
              contentIndex: 0,
              content: "**Preparing image asset**",
              status: "complete",
            },
          ],
        }),
        streaming: false,
      },
      showInlineActions: false,
      onForkFromMessage: vi.fn(),
      onRegenerate: vi.fn(),
      onDeleteFromMessage: vi.fn(),
      onViewWorkflow: vi.fn(),
    }),
  );

  const disclosures = [...document.querySelectorAll("[data-model-thinking-disclosure]")];
  expect(disclosures).toHaveLength(2);
  const firstDisclosure = disclosures[0];
  const lastDisclosure = disclosures[1];
  expect(firstDisclosure.querySelector("[data-model-thinking-preview]")).toHaveTextContent(
    "Preparing bitmap animation",
  );
  expect(lastDisclosure.querySelector("[data-model-thinking-preview]")).toHaveTextContent("Preparing image asset");
  await user.click(firstDisclosure.querySelector("[data-model-thinking-toggle-row]"));
  const firstTranscript = await waitFor(() => {
    const element = firstDisclosure.querySelector("[data-model-thinking-transcript]");
    expect(element).not.toBeNull();
    return element;
  });
  expect(firstTranscript).toHaveTextContent("我正在查找位图生成选项");
  expect(firstTranscript).toHaveTextContent("我正在确认白色机枪动画方案");
  expect(firstTranscript).toHaveTextContent("Preparing bitmap animation");
  await user.click(firstDisclosure.querySelector("[data-model-thinking-toggle-row]"));
  await user.click(lastDisclosure.querySelector("[data-model-thinking-toggle-row]"));
  await waitFor(() =>
    expect(lastDisclosure.querySelector("[data-model-thinking-preview]")).toHaveTextContent("Preparing image asset"),
  );

  const transcript = await waitFor(() => {
    const element = lastDisclosure.querySelector("[data-model-thinking-transcript]");
    expect(element).not.toBeNull();
    return element;
  });
  expect(transcript).toHaveTextContent("Preparing image asset");
  expect(transcript).not.toHaveTextContent("Preparing bitmap animation");
});

test("message list renders messages and streaming run as stable assistant turns", () => {
  const onViewWorkflow = vi.fn();
  const userMessage = createMessage({
    id: "message-user",
    role: "user",
    content: "帮我检查项目",
  });
  const assistantMessage = createMessage({
    id: "message-assistant",
    role: "assistant",
    content: "我准备读取文件。",
  });
  const runningRun = createRun({
    requestId: "request-streaming",
    displayText: "正在执行工具",
  });

  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [userMessage, assistantMessage],
        runs: [runningRun],
        currentRun: runningRun,
        onViewWorkflow,
      }),
    ),
  );

  expect(screen.getByText("帮我检查项目")).toBeInTheDocument();
  expect(screen.getByText("我准备读取文件。")).toBeInTheDocument();
  const streamingTurn = projectAssistantTurns([assistantMessage], [runningRun], runningRun).at(-1);
  expect(
    screen.getByTestId("virtuoso").querySelector("[data-message-key='assistant-turn:request-streaming:0']"),
  ).not.toBeNull();
  expect(readMessageListItemKey(undefined, 4)).toBe("__placeholder__:4");
  expect(readMessageListItemKey(userMessage)).toBe("message-user");
  expect(readMessageListItemKey(streamingTurn)).toBe("assistant-turn:request-streaming:0");
  expect(screen.getByRole("navigation", { name: "回复事件位置" })).toBeInTheDocument();
});

test("message list groups tool prefaces and final replies from one request into one assistant turn", () => {
  const preface = createMessage({
    id: "message-preface",
    requestId: "request-grouped",
    kind: "AssistantToolPreface",
    content: "我先检查项目。",
  });
  const answer = createMessage({
    id: "message-answer",
    requestId: "request-grouped",
    kind: "AssistantFinal",
    content: "检查完成。",
  });

  renderWithFrontendProviders(
    React.createElement(MessageList, createMessageListProps({ messages: [preface, answer] })),
  );

  const turn = document.querySelector("[data-assistant-turn='request-grouped']");
  expect(turn).toContainElement(screen.getByText("我先检查项目。"));
  expect(turn).toContainElement(screen.getByText("检查完成。"));
  expect(turn.querySelector(".assistant-turn-content")).toBeInTheDocument();
  expect(turn.querySelectorAll("[data-message-avatar='assistant']")).toHaveLength(1);
  expect(turn.querySelectorAll("[data-assistant-turn-segment]")).toHaveLength(2);
  const stages = turn.querySelectorAll("[data-assistant-turn-stage]");
  expect(stages).toHaveLength(2);
  expect(stages[0]).toHaveAttribute("data-assistant-turn-stage", "execution");
  expect(stages[0]).toContainElement(screen.getByText("我先检查项目。"));
  expect(stages[0].querySelector("[data-assistant-turn-segment='AssistantToolPreface']")).toBeInTheDocument();
  expect(stages[0].querySelector("[data-tool-stage-details]")).not.toBeInTheDocument();
  expect(stages[1]).toHaveAttribute("data-assistant-turn-stage", "final");
  expect(stages[1]).toContainElement(screen.getByText("检查完成。"));
});

test("assistant turn renders a tool preface before its matching execution activity", async () => {
  const requestId = "request-preface-before-tools";
  const preface = createMessage({
    id: "preface-before-tools",
    requestId,
    kind: "AssistantToolPreface",
    content: "我先读取页面。",
  });
  const answer = createMessage({
    id: "answer-after-tools",
    requestId,
    kind: "AssistantFinal",
    content: "页面读取完成。",
  });
  const run = createRun({
    requestId,
    status: "completed",
    steps: [
      stageMarker(requestId, preface, "decision", "tool_preface", preface.createdAt),
      stageTool("browser-open", "BrowserOpen", preface.createdAt),
      stageMarker(requestId, answer, "answer", "final_answer", answer.createdAt),
    ],
  });

  renderWithFrontendProviders(
    React.createElement(MessageList, createMessageListProps({ messages: [preface, answer], runs: [run] })),
  );

  const processToggle = await waitFor(() => {
    const element = document.querySelector("[data-settled-turn-toggle]");
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element;
  });

  expect(processToggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("页面读取完成。")).toBeInTheDocument();
  expect(screen.queryByText("我先读取页面。")).not.toBeInTheDocument();
  expect(document.querySelector("[data-settled-turn-process]")).not.toBeInTheDocument();

  await userEvent.click(processToggle);
  await waitFor(() => expect(processToggle).toHaveAttribute("aria-expanded", "true"));
  expect(screen.getByText("我先读取页面。")).toBeInTheDocument();
  expect(document.querySelector("[data-settled-turn-process]")).toBeInTheDocument();
  await waitFor(() => expect(document.querySelector("[data-execution-stage-fold]")).toBeInTheDocument());
});

test("assistant turn stages attach each execution batch to its own preface", () => {
  const requestId = "request-staged";
  const sharedTime = "2026-01-01T00:00:00.000Z";
  const firstPreface = createMessage({
    id: "stage-preface-1",
    requestId,
    kind: "AssistantToolPreface",
    content: "先读取入口。",
    createdAt: sharedTime,
  });
  const secondPreface = createMessage({
    id: "stage-preface-2",
    requestId,
    kind: "AssistantToolPreface",
    content: "接着检查依赖。",
    createdAt: sharedTime,
  });
  const answer = createMessage({
    id: "stage-answer",
    requestId,
    kind: "AssistantFinal",
    content: "检查完成。",
    createdAt: sharedTime,
  });
  const run = createRun({
    requestId,
    status: "completed",
    steps: [
      stageMarker(requestId, firstPreface, "decision", "tool_preface", sharedTime),
      stageTool("tool-a", "WorkspaceRead", sharedTime),
      stageMarker(requestId, secondPreface, "decision", "tool_preface", sharedTime),
      stageTool("tool-b", "WorkspaceGrep", sharedTime),
      {
        id: "delegate-reviewer",
        kind: "delegation",
        title: "委派 reviewer",
        status: "done",
        startedAt: sharedTime,
        endedAt: sharedTime,
      },
      stageMarker(requestId, answer, "answer", "final_answer", sharedTime),
    ],
  });
  const turn = {
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt: sharedTime,
    messages: [firstPreface, secondPreface, answer],
    run,
    streaming: false,
  };

  const stages = projectAssistantTurnStages(turn);

  expect(stages).toHaveLength(3);
  expect(stages[0]).toMatchObject({ kind: "execution", message: firstPreface, current: false });
  expect(stages[0].run?.steps.map((step) => step.id)).toEqual(["tool-a"]);
  expect(stages[1]).toMatchObject({ kind: "execution", message: secondPreface, current: false });
  expect(stages[1].run?.steps.map((step) => step.id)).toEqual(["tool-b", "delegate-reviewer"]);
  expect(stages[2]).toMatchObject({ kind: "final", message: answer, current: false, run: undefined });
});
