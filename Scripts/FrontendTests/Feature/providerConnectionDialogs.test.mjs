import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { AddProviderDialog } from "../../../Frontend/src/features/settings/sections/ProviderConnectionDialogs.tsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("pending provider additions cannot be dismissed as if the command were cancelled", () => {
  const onOpenChange = vi.fn();
  const renderDialog = (pending) =>
    React.createElement(AddProviderDialog, {
      open: true,
      providers: [],
      pending,
      error: null,
      onAdd: vi.fn(),
      onOpenChange,
    });

  const view = render(renderDialog(true));
  const cancel = screen.getByRole("button", { name: frontendMessage("settings.action.cancel") });
  const providerId = screen.getByPlaceholderText(frontendMessage("settings.provider.namePlaceholder"));

  expect(cancel).toBeDisabled();
  expect(providerId).toBeDisabled();
  expect(screen.queryByRole("button", { name: frontendMessage("desktop.window.close") })).not.toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(cancel);
  expect(onOpenChange).not.toHaveBeenCalled();

  view.rerender(renderDialog(false));
  fireEvent.click(screen.getByRole("button", { name: frontendMessage("settings.action.cancel") }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
