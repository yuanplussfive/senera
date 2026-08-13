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
const { projectAssistantTurns, readAssistantTurnActionMessage } = await import(
  "../../../Frontend/src/features/chat/assistantTurnProjection.ts"
);
const { projectAssistantTurnStages } = await import(
  "../../../Frontend/src/features/chat/assistantTurnStageProjection.ts"
);
const {
  ConversationEventRail,
  projectConversationEventMarkers,
  projectConversationEvents,
  readConversationEventIndex,
  readConversationEventPositionIndex,
} = await import("../../../Frontend/src/features/chat/ConversationEventRail.tsx");
const { frontendMessage, FrontendLocales } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
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
  createUserProfile,
  resetChatStore,
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

  await user.click(screen.getByRole("button", { name: frontendMessage("chat.composer.toolkit.tooltip") }));
  await user.click(screen.getByRole("menuitem", { name: frontendMessage("chat.composer.toolkit.preset") }));

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

test("chat panel mounts and updates aggregate state without external-store warnings", () => {
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
  expect(screen.getByText("Initial selector message")).toBeInTheDocument();

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

  expect(screen.getByText("Updated selector message")).toBeInTheDocument();
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
  expect(screen.getByTestId("virtuoso").querySelector("[data-message-key='assistant-turn:request-streaming:0']")).not.toBeNull();
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

test("assistant turn projection preserves a cancelled execution slice between its request and follow-up", () => {
  const requestId = "request-cancelled-slice";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const userMessage = createMessage({
    id: "cancelled-user",
    requestId,
    role: "user",
    content: "检查项目并告诉我结果",
    createdAt: startedAt,
  });
  const followUpMessage = createMessage({
    id: "cancelled-follow-up",
    requestId: "request-follow-up",
    role: "user",
    content: "继续",
    createdAt: "2026-01-01T00:01:00.000Z",
  });
  const cancelledRun = createRun({
    requestId,
    status: "cancelled",
    startedAt,
    endedAt: "2026-01-01T00:00:30.000Z",
    steps: [
      stageTool("cancelled-tool", "WorkspaceRead", startedAt),
      {
        id: `${requestId}-cancelled`,
        kind: "error",
        title: "已取消",
        status: "failed",
        startedAt: "2026-01-01T00:00:30.000Z",
        endedAt: "2026-01-01T00:00:30.000Z",
      },
    ],
  });

  const projected = projectAssistantTurns([userMessage, followUpMessage], [cancelledRun]);

  expect(projected).toHaveLength(3);
  expect(projected[0]).toBe(userMessage);
  expect(projected[1]).toMatchObject({
    key: `assistant-run-slice:${requestId}`,
    requestId,
    streaming: false,
    run: cancelledRun,
  });
  expect(projected[2]).toBe(followUpMessage);

  const stages = projectAssistantTurnStages(projected[1]);
  expect(stages).toHaveLength(1);
  expect(stages[0]).toMatchObject({ kind: "execution", current: false });
  expect(stages[0].run?.steps.map((step) => step.id)).toEqual(["cancelled-tool", `${requestId}-cancelled`]);
});

test("assistant turn exposes one action menu bound to the final reply", async () => {
  const user = userEvent.setup();
  const onRegenerate = vi.fn();
  const preface = createMessage({
    id: "action-preface",
    requestId: "request-actions",
    kind: "AssistantToolPreface",
    content: "先执行工具。",
  });
  const answer = createMessage({
    id: "action-answer",
    requestId: "request-actions",
    kind: "AssistantFinal",
    content: "最终结论。",
  });

  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({ messages: [preface, answer], onRegenerate }),
    ),
  );

  expect(screen.getAllByRole("button", { name: "更多操作" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "从此处重新回答" }));
  expect(onRegenerate).toHaveBeenCalledWith(answer);
});

test("conversation event rail keeps reply landmarks and excludes internal tool activity", () => {
  const events = projectConversationEvents([
    { key: "user-1", requestId: "request-1", eventKind: "user_request", content: "检查构建" },
    {
      key: "preface-1",
      requestId: "request-1",
      eventKind: "assistant_tool_preface",
      content: "我先读取项目配置。",
    },
    {
      key: "preface-2",
      requestId: "request-1",
      eventKind: "assistant_tool_preface",
      content: "我再检查测试配置。",
    },
    { key: "tool-1", requestId: "request-1", eventKind: null, content: "WorkspaceRead completed" },
    { key: "answer-1", requestId: "request-1", eventKind: "assistant_final", content: "构建通过。" },
  ]);

  expect(events).toMatchObject([
    { itemIndex: 0, kind: "user_request", content: "检查构建" },
    { itemIndex: 1, kind: "assistant_tool_preface", content: "我先读取项目配置。" },
    { itemIndex: 4, kind: "assistant_final", content: "构建通过。" },
  ]);
  expect(readConversationEventIndex(events, 2)).toBe(1);
  expect(readConversationEventIndex(events, 3)).toBe(1);
  expect(readConversationEventIndex(events, 4)).toBe(2);
  expect(readConversationEventIndex(events, 99)).toBe(2);
});

