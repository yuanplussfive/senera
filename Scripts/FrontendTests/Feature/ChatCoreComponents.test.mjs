import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { ChatPanel } = await import("../../../Frontend/src/features/chat/ChatPanel.tsx");
const { ChatComposer } = await import("../../../Frontend/src/features/chat/ChatComposer.tsx");
const { ScrollToBottomButton } = await import("../../../Frontend/src/features/chat/ScrollToBottomButton.tsx");
const { MessageActions } = await import("../../../Frontend/src/features/chat/MessageActions.tsx");
const { MessageList, readMessageListItemKey } = await import("../../../Frontend/src/features/chat/MessageList.tsx");
const { projectAssistantTurns, readAssistantTurnActionMessage } =
  await import("../../../Frontend/src/features/chat/assistantTurnProjection.ts");
const { projectAssistantTurnStages } =
  await import("../../../Frontend/src/features/chat/assistantTurnStageProjection.ts");
const { frontendMessage, FrontendLocales } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { frontendChatMessage } = await import("../../../Frontend/src/i18n/frontendChatMessageCatalog.ts");
const { setFrontendLocale } = await import("../../../Frontend/src/i18n/frontendLocaleStore.ts");
const { clearPersistedStore, useStore } = await import("../../../Frontend/src/store/sessionStore.ts");
const {
  createApproval,
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

  const indicator = screen.getByRole("progressbar", { name: "上下文已使用" });
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

  const populatedIndicator = screen.getByRole("progressbar", { name: "上下文已使用" });
  expect(populatedIndicator).not.toHaveTextContent("10.07%");
  expect(populatedIndicator).toHaveAttribute("aria-valuetext", "10.07%");
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
          },
        }),
      ),
    ),
  );

  expect(screen.getByRole("button", { name: "选择模型" })).not.toHaveClass("focus:ring-2");

  await user.click(screen.getByRole("button", { name: "选择模型" }));
  expect(screen.getByText("当前对话模型")).toBeInTheDocument();
  expect(screen.getByText("默认模型：claude-sonnet")).toBeInTheDocument();
  expect(screen.getByRole("group")).toHaveClass("overflow-y-auto", "scrollbar-thin");
  await user.click(screen.getByRole("menuitem", { name: "恢复为默认" }));
  expect(onApplyDefaultModel).toHaveBeenCalledTimes(1);
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
