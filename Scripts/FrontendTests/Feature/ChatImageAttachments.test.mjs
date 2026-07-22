import React from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { MessageAttachments } = await import("../../../Frontend/src/features/chat/MessageAttachments.tsx");
const { UploadPreviewProvider, useUploadPreviewRegistry } =
  await import("../../../Frontend/src/features/chat/UploadPreviewRegistry.tsx");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("sent images use authenticated content URLs and open the full-image dialog", async () => {
  const user = userEvent.setup();
  renderAttachments({
    uploadUrl: "http://agent.test/api/uploads",
    attachments: [imageAttachment("first"), imageAttachment("second")],
  });

  const gallery = document.querySelector("[data-message-image-gallery]");
  expect(gallery).toHaveClass("grid-cols-2", "w-[420px]");
  const firstImage = screen.getByRole("img", { name: "first.png" });
  expect(firstImage).toHaveAttribute("src", "http://agent.test/api/uploads/first/content");
  expect(firstImage).toHaveAttribute("loading", "lazy");
  expect(firstImage).toHaveAttribute("decoding", "async");

  await user.click(screen.getByRole("button", { name: "查看图片：first.png" }));

  const dialog = screen.getByRole("dialog", { name: "查看图片：first.png" });
  expect(dialog).toBeVisible();
  expect(screen.getByRole("button", { name: "缩小" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "适合窗口" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "放大" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "实际尺寸" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "下载原图" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "在新窗口打开原图" })).not.toBeInTheDocument();

  const dialogImage = within(dialog).getByRole("img", { name: "first.png" });
  Object.defineProperties(dialogImage, {
    naturalWidth: { configurable: true, value: 1600 },
    naturalHeight: { configurable: true, value: 900 },
  });
  fireEvent.load(dialogImage);
  await user.click(screen.getByRole("button", { name: "实际尺寸" }));
  expect(dialogImage).toHaveStyle({ width: "1600px", height: "900px", maxWidth: "none" });

  await user.click(screen.getByRole("button", { name: "适合窗口" }));
  expect(dialogImage.style.width).toBe("");
  expect(dialogImage.style.height).toBe("");
});

test("failed image rendering becomes an explicit file attachment state", () => {
  renderAttachments({
    uploadUrl: "http://agent.test/api/uploads",
    attachments: [imageAttachment("broken")],
  });

  fireEvent.error(screen.getByRole("img", { name: "broken.png" }));

  expect(screen.queryByRole("img", { name: "broken.png" })).not.toBeInTheDocument();
  expect(screen.getByText("broken.png")).toBeVisible();
  expect(screen.getByText("图片预览不可用")).toBeVisible();
  expect(document.querySelector("[data-attachment-preview-unavailable='true']")).not.toBeNull();
});

test("image download reads the authenticated original without navigating the workspace", async () => {
  const NativeUrl = globalThis.URL;
  class DownloadUrl extends NativeUrl {}
  DownloadUrl.createObjectURL = vi.fn(() => "blob:senera-download");
  DownloadUrl.revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", DownloadUrl);
  const fetchMock = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(["image"]),
  }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    callback(0);
    return 1;
  });
  const linkClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const user = userEvent.setup();
  renderAttachments({
    uploadUrl: "http://agent.test/api/uploads",
    attachments: [imageAttachment("download")],
  });

  await user.click(screen.getByRole("button", { name: "查看图片：download.png" }));
  await user.click(screen.getByRole("button", { name: "下载原图" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("http://agent.test/api/uploads/download/content", {
      credentials: "include",
    }),
  );
  await waitFor(() => expect(linkClick).toHaveBeenCalledTimes(1));
  expect(DownloadUrl.createObjectURL).toHaveBeenCalledTimes(1);
  expect(DownloadUrl.revokeObjectURL).toHaveBeenCalledWith("blob:senera-download");
});

test("non-image attachments retain the compact file presentation", () => {
  renderAttachments({
    uploadUrl: "http://agent.test/api/uploads",
    attachments: [
      {
        uploadUri: "senera://upload/notes",
        name: "notes.txt",
        mime: "text/plain",
        size: 4,
        status: "uploaded",
      },
    ],
  });

  expect(screen.getByText("notes.txt")).toBeVisible();
  expect(screen.getByText("text/plain · 4B")).toBeVisible();
  expect(document.querySelector("[data-message-image-gallery]")).toBeNull();
});

test("freshly sent images keep the local pixels visible until the canonical source is ready", async () => {
  const NativeUrl = globalThis.URL;
  class PreviewUrl extends NativeUrl {}
  PreviewUrl.revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", PreviewUrl);

  renderWithFrontendProviders(
    React.createElement(
      UploadPreviewProvider,
      null,
      React.createElement(RegisteredPreviewAttachments, {
        attachment: imageAttachment("handoff"),
        previewUrl: "blob:senera-handoff",
      }),
    ),
  );

  const localImage = await waitFor(() => {
    const image = document.querySelector('[data-message-image-source="ephemeral"]');
    expect(image).not.toBeNull();
    return image;
  });
  const canonicalImage = document.querySelector('[data-message-image-source="canonical"]');
  expect(localImage).toHaveAttribute("src", "blob:senera-handoff");
  expect(canonicalImage).toHaveAttribute("src", "http://agent.test/api/uploads/handoff/content");
  expect(canonicalImage).toHaveAttribute("loading", "eager");

  fireEvent.load(canonicalImage);

  await waitFor(() => expect(document.querySelector('[data-message-image-source="ephemeral"]')).toBeNull());
  expect(PreviewUrl.revokeObjectURL).toHaveBeenCalledWith("blob:senera-handoff");
  expect(screen.getByRole("img", { name: "handoff.png" })).toBe(canonicalImage);
});

function imageAttachment(id) {
  return {
    uploadUri: `senera://upload/${id}`,
    name: `${id}.png`,
    mime: "image/png",
    size: 68,
    status: "uploaded",
  };
}

function renderAttachments(props) {
  return renderWithFrontendProviders(
    React.createElement(UploadPreviewProvider, null, React.createElement(MessageAttachments, props)),
  );
}

function RegisteredPreviewAttachments({ attachment, previewUrl }) {
  const registry = useUploadPreviewRegistry();
  React.useLayoutEffect(() => {
    registry.register(attachment.uploadUri, previewUrl);
  }, [attachment.uploadUri, previewUrl, registry]);
  return React.createElement(MessageAttachments, {
    uploadUrl: "http://agent.test/api/uploads",
    attachments: [attachment],
  });
}
