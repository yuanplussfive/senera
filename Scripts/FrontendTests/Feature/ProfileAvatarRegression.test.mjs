import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { SessionList } = await import("../../../Frontend/src/features/session/SessionList.tsx");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { AvatarCropDialog } = await import("../../../Frontend/src/shared/media/AvatarCropDialog.tsx");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("the shared agent crop dialog saves the cropped image only after confirmation", async () => {
  class LoadedImage {
    naturalWidth = 640;
    naturalHeight = 360;
    onload = null;
    set src(_value) {
      this.onload?.();
    }
  }
  vi.stubGlobal("Image", LoadedImage);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/webp;base64,Y3JvcA==");
  const onApply = vi.fn(async () => {});
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(AvatarCropDialog, {
      initialCrop: { source: "data:image/png;base64,c291cmNl", scale: 1, offsetX: 0, offsetY: 0 },
      onCancel: vi.fn(),
      onApply,
    }),
  );
  await waitFor(() => expect(screen.queryByText(frontendMessage("profile.loadingImage"))).not.toBeInTheDocument());
  expect(onApply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: frontendMessage("profile.useAvatar") }));
  expect(drawImage).toHaveBeenCalledOnce();
  expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith("image/webp", 0.88);
  expect(onApply).toHaveBeenCalledWith("data:image/webp;base64,Y3JvcA==");
});

test("personal settings edit only the human avatar without entering a render loop", async () => {
  class LoadedImage {
    naturalWidth = 320;
    naturalHeight = 240;
    onload = null;
    onerror = null;
    set src(_value) {
      this.onload?.();
    }
  }
  vi.stubGlobal("Image", LoadedImage);

  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(SessionList, {
      onNewSession: vi.fn(),
      onCloseSession: vi.fn(),
      onCloseSessions: vi.fn(),
      onRefreshSessions: vi.fn(),
      onRenameSession: vi.fn(),
      userProfile: {
        name: "Ada",
        avatarDataUrl: null,
        assistant: { name: "Senera", avatarDataUrl: null },
        updatedAt: "",
      },
      onUpdateUserProfile: vi.fn(),
      socketStatus: "open",
      onOpenSettings: vi.fn(),
      presentation: "panel",
    }),
  );

  await user.click(screen.getByRole("button", { name: /Ada/u }));
  await user.click(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.userSettings") }));
  expect(screen.queryByRole("radio", { name: frontendMessage("profile.identity.assistant") })).not.toBeInTheDocument();

  const input = screen.getByRole("dialog").querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  const file = new File([new Uint8Array([137, 80, 78, 71])], "user.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByRole("dialog", { name: frontendMessage("profile.cropTitle") })).toBeVisible());
  await waitFor(() => expect(screen.queryByText(frontendMessage("profile.loadingImage"))).not.toBeInTheDocument());
});