test("conversation event rail positions landmarks from measured message heights", () => {
  const events = projectConversationEvents([
    { key: "user-1", requestId: "request-1", eventKind: "user_request", content: "First" },
    { key: "tool-1", requestId: "request-1", eventKind: null, content: "Internal tool" },
    { key: "answer-1", requestId: "request-1", eventKind: "assistant_final", content: "First answer" },
  ]);
  const markers = projectConversationEventMarkers(
    events,
    ["user-1", "tool-1", "answer-1"],
    new Map([
      ["user-1", 100],
      ["tool-1", 300],
      ["answer-1", 100],
    ]),
    132,
  );

  expect(markers.map((marker) => marker.position)).toEqual([0, 0.8]);
});

test("conversation event rail distinguishes landmarks inside one grouped assistant turn", () => {
  const events = projectConversationEvents([
    {
      key: "preface-grouped",
      requestId: "request-grouped",
      eventKind: "assistant_tool_preface",
      content: "开始检查。",
      itemIndex: 1,
      itemProgress: 0.2,
    },
    {
      key: "answer-grouped",
      requestId: "request-grouped",
      eventKind: "assistant_final",
      content: "检查完成。",
      itemIndex: 1,
      itemProgress: 0.8,
    },
  ]);
  const markers = projectConversationEventMarkers(
    events,
    ["user", "assistant-turn"],
    new Map([
      ["user", 100],
      ["assistant-turn", 500],
    ]),
    132,
  );

  expect(markers.map((marker) => marker.position)).toEqual([1 / 3, 5 / 6]);
  expect(readConversationEventIndex(events, 1)).toBe(0);
  expect(readConversationEventPositionIndex(markers, 0.4)).toBe(0);
  expect(readConversationEventPositionIndex(markers, 0.9)).toBe(1);
});

test("conversation event rail previews and navigates to an exact reply event", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  const onActiveEventChange = vi.fn();
  const events = projectConversationEvents([
    { key: "user-1", requestId: "request-1", eventKind: "user_request", content: "检查构建" },
    {
      key: "preface-1",
      requestId: "request-1",
      eventKind: "assistant_tool_preface",
      content: "我先读取配置。",
    },
    { key: "answer-1", requestId: "request-1", eventKind: "assistant_final", content: "构建通过。" },
  ]);

  renderWithFrontendProviders(
    React.createElement(ConversationEventRail, {
      events,
      itemKeys: ["user-1", "preface-1", "answer-1"],
      measuredHeights: new Map(),
      defaultItemHeight: 132,
      activeEventIndex: 0,
      scroller: null,
      reducedMotion: false,
      onActiveEventChange,
      onNavigate,
      onManualScrollStart: vi.fn(),
      onManualScrollEnd: vi.fn(),
    }),
  );

  expect(screen.getByRole("button", { name: "跳到第 1 个事件：用户请求" })).toHaveAttribute(
    "data-kind",
    "user_request",
  );
  const finalReply = screen.getByRole("button", { name: "跳到第 3 个事件：最终回复" });
  expect(finalReply).toHaveAttribute("data-kind", "assistant_final");
  await user.hover(finalReply);
  expect(screen.getByRole("tooltip")).toHaveTextContent("第 3/3 个回复事件");
  expect(screen.getByRole("tooltip")).toHaveTextContent("最终回复");
  expect(screen.getByRole("tooltip")).toHaveTextContent("构建通过。");

  await user.click(finalReply);
  expect(onActiveEventChange).toHaveBeenCalledWith(2);
  expect(onNavigate).toHaveBeenCalledWith(events[2]);
});

test("message list reveals an available final answer while the run is still settling", async () => {
  const answer = createMessage({
    id: "message-available-answer",
    requestId: "request-available-answer",
    content: "Answer is already available.",
  });
  const settlingRun = createRun({
    requestId: "request-available-answer",
    outputState: "available",
    visibleKind: "final_answer",
    displayMessageId: answer.id,
    liveActivity: "compacting_context",
  });

  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({ messages: [answer], runs: [settlingRun], currentRun: settlingRun }),
    ),
  );

  await waitFor(() => expect(screen.getByText("Answer is already available.")).toBeVisible());
  expect(
    screen.getByText(
      frontendMessage("workflow.activity.running", {
        activity: frontendMessage("workflow.activity.compactingContext"),
      }),
    ),
  ).toBeVisible();
});

test("message list accepts repeated scroller refs without a render loop", () => {
  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [createMessage({ id: "message-repeat", role: "user", content: "keep scrolling" })],
      }),
    ),
  );

  expect(screen.getByText("keep scrolling")).toBeInTheDocument();
});

