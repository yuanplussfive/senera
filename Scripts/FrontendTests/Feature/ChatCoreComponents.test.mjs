import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { ChatPanel, hasRenderableConversationContent } =
  await import("../../../Frontend/src/features/chat/ChatPanel.tsx");
const { ChatComposer, readComposerAction } = await import("../../../Frontend/src/features/chat/ChatComposer.tsx");
const { ScrollToBottomButton } = await import("../../../Frontend/src/features/chat/ScrollToBottomButton.tsx");
const { MessageActions, readMessageActionIntents } =
  await import("../../../Frontend/src/features/chat/MessageActions.tsx");
const { AssistantTurnRow } = await import("../../../Frontend/src/features/chat/AssistantTurnRow.tsx");
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

  const indicator = screen.getByRole("progressbar", { name: "上下文窗口" });
  expect(indicator).not.toHaveTextContent(/--|%/);
  expect(indicator).toHaveAttribute("aria-valuetext", "等待上下文用量同步");

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

  const populatedIndicator = screen.getByRole("progressbar", { name: "上下文窗口" });
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

test("chat composer derives one trailing action for every run phase", () => {
  expect(readComposerAction({ running: false, settling: false, cancelling: false, canSubmit: false })).toBe("send");
  expect(readComposerAction({ running: true, settling: false, cancelling: false, canSubmit: false })).toBe("cancel");
  expect(readComposerAction({ running: true, settling: false, cancelling: false, canSubmit: true })).toBe("steer");
  expect(readComposerAction({ running: true, settling: true, cancelling: false, canSubmit: true })).toBe("follow_up");
  expect(readComposerAction({ running: true, settling: true, cancelling: true, canSubmit: true })).toBe("cancelling");
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

test("chat composer opens the preset dialog only after the tools menu releases interaction ownership", async () => {
  const onOutsideClick = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(
      React.Fragment,
      null,
      withUploadPreviewProvider(React.createElement(ChatComposer, createComposerProps())),
      React.createElement("button", { type: "button", onClick: onOutsideClick }, "外部操作"),
    ),
  );

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(screen.getByRole("menuitem", { name: frontendChatMessage("chat.composer.toolkit.preset") }));

  expect(await screen.findByRole("dialog", { name: frontendMessage("preset.ui.title") })).toBeInTheDocument();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: frontendMessage("ui.close") }));

  await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
  await user.click(screen.getByRole("button", { name: "外部操作" }));
  expect(onOutsideClick).toHaveBeenCalledTimes(1);
});

test("chat composer opens real settings sections from the toolkit after the menu closes", async () => {
  const onOpenSettings = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    withUploadPreviewProvider(React.createElement(ChatComposer, createComposerProps({ onOpenSettings }))),
  );

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(screen.getByRole("menuitem", { name: frontendChatMessage("chat.composer.toolkit.plugins") }));
  await waitFor(() => expect(onOpenSettings).toHaveBeenCalledWith("mcp-servers"));

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(screen.getByRole("menuitem", { name: frontendChatMessage("chat.composer.toolkit.skills") }));
  await waitFor(() => expect(onOpenSettings).toHaveBeenCalledWith("system-tools"));

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(screen.getByRole("menuitem", { name: frontendChatMessage("chat.composer.toolkit.webSearch") }));
  await waitFor(() => expect(onOpenSettings).toHaveBeenCalledWith("system-tools"));
  expect(onOpenSettings).toHaveBeenCalledTimes(3);
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

test("chat model selector keeps the current conversation choice and exposes the current default", async () => {
  const onApplyDefaultModel = vi.fn();
  const onAddModel = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(
        ChatComposer,
        createComposerProps({
          modelConfig: {
            modelProviders: [
              {
                id: "openai:gpt-4o",
                icon: "openai",
                capabilities: { Chat: true },
                model: "gpt-4o",
                isDefault: false,
              },
              {
                id: "anthropic:sonnet",
                icon: "anthropic",
                capabilities: { Chat: true },
                model: "claude-sonnet",
                isDefault: true,
              },
            ],
            selectedModelProviderId: "openai:gpt-4o",
            defaultModelProviderId: "anthropic:sonnet",
            onSelectModelProvider: vi.fn(),
            onApplyDefaultModel,
            onAddModel,
          },
        }),
      ),
    ),
  );

  expect(screen.getByRole("button", { name: "选择模型" })).not.toHaveClass("focus:ring-2");
  expect(document.querySelector("[data-composer-trailing-controls]")).toContainElement(
    document.querySelector("[data-composer-model-selector]"),
  );

  await user.click(screen.getByRole("button", { name: "选择模型" }));
  expect(screen.getByText("当前对话模型")).toBeInTheDocument();
  expect(screen.getByText("默认模型：claude-sonnet")).toBeInTheDocument();
  expect(screen.getByRole("group")).toHaveClass("overflow-y-auto", "scrollbar-thin");
  await user.click(screen.getByRole("menuitem", { name: "恢复为默认" }));
  expect(onApplyDefaultModel).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "选择模型" }));
  await user.click(screen.getByRole("menuitem", { name: "添加模型" }));
  expect(onAddModel).toHaveBeenCalledTimes(1);
});

