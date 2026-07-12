import React, { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAppChatPanelBindings } from "../../../Frontend/src/app/useAppChatPanelBindings.ts";
import { useAppStoreBindings } from "../../../Frontend/src/app/useAppStoreBindings.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
import { clearTestToastCalls, readTestToastCalls } from "../mocks/sonner.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";

beforeEach(() => {
  installMemoryLocalStorage();
  clearTestToastCalls();
  resetFrontendStore();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("useAppStoreBindings projects store and mutation capabilities into stable domain contracts", () => {
  const modelProviders = [{ id: "primary", name: "Primary" }];
  const pluginConfigs = [{ pluginName: "Weather", enabled: true }];
  const presets = [{ name: "default", format: "markdown", content: "hello" }];
  const configMutations = createConfigMutations();
  useStore.setState({
    activePresetName: "default",
    activeSessionId: "session-a",
    modelProviders,
    pluginConfigs,
    presetRootDir: ".senera/presets",
    presets,
    selectedModelProviderId: "primary",
  });
  const handleRef = { current: null };

  const view = render(
    React.createElement(StoreBindingsHarness, {
      configMutations,
      handleRef,
      wsUrl: "ws://127.0.0.1:8787/runtime?ignored=true",
    }),
  );

  const first = handleRef.current;
  expect(first).toMatchObject({
    activeSessionId: "session-a",
    selectedModelProviderId: "primary",
    uploadUrl: "http://127.0.0.1:8787/api/uploads",
  });
  expect(first.chatModelConfig).toMatchObject({
    modelProviders,
    selectedModelProviderId: "primary",
  });
  expect(first.chatPluginConfig).toMatchObject({
    pluginConfigs,
    pluginConfigOperations: configMutations.pluginConfigOperations,
  });
  expect(first.chatPresetConfig).toMatchObject({
    activePresetName: "default",
    presetRootDir: ".senera/presets",
    presets,
  });
  expect(first.chatSystemConfig.onSaveConfig).toBe(configMutations.saveConfig);

  view.rerender(
    React.createElement(StoreBindingsHarness, {
      configMutations,
      handleRef,
      wsUrl: "ws://127.0.0.1:8787/runtime?ignored=true",
    }),
  );
  expect(handleRef.current.chatModelConfig).toBe(first.chatModelConfig);
  expect(handleRef.current.chatPluginConfig).toBe(first.chatPluginConfig);
  expect(handleRef.current.chatPresetConfig).toBe(first.chatPresetConfig);
  expect(handleRef.current.chatSystemConfig).toBe(first.chatSystemConfig);
});

test("useAppStoreBindings updates only the contract whose source state changed", () => {
  const configMutations = createConfigMutations();
  const handleRef = { current: null };
  render(
    React.createElement(StoreBindingsHarness, {
      configMutations,
      handleRef,
      wsUrl: "wss://agent.example.test/socket",
    }),
  );
  const first = handleRef.current;

  act(() => useStore.setState({ selectedModelProviderId: "next" }));

  expect(handleRef.current.uploadUrl).toBe("https://agent.example.test/api/uploads");
  expect(handleRef.current.chatModelConfig).not.toBe(first.chatModelConfig);
  expect(handleRef.current.chatPluginConfig).toBe(first.chatPluginConfig);
  expect(handleRef.current.chatPresetConfig).toBe(first.chatPresetConfig);
  expect(handleRef.current.chatSystemConfig).toBe(first.chatSystemConfig);
});

test("useAppChatPanelBindings sends approvals and exposes only available navigation actions", () => {
  const send = vi.fn(() => true);
  const onOpenSessionPanel = vi.fn();
  const onOpenWorkflowPanel = vi.fn();
  const handleRef = { current: null };
  render(
    React.createElement(ChatPanelBindingsHarness, {
      handleRef,
      send,
      status: "open",
      navigationHandlers: {
        onOpenSessionPanel,
        onOpenWorkflowPanel,
        onRetryHistory: vi.fn(),
        showSessionPanelAction: false,
        showWorkflowPanelAction: true,
      },
    }),
  );

  act(() => handleRef.current.chatMessageActions.onResolveApproval("approval-a", "approved"));

  expect(send).toHaveBeenCalledWith({
    type: "approval.resolve",
    approvalId: "approval-a",
    status: "approved",
  });
  expect(handleRef.current.chatNavigationActions.onOpenSessionPanel).toBeUndefined();
  expect(handleRef.current.chatNavigationActions.onOpenWorkflowPanel).toBe(onOpenWorkflowPanel);
  expect(handleRef.current.chatRuntime).toEqual({
    socketStatus: "open",
    sandboxStatus: null,
    uploadUrl: "http://127.0.0.1/api/uploads",
  });

  act(() => handleRef.current.chatMessageActions.onResolveApproval("approval-fallback", "approved", "session"));
  expect(send).toHaveBeenLastCalledWith({
    type: "approval.resolve",
    approvalId: "approval-fallback",
    status: "approved",
    scope: "session",
  });
});

test.each([
  {
    status: "connecting",
    sendResult: true,
    expectedMessageKey: "approval.resolveOffline",
    expectedSendCount: 0,
  },
  {
    status: "open",
    sendResult: false,
    expectedMessageKey: "approval.resolveDisconnected",
    expectedSendCount: 1,
  },
])(
  "useAppChatPanelBindings reports approval delivery failure for $status sockets",
  ({ expectedSendCount, expectedMessageKey, sendResult, status }) => {
    const send = vi.fn(() => sendResult);
    const handleRef = { current: null };
    render(React.createElement(ChatPanelBindingsHarness, { handleRef, send, status }));

    act(() => handleRef.current.chatMessageActions.onResolveApproval("approval-b", "denied"));

    expect(send).toHaveBeenCalledTimes(expectedSendCount);
    expect(readTestToastCalls()).toContainEqual(
      expect.objectContaining({
        variant: "error",
        title: frontendMessage(expectedMessageKey),
      }),
    );
  },
);

function StoreBindingsHarness({ configMutations, handleRef, wsUrl }) {
  const handle = useAppStoreBindings({ configMutations, wsUrl });
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}

function ChatPanelBindingsHarness({ handleRef, navigationHandlers = createNavigationHandlers(), send, status }) {
  const handle = useAppChatPanelBindings({
    messageHandlers: createMessageHandlers(),
    navigationHandlers,
    runtime: {
      sandboxStatus: null,
      uploadUrl: "http://127.0.0.1/api/uploads",
    },
    send,
    status,
  });
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}

function createMessageHandlers() {
  return {
    onCancel: vi.fn(),
    onDeleteFromMessage: vi.fn(),
    onEditUserMessage: vi.fn(),
    onRegenerate: vi.fn(),
    onSend: vi.fn(),
    onViewWorkflow: vi.fn(),
  };
}

function createNavigationHandlers() {
  return {
    onOpenSessionPanel: vi.fn(),
    onOpenWorkflowPanel: vi.fn(),
    onRetryHistory: vi.fn(),
    showSessionPanelAction: true,
    showWorkflowPanelAction: true,
  };
}

function createConfigMutations() {
  return {
    configOperation: null,
    deletePreset: vi.fn(() => null),
    fetchProviderModels: vi.fn(),
    ingestConfigMutationEvent: vi.fn(() => false),
    pluginConfigOperations: {},
    presetOperations: {},
    providerModelLoadingIds: {},
    refreshConfig: vi.fn(),
    refreshPluginConfigs: vi.fn(),
    refreshPresets: vi.fn(),
    saveConfig: vi.fn(() => null),
    savePluginConfig: vi.fn(() => null),
    savePreset: vi.fn(() => null),
    setActivePreset: vi.fn(() => null),
    setPluginEnabled: vi.fn(() => null),
  };
}
