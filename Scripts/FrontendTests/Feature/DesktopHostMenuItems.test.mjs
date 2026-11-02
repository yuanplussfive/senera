import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { ChatComposer } = await import("../../../Frontend/src/features/chat/ChatComposer.tsx");
const { frontendChatMessage } = await import("../../../Frontend/src/i18n/frontendChatMessageCatalog.ts");
const { createComposerProps, withUploadPreviewProvider } = await import("./chatCoreComponentFixtures.mjs");

afterEach(() => {
  cleanup();
  delete window.seneraDesktop;
});

test("desktop host entries follow the capability descriptor", async () => {
  const revealWorkspace = vi.fn(async () => ({ ok: true }));
  const openExternalTerminal = vi.fn(async () => ({ ok: true }));
  window.seneraDesktop = {
    isDesktop: true,
    getHostIntegrationCapabilities: async () => ({ revealWorkspace: true, externalTerminal: true }),
    revealWorkspace,
    openExternalTerminal,
  };
  const user = userEvent.setup();
  renderWithFrontendProviders(withUploadPreviewProvider(React.createElement(ChatComposer, createComposerProps())));

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(
    await screen.findByRole("menuitem", { name: frontendChatMessage("chat.composer.host.openWorkspace") }),
  );
  const revealItem = await screen.findByRole("menuitem", {
    name: frontendChatMessage("chat.composer.host.revealWorkspace"),
  });
  revealItem.focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(revealWorkspace).toHaveBeenCalledTimes(1));

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));
  await user.click(
    await screen.findByRole("menuitem", { name: frontendChatMessage("chat.composer.host.openWorkspace") }),
  );
  const terminalItem = await screen.findByRole("menuitem", {
    name: frontendChatMessage("chat.composer.host.openTerminal"),
  });
  terminalItem.focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(openExternalTerminal).toHaveBeenCalledTimes(1));
});
