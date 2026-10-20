import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { SessionList } = await import("../../../Frontend/src/features/session/SessionList.tsx");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("changing the assistant avatar does not enter a render loop", async () => {
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
  await user.click(screen.getByRole("radio", { name: frontendMessage("profile.identity.assistant") }));

  const input = screen.getByRole("dialog").querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  const file = new File([new Uint8Array([137, 80, 78, 71])], "assistant.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByRole("dialog", { name: frontendMessage("profile.cropTitle") })).toBeVisible());
  await waitFor(() => expect(screen.queryByText(frontendMessage("profile.loadingImage"))).not.toBeInTheDocument());
});