test("message list refreshes the user profile while keeping the project identity", () => {
  const userMessage = createMessage({ id: "message-user-profile", role: "user", content: "hello" });
  const assistantMessage = createMessage({ id: "message-provider", role: "assistant", content: "answer" });
  const { rerender } = renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [userMessage, assistantMessage],
        userProfile: createUserProfile("Ada"),
      }),
    ),
  );

  expect(screen.getByAltText("Ada")).toBeInTheDocument();
  expect(screen.getByText("Senera")).toHaveClass("text-[13.5px]", "font-semibold");
  expect(document.querySelector("[data-message-avatar='assistant']")).toHaveClass("h-8", "w-8");
  expect(document.querySelector('[data-message-avatar="assistant"] img[src="./favicon.svg"]')).not.toBeNull();
  expect(document.querySelector("[data-message-avatar='assistant']")).not.toHaveClass(
    "rounded-full",
    "border",
    "bg-paper-100",
  );
  expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  expect(screen.getByAltText("Ada").closest("[data-message-avatar='user']")).toHaveClass("h-8", "w-8");
  expect(screen.getByText("hello").closest(".conversation-frame--user")).toHaveClass("items-start", "justify-end");
  expect(screen.getByText("hello")).toHaveClass("cursor-pointer");

  rerender(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [userMessage, assistantMessage],
        userProfile: createUserProfile("Grace"),
      }),
    ),
  );

  expect(screen.getByAltText("Grace")).toBeInTheDocument();
  expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  expect(document.querySelector('[data-message-avatar="assistant"] img[src="./favicon.svg"]')).not.toBeNull();
});

test("user messages edit inline and keep the existing replay command", async () => {
  const user = userEvent.setup();
  const onEditUserMessage = vi.fn();
  const userMessage = createMessage({
    id: "message-inline-edit",
    requestId: "request-inline-edit",
    role: "user",
    content: "原始问题",
  });
  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [userMessage],
        onEditUserMessage,
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "编辑这条消息" }));

  const editor = screen.getByRole("textbox", { name: "编辑用户消息" });
  expect(editor).toHaveValue("原始问题");
  expect(screen.queryByRole("dialog", { name: "编辑用户消息" })).not.toBeInTheDocument();
  await user.clear(editor);
  await user.type(editor, "更新后的问题");
  await user.click(screen.getByRole("button", { name: "保存并重新回答" }));

  expect(onEditUserMessage).toHaveBeenCalledWith(userMessage, "更新后的问题");
  expect(screen.queryByRole("textbox", { name: "编辑用户消息" })).not.toBeInTheDocument();
});

test("completed assistant turns keep workflow details out of the final stage", async () => {
  const user = userEvent.setup();
  const onViewWorkflow = vi.fn();
  const assistantMessage = createMessage({
    id: "message-completed-workflow",
    requestId: "request-completed-workflow",
    content: "Completed answer body",
  });
  const completedRun = createRun({
    requestId: "request-completed-workflow",
    status: "completed",
    endedAt: "2026-01-01T00:00:03.000Z",
    visibleKind: "final_answer",
    steps: [
      {
        id: "answer-step",
        kind: "answer",
        title: "生成回复",
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:03.000Z",
      },
    ],
  });

  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [assistantMessage],
        runs: [completedRun],
        onViewWorkflow,
      }),
    ),
  );

  const answer = screen.getByText("Completed answer body");
  const finalStage = answer.closest("[data-assistant-turn-stage='final']");
  expect(finalStage).toContainElement(answer);
  expect(screen.queryByRole("button", { name: /已完成.*1 步.*3\.0s/ })).not.toBeInTheDocument();
  expect(screen.queryByText("生成回复")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "查看工作流" }));
  expect(onViewWorkflow).toHaveBeenCalledTimes(1);
});

function stageMarker(requestId, message, kind, decisionKind, startedAt) {
  return {
    id: `${requestId}-assistant-message-${message.id}`,
    kind,
    title: message.content,
    status: "done",
    startedAt,
    endedAt: startedAt,
    decisionKind,
  };
}

function stageTool(id, toolName, startedAt, status = "done") {
  return {
    id,
    kind: "tool",
    title: `调用 ${toolName}`,
    status,
    startedAt,
    endedAt: status === "running" ? undefined : startedAt,
    toolName,
    callId: id,
  };
}

test("streaming approvals refresh when their content changes at the same length", async () => {
  const initialRun = createRun({
    approvals: [createApproval({ subject: { kind: "tool_call", toolName: "Read config", arguments: {} } })],
    revision: 1,
  });
  const { rerender } = renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        currentRun: initialRun,
        runs: [initialRun],
      }),
    ),
  );

  expect(await screen.findByText("Read config")).toBeInTheDocument();

  const updatedRun = {
    ...initialRun,
    approvals: [createApproval({ subject: { kind: "tool_call", toolName: "Write config", arguments: {} } })],
  };
  rerender(
    React.createElement(
      MessageList,
      createMessageListProps({
        currentRun: updatedRun,
        runs: [updatedRun],
      }),
    ),
  );

  expect(await screen.findByText("Write config")).toBeInTheDocument();
  expect(screen.queryByText("Read config")).not.toBeInTheDocument();
});
