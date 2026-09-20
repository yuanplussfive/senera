import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { ChatComposer, readComposerAction } = await import("../../../Frontend/src/features/chat/ChatComposer.tsx");
const { frontendChatMessage } = await import("../../../Frontend/src/i18n/frontendChatMessageCatalog.ts");
const { createComposerProps, withUploadPreviewProvider } = await import("./chatCoreComponentFixtures.mjs");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("chat composer derives one trailing action for every run phase", () => {
  expect(readComposerAction({ running: false, settling: false, cancelling: false, canSubmit: false })).toBe("send");
  expect(readComposerAction({ running: true, settling: false, cancelling: false, canSubmit: false })).toBe("cancel");
  expect(readComposerAction({ running: true, settling: false, cancelling: false, canSubmit: true })).toBe("steer");
  expect(readComposerAction({ running: true, settling: true, cancelling: false, canSubmit: true })).toBe("follow_up");
  expect(readComposerAction({ running: true, settling: true, cancelling: true, canSubmit: true })).toBe("cancelling");
});

test("chat composer opens real settings sections from the toolkit after the menu closes", async () => {
  const onOpenSettings = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    withUploadPreviewProvider(React.createElement(ChatComposer, createComposerProps({ onOpenSettings }))),
  );

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(screen.getByRole("menuitem", { name: frontendChatMessage("chat.composer.toolkit.plugins") }));
  await waitFor(() => expect(onOpenSettings).toHaveBeenCalledWith("mcp-servers"));

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(screen.getByRole("menuitem", { name: frontendChatMessage("chat.composer.toolkit.skills") }));
  await waitFor(() => expect(onOpenSettings).toHaveBeenCalledWith("system-tools"));

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(screen.getByRole("menuitem", { name: frontendChatMessage("chat.composer.toolkit.webSearch") }));
  await waitFor(() => expect(onOpenSettings).toHaveBeenCalledWith("system-tools"));
  expect(onOpenSettings).toHaveBeenCalledTimes(3);
});
