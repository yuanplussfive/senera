import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { clearTestToastCalls, readTestToastCalls } from "../mocks/sonner.mjs";

const { uploadFileMock } = vi.hoisted(() => ({
  uploadFileMock: vi.fn(),
}));

vi.mock("../../../Frontend/src/api/uploadClient.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  uploadFile: uploadFileMock,
}));

const { ChatComposer } = await import("../../../Frontend/src/features/chat/ChatComposer.tsx");

afterEach(() => {
  cleanup();
  clearTestToastCalls();
  uploadFileMock.mockReset();
  vi.clearAllMocks();
});

test("chat composer waits for an attachment upload and sends the uploaded reference", async () => {
  const attachment = {
    uploadUri: "senera://upload/report",
    name: "report.txt",
    mime: "text/plain",
    size: 6,
    status: "uploaded",
  };
  uploadFileMock.mockImplementation(async (_url, _file, options) => {
    options.onProgress?.({ loaded: 3, total: 6, ratio: 0.5 });
    return attachment;
  });
  const onSend = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(ChatComposer, createComposerProps({ onSend })));

  const fileInput = document.querySelector("input[type='file']");
  await user.upload(fileInput, new File(["report"], "report.txt", { type: "text/plain" }));
  expect(await screen.findByText("report.txt")).toBeVisible();
  await user.type(screen.getByRole("textbox"), "Analyze this report");
  await user.click(screen.getByRole("button", { name: "send" }));

  expect(uploadFileMock).toHaveBeenCalledWith(
    "http://127.0.0.1/api/uploads",
    expect.objectContaining({ name: "report.txt" }),
    expect.objectContaining({ onProgress: expect.any(Function) }),
  );
  expect(onSend).toHaveBeenCalledWith("Analyze this report", [attachment], undefined);
  expect(screen.queryByText("report.txt")).not.toBeInTheDocument();
});

test("chat composer preserves failed attachments for removal and reports the upload error", async () => {
  uploadFileMock.mockRejectedValue(new Error("upload service unavailable"));
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(ChatComposer, createComposerProps()));

  const fileInput = document.querySelector("input[type='file']");
  await user.upload(fileInput, new File(["broken"], "broken.txt", { type: "text/plain" }));

  expect(await screen.findByText("broken.txt")).toBeVisible();
  await waitFor(() => {
    expect(readTestToastCalls()).toContainEqual(
      expect.objectContaining({
        variant: "error",
        options: { description: "upload service unavailable" },
      }),
    );
  });
  await user.click(screen.getByRole("button", { name: "移除附件" }));
  expect(screen.queryByText("broken.txt")).not.toBeInTheDocument();
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
      presetsEnabled: true,
      presetRootDir: "",
      presetOperations: {},
      onRefreshPresets: vi.fn(),
      onSavePreset: vi.fn(() => null),
      onDeletePreset: vi.fn(() => null),
      onSetActivePreset: vi.fn(() => null),
    },
    runtime: {
      socketStatus: "open",
      uploadUrl: "http://127.0.0.1/api/uploads",
    },
    onSend: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}