test("chat model selector stays available for adding the first model", async () => {
  const onAddModel = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(
        ChatComposer,
        createComposerProps({
          modelConfig: {
            modelProviders: [],
            selectedModelProviderId: null,
            onSelectModelProvider: vi.fn(),
            onAddModel,
          },
        }),
      ),
    ),
  );

  await user.click(screen.getByRole("button", { name: "选择模型" }));
  expect(screen.getByText("还没有添加模型")).toBeVisible();
  await user.click(screen.getByRole("menuitem", { name: "添加模型" }));
  expect(onAddModel).toHaveBeenCalledTimes(1);
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

test("a cancelled run remains renderable when the local message list is empty", () => {
  const cancelledRun = createRun({
    requestId: "request-cancelled-empty-chat",
    status: "cancelled",
    steps: [stageTool("cancelled-empty-tool", "WorkspaceRead", "2026-01-01T00:00:00.000Z")],
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
  expect(document.querySelector("[data-message-list-loading]")).not.toBeNull();
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

test("chat panel keeps the workspace behind one loading barrier until the session catalog arrives", () => {
  resetChatStore({
    activeSessionId: null,
    sessionOrder: [],
    sessions: {},
    catalogSynced: { sessions: false, presets: false },
  });

  renderWithFrontendProviders(React.createElement(ChatPanel, createChatPanelProps()));

  expect(document.querySelector("[data-session-catalog-loading]")).not.toBeNull();
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
      showInlineActions: true,
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
      showInlineActions: true,
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
  expect(document.querySelector("[data-message-list-end-spacer]")).toHaveClass("h-3");
  expect(document.querySelector("[data-message-list-end-spacer]")).not.toHaveClass("h-24");
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
  const user = userEvent.setup();
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

  await waitFor(() => expect(document.querySelector("[data-ui-chrome] button[aria-expanded]")).not.toBeNull());
  const stage = document.querySelector("[data-assistant-turn-stage='execution']");
  const prefaceSegment = stage?.querySelector("[data-assistant-turn-segment='AssistantToolPreface']");

  expect(prefaceSegment).not.toBeNull();
  await waitFor(() => expect(stage?.querySelector("[data-execution-stage-fold]")).toBeInTheDocument());
  const activityFold = stage?.querySelector("[data-execution-stage-fold]");
  expect(activityFold).toBeInstanceOf(HTMLElement);
  expect(activityFold?.querySelector("[data-execution-stage-fold-details]")).not.toBeInTheDocument();

  const activityTrigger = await waitFor(() => {
    const element = activityFold?.querySelector("[data-tool-batch-activity-trigger]");
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element;
  });
  await user.click(activityTrigger);
  await waitFor(() => expect(activityFold?.querySelector("[data-tool-batch-activity-items]")).toBeVisible());
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
