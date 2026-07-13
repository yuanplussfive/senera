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
const { MessageList, readMessageListItemKey } = await import("../../../Frontend/src/features/chat/MessageList.tsx");
const { clearPersistedStore, DEFAULT_USER_PROFILE, useStore } =
  await import("../../../Frontend/src/store/sessionStore.ts");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  clearPersistedStore();
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
  expect(composer).toHaveClass("focus-visible:ring-2");
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
});

test("message list accepts repeated scroller refs without a render loop", () => {
  renderWithFrontendProviders(React.createElement(MessageList, createMessageListProps({
    messages: [createMessage({ id: "message-repeat", role: "user", content: "keep scrolling" })],
  })));

  expect(screen.getByText("keep scrolling")).toBeInTheDocument();
});

test("message list refreshes profile and selected provider presentation", () => {
  const userMessage = createMessage({ id: "message-user-profile", role: "user", content: "hello" });
  const assistantMessage = createMessage({ id: "message-provider", role: "assistant", content: "answer" });
  const { rerender } = renderWithFrontendProviders(React.createElement(MessageList, createMessageListProps({
    assistantAvatarIcon: "sparkles",
    messages: [userMessage, assistantMessage],
    selectedModelProvider: createProvider("Alpha"),
    userProfile: createUserProfile("Ada"),
  })));

  expect(screen.getByAltText("Ada")).toBeInTheDocument();
  expect(screen.getByText("Alpha")).toBeInTheDocument();

  rerender(React.createElement(MessageList, createMessageListProps({
    assistantAvatarIcon: "bot",
    messages: [userMessage, assistantMessage],
    selectedModelProvider: createProvider("Beta"),
    userProfile: createUserProfile("Grace"),
  })));

  expect(screen.getByAltText("Grace")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
});

test("streaming approvals refresh when their content changes at the same length", () => {
  const initialRun = createRun({
    approvals: [createApproval({ subject: { kind: "tool_call", toolName: "Read config", arguments: {} } })],
    revision: 1,
  });
  const { rerender } = renderWithFrontendProviders(React.createElement(MessageList, createMessageListProps({
    currentRun: initialRun,
    runs: [initialRun],
  })));

  expect(screen.getByText("Read config")).toBeInTheDocument();

  const updatedRun = {
    ...initialRun,
    approvals: [createApproval({ subject: { kind: "tool_call", toolName: "Write config", arguments: {} } })],
  };
  rerender(React.createElement(MessageList, createMessageListProps({
    currentRun: updatedRun,
    runs: [updatedRun],
  })));

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
      sandboxStatus: null,
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

function createProvider(model) {
  return {
    id: model.toLowerCase(),
    capabilities: { Chat: true },
    kind: "openai-compatible",
    endpoint: "chat",
    baseUrl: "https://example.test",
    model,
    isDefault: false,
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
