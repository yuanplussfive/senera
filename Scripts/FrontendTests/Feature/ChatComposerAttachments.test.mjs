import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
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
const { UploadPreviewProvider } = await import("../../../Frontend/src/features/chat/UploadPreviewRegistry.tsx");

afterEach(() => {
  cleanup();
  clearTestToastCalls();
  uploadFileMock.mockReset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
  renderComposer(
    createComposerProps({
      onSend,
      runtime: {
        socketStatus: "open",
        uploadUrl: "http://127.0.0.1/api/uploads",
        uploadCsrfToken: "csrf-token",
      },
    }),
  );

  const fileInput = document.querySelector("input[type='file']");
  await user.upload(fileInput, new File(["report"], "report.txt", { type: "text/plain" }));
  expect(await screen.findByText("report.txt")).toBeVisible();
  await user.type(screen.getByRole("textbox"), "Analyze this report");
  await user.click(screen.getByRole("button", { name: "send" }));

  expect(uploadFileMock).toHaveBeenCalledWith(
    "http://127.0.0.1/api/uploads",
    expect.objectContaining({ name: "report.txt" }),
    expect.objectContaining({
      headers: { "X-Senera-Csrf": "csrf-token" },
      onProgress: expect.any(Function),
    }),
  );
  expect(onSend).toHaveBeenCalledWith("Analyze this report", [attachment], undefined);
  expect(screen.queryByText("report.txt")).not.toBeInTheDocument();
});

test("chat composer preserves failed attachments for removal and reports the upload error", async () => {
  uploadFileMock.mockRejectedValue(new Error("upload service unavailable"));
  const user = userEvent.setup();
  renderComposer(createComposerProps());

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

test("chat composer prevents disabled and running file drops without uploading", () => {
  renderWithFrontendProviders(
    React.createElement(
      UploadPreviewProvider,
      null,
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ChatComposer, createComposerProps({ disabled: true })),
        React.createElement(ChatComposer, createComposerProps({ running: true })),
      ),
    ),
  );
  const surfaces = document.querySelectorAll("[data-chat-composer]");
  expect(dispatchFileDrop(surfaces[0])).toBe(false);
  expect(dispatchFileDrop(surfaces[1])).toBe(false);
  expect(uploadFileMock).not.toHaveBeenCalled();
});

test("chat composer keeps uploaded attachments when sending is rejected", async () => {
  const attachment = {
    uploadUri: "senera://upload/retry",
    name: "retry.txt",
    mime: "text/plain",
    size: 5,
    status: "uploaded",
  };
  uploadFileMock.mockResolvedValue(attachment);
  const user = userEvent.setup();
  renderComposer(createComposerProps({ onSend: vi.fn(() => false) }));

  await user.upload(
    document.querySelector("input[type='file']"),
    new File(["retry"], "retry.txt", { type: "text/plain" }),
  );
  expect(await screen.findByText("retry.txt")).toBeVisible();
  await user.type(screen.getByRole("textbox"), "Try again");
  await user.click(screen.getByRole("button", { name: "send" }));

  expect(screen.getByRole("textbox")).toHaveValue("Try again");
  expect(screen.getByText("retry.txt")).toBeVisible();
});

test("chat composer previews an original image and transfers its ownership after send", async () => {
  const previewApi = installPreviewUrlApi();
  const attachment = {
    uploadUri: "senera://upload/photo",
    name: "photo.png",
    mime: "image/png",
    size: 5,
    status: "uploaded",
  };
  let uploadOptions;
  let resolveUpload;
  uploadFileMock.mockImplementation(
    (_url, _file, options) =>
      new Promise((resolve) => {
        uploadOptions = options;
        resolveUpload = resolve;
      }),
  );
  const onSend = vi.fn(() => true);
  const user = userEvent.setup();
  const view = renderComposer(createComposerProps({ onSend }));

  await user.upload(
    document.querySelector("input[type='file']"),
    new File(["image"], "photo.png", { type: "image/png" }),
  );
  expect(await screen.findByRole("img", { name: "photo.png" })).toHaveAttribute("src", "blob:senera-preview");
  expect(previewApi.createObjectURL).toHaveBeenCalledTimes(1);

  act(() => uploadOptions.onProgress({ loaded: 2, total: 4, ratio: 0.5 }));
  expect(await screen.findByText("50%")).toBeVisible();

  await act(async () => resolveUpload(attachment));
  await user.type(screen.getByRole("textbox"), "Inspect this image");
  await user.click(screen.getByRole("button", { name: "send" }));

  expect(onSend).toHaveBeenCalledWith("Inspect this image", [attachment], undefined);
  expect(previewApi.revokeObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole("img", { name: "photo.png" })).not.toBeInTheDocument();

  view.unmount();
  expect(previewApi.revokeObjectURL).toHaveBeenCalledWith("blob:senera-preview");
});

test("chat composer releases pending image previews when it unmounts", async () => {
  const previewApi = installPreviewUrlApi();
  uploadFileMock.mockReturnValue(new Promise(() => undefined));
  const user = userEvent.setup();
  const view = renderComposer(createComposerProps());

  await user.upload(
    document.querySelector("input[type='file']"),
    new File(["image"], "pending.png", { type: "image/png" }),
  );
  expect(await screen.findByRole("img", { name: "pending.png" })).toBeVisible();

  view.unmount();
  expect(previewApi.revokeObjectURL).toHaveBeenCalledTimes(1);
});

function dispatchFileDrop(target) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: ["Files"],
      files: [new File(["drop"], "drop.txt", { type: "text/plain" })],
      dropEffect: "move",
    },
  });
  return target.dispatchEvent(event);
}

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

function renderComposer(props) {
  return renderWithFrontendProviders(
    React.createElement(UploadPreviewProvider, null, React.createElement(ChatComposer, props)),
  );
}

function installPreviewUrlApi() {
  const NativeUrl = globalThis.URL;
  class PreviewUrl extends NativeUrl {}
  PreviewUrl.createObjectURL = vi.fn(() => "blob:senera-preview");
  PreviewUrl.revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", PreviewUrl);
  return PreviewUrl;
}
