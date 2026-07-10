import React from "react";
import { cleanup, screen } from "@testing-library/react";
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
const {
  clearPersistedStore,
  DEFAULT_USER_PROFILE,
  useStore,
} = await import("../../../Frontend/src/store/sessionStore.ts");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  clearPersistedStore();
});

test("chat composer sends trimmed text and switches queue mode while a run is active", async () => {
  const onSend = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();

  const { rerender } = renderWithFrontendProviders(React.createElement(ChatComposer, createComposerProps({
    onSend,
    onCancel,
  })));

  await user.type(screen.getByRole("textbox"), "  hello project  ");
  await user.click(screen.getByRole("button", { name: "send" }));
  expect(onSend).toHaveBeenLastCalledWith("hello project", undefined, undefined);

  rerender(React.createElement(ChatComposer, createComposerProps({
    running: true,
    onSend,
    onCancel,
  })));

  await user.type(screen.getByRole("textbox"), "steer now");
  await user.keyboard("{Enter}");
  expect(onSend).toHaveBeenLastCalledWith("steer now", undefined, "steer");

  await user.type(screen.getByRole("textbox"), "follow later");
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

  renderWithFrontendProviders(React.createElement(ChatPanel, createChatPanelProps({
    messageActions: {
      ...createMessageActions(),
      onSend,
    },
  })));

  await user.click(screen.getByRole("button", { name: "整理日志" }));

  expect(screen.getByText("空会话")).toBeInTheDocument();
  expect(onSend).toHaveBeenCalledWith("整理日志");
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

  renderWithFrontendProviders(React.createElement(MessageList, createMessageListProps({
    messages: [userMessage, assistantMessage],
    runs: [runningRun],
    currentRun: runningRun,
    onViewWorkflow,
  })));

  expect(screen.getByText("帮我检查项目")).toBeInTheDocument();
  expect(screen.getByText("我准备读取文件。")).toBeInTheDocument();
  expect(screen.getByTestId("virtuoso").querySelector("[data-message-key='__streaming__']")).not.toBeNull();
  expect(readMessageListItemKey(undefined, 4)).toBe("__placeholder__:4");
  expect(readMessageListItemKey(userMessage)).toBe("message-user");
  expect(readMessageListItemKey({ __streaming: true, run: runningRun })).toBe("__streaming__");
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
