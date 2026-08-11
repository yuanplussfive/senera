import React from "react";
import { vi } from "vitest";
import { UploadPreviewProvider } from "../../../Frontend/src/features/chat/UploadPreviewRegistry.tsx";
import { clearPersistedStore, DEFAULT_USER_PROFILE, useStore } from "../../../Frontend/src/store/sessionStore.ts";

export function createComposerProps(overrides = {}) {
  return {
    disabled: false,
    running: false,
    modelConfig: {
      modelProviders: [],
      selectedModelProviderId: null,
      onSelectModelProvider: vi.fn(),
    },
    approvalConfig: {
      mode: "agent",
      onSelectMode: vi.fn(),
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

export function createChatPanelProps(overrides = {}) {
  return {
    userProfile: DEFAULT_USER_PROFILE,
    modelConfig: {
      modelProviders: [],
      selectedModelProviderId: null,
      onSelectModelProvider: vi.fn(),
    },
    approvalConfig: {
      mode: "agent",
      onSelectMode: vi.fn(),
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

export function withUploadPreviewProvider(child) {
  return React.createElement(UploadPreviewProvider, null, child);
}

export function createMessageActions(overrides = {}) {
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

export function createMessageListProps(overrides = {}) {
  return {
    sessionId: "session-1",
    uploadUrl: "http://agent.test/api/uploads",
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

export function resetChatStore(overrides = {}) {
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

export function createMessage(overrides = {}) {
  return {
    id: "message-1",
    requestId: "request-1",
    role: "assistant",
    content: "message",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function createUserProfile(name) {
  return {
    name,
    avatarDataUrl: "data:image/png;base64,avatar",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function createApproval(overrides = {}) {
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

export function createRun(overrides = {}) {
  return {
    requestId: "request-1",
    status: "running",
    outputState: "pending",
    input: "run input",
    startedAt: "2026-01-01T00:00:00.000Z",
    steps: [],
    displayText: "",
    displayTarget: "",
    displayedChars: 0,
    visibleKind: "unknown",
    expectedOutputMode: "open",
    ...overrides,
  };
}
