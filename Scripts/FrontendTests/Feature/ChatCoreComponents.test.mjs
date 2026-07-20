import React from "react";
import { act, cleanup, screen } from "@testing-library/react";
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
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { readMessageActionIntents } = await import("../../../Frontend/src/features/chat/MessageActions.tsx");
const { clearPersistedStore, DEFAULT_USER_PROFILE, useStore } =
  await import("../../../Frontend/src/store/sessionStore.ts");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  clearPersistedStore();
});

test("message actions expose fork only for stable mutable request boundaries", () => {
  expect(readMessageActionIntents({ hasRequestId: false, hasWorkflow: false })).toEqual(["copy"]);
  expect(readMessageActionIntents({ hasRequestId: true, hasWorkflow: false })).toEqual([
    "copy",
    "fork",
    "regenerate",
    "delete",
  ]);
  expect(readMessageActionIntents({ hasRequestId: true, hasWorkflow: true, allowMutation: false })).toEqual([
    "copy",
    "viewWorkflow",
  ]);
});

test("chat composer sends trimmed text and switches queue mode while a run is active", async () => {
  const onSend = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();

  const { rerender } = renderWithFrontendProviders(
    React.createElement(
      ChatComposer,
      createComposerProps({
        onSend,
        onCancel,
      }),
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
    React.createElement(
      ChatComposer,
      createComposerProps({
        running: true,
        onSend,
        onCancel,
      }),
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
    React.createElement(
      React.Fragment,
      null,
      React.createElement(ChatComposer, createComposerProps({ running: true, onSend, onCancel })),
      React.createElement("div", { role: "dialog", "aria-label": "Open dialog" }, "Dialog content"),
    ),
  );

  const composer = screen.getByRole("textbox", { name: "输入消息" });
  await user.type(composer, "preserve this draft");
  await user.keyboard("{Enter}");
  expect(composer).toHaveValue("preserve this draft");

  await user.keyboard("{Escape}");
  expect(onCancel).not.toHaveBeenCalled();

  rerender(React.createElement(ChatComposer, createComposerProps({ running: true, onSend, onCancel })));
  const preventedEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  preventedEscape.preventDefault();
  window.dispatchEvent(preventedEscape);
  expect(onCancel).not.toHaveBeenCalled();
});

test("chat model selector keeps the current conversation choice and exposes the current default", async () => {
  const onApplyDefaultModel = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
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
  );

  expect(screen.getByRole("button", { name: "选择模型" })).not.toHaveClass("focus:ring-2");

  await user.click(screen.getByRole("button", { name: "选择模型" }));
  expect(screen.getByText("当前对话模型")).toBeInTheDocument();
  expect(screen.getByText("默认模型：claude-sonnet")).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "恢复为默认" }));
  expect(onApplyDefaultModel).toHaveBeenCalledTimes(1);
});

test("chat panel routes grouped message actions through the empty state", async () => {
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
  expect(onSend).toHaveBeenCalledWith("整理日志");
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

test("message list renders messages and streaming run as stable keyed items", () => {
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
  expect(screen.getByTestId("virtuoso").querySelector("[data-message-key='__streaming__']")).not.toBeNull();
  expect(readMessageListItemKey(undefined, 4)).toBe("__placeholder__:4");
  expect(readMessageListItemKey(userMessage)).toBe("message-user");
  expect(readMessageListItemKey({ __streaming: true, run: runningRun })).toBe("__streaming__");
  expect(document.querySelector("[data-message-list-end-spacer]")).toHaveClass("h-3");
  expect(document.querySelector("[data-message-list-end-spacer]")).not.toHaveClass("h-24");
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
  expect(document.querySelector('[data-message-avatar="assistant"] img[src="/favicon.svg"]')).not.toBeNull();
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
  expect(document.querySelector('[data-message-avatar="assistant"] img[src="/favicon.svg"]')).not.toBeNull();
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

test("completed workflow disclosure expands inline below assistant metadata", async () => {
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

  const disclosure = screen.getByRole("button", { name: /已完成.*1 步.*3\.0s/ });
  const answer = screen.getByText("Completed answer body");
  expect(disclosure.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

  await user.click(disclosure);
  const detail = screen.getByText("生成回复");
  expect(disclosure.closest(".conversation-frame--wide")).toContainElement(detail);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "查看完整工作流" }));
  expect(onViewWorkflow).toHaveBeenCalledTimes(1);
});

test("streaming approvals refresh when their content changes at the same length", () => {
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

  expect(screen.getByText("Read config")).toBeInTheDocument();

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

  expect(screen.getByText("Write config")).toBeInTheDocument();
  expect(screen.queryByText("Read config")).not.toBeInTheDocument();
});

function createComposerProps(overrides = {}) {
  return {
    disabled: false,
    running: false,
    modelConfig: {
      modelProviders: [],
      selectedModelProviderId: null,
      onSelectModelProvider: vi.fn(),
    },
    pluginConfig: {
      pluginConfigs: [],
      pluginConfigOperations: {},
      onRefreshPluginConfigs: vi.fn(),
      onSavePluginConfig: vi.fn(() => null),
      onSetPluginEnabled: vi.fn(() => null),
    },
    systemConfig: {
      configSnapshot: null,
      configOperation: null,
      providerModelCatalogs: {},
      providerModelErrors: {},
      providerModelLoadingIds: {},
      onRefreshConfig: vi.fn(),
      onSaveConfig: vi.fn(() => null),
      onFetchProviderModels: vi.fn(),
    },
    presetConfig: {
      presets: [],
      activePresetName: null,
      presetsEnabled: false,
      presetRootDir: "",
      presetOperations: {},
      onRefreshPresets: vi.fn(),
      onSavePreset: vi.fn(() => null),
      onDeletePreset: vi.fn(() => null),
      onSetActivePreset: vi.fn(() => null),
    },
    runtime: {
      socketStatus: "open",
      uploadUrl: "/upload",
    },
    onSend: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function createChatPanelProps(overrides = {}) {
  return {
    userProfile: DEFAULT_USER_PROFILE,
    modelConfig: {
      modelProviders: [],
      selectedModelProviderId: null,
      onSelectModelProvider: vi.fn(),
    },
    pluginConfig: {
      pluginConfigs: [],
      pluginConfigOperations: {},
      onRefreshPluginConfigs: vi.fn(),
      onSavePluginConfig: vi.fn(() => null),
      onSetPluginEnabled: vi.fn(() => null),
    },
    systemConfig: {
      configSnapshot: null,
      configOperation: null,
      providerModelCatalogs: {},
      providerModelErrors: {},
      providerModelLoadingIds: {},
      onRefreshConfig: vi.fn(),
      onSaveConfig: vi.fn(() => null),
      onFetchProviderModels: vi.fn(),
    },
    presetConfig: {
      presets: [],
      activePresetName: null,
      presetsEnabled: false,
      presetRootDir: "",
      presetOperations: {},
      onRefreshPresets: vi.fn(),
      onSavePreset: vi.fn(() => null),
      onDeletePreset: vi.fn(() => null),
      onSetActivePreset: vi.fn(() => null),
    },
    runtime: {
      socketStatus: "open",
      uploadUrl: "/upload",
    },
    messageActions: createMessageActions(),
    navigationActions: {},
    ...overrides,
  };
}

function createMessageActions(overrides = {}) {
  return {
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onForkFromMessage: vi.fn(),
    onRegenerate: vi.fn(),
    onEditUserMessage: vi.fn(),
    onDeleteFromMessage: vi.fn(),
    onViewWorkflow: vi.fn(),
    onResolveApproval: vi.fn(),
    ...overrides,
  };
}

function createMessageListProps(overrides = {}) {
  return {
    sessionId: "session-1",
    messages: [],
    runs: [],
    userProfile: {
      name: "Tester",
      avatarDataUrl: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    onForkFromMessage: vi.fn(),
    onRegenerate: vi.fn(),
    onEditUserMessage: vi.fn(),
    onDeleteFromMessage: vi.fn(),
    onViewWorkflow: vi.fn(),
    onResolveApproval: vi.fn(),
    ...overrides,
  };
}

function resetChatStore(overrides = {}) {
  clearPersistedStore();
  useStore.setState({
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
    historyLoadingIds: {},
    historyFailedIds: {},
    ...overrides,
  });
}

function createMessage(overrides = {}) {
  return {
    id: "message-1",
    requestId: "request-1",
    role: "assistant",
    content: "message",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createUserProfile(name) {
  return {
    name,
    avatarDataUrl: "data:image/png;base64,avatar",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createApproval(overrides = {}) {
  return {
    approvalId: "approval-1",
    status: "pending",
    approvalKind: "tool_call",
    availableDecisions: ["approve_once", "deny", "deny_and_interrupt"],
    title: "Review tool call",
    reason: "The tool needs approval.",
    subject: {
      kind: "tool_call",
      toolName: "Read config",
      arguments: {},
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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
