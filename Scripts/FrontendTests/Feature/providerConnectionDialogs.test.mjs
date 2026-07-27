import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { AddProviderDialog } from "../../../Frontend/src/features/settings/sections/ProviderConnectionDialogs.tsx";
import { DiscardDraftDialog } from "../../../Frontend/src/features/settings/DiscardDraftDialog.tsx";

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

test("discard confirmation explains the consequence and keeps the safe action first", () => {
  const onDiscard = vi.fn();
  const onOpenChange = vi.fn();
  render(
    React.createElement(DiscardDraftDialog, {
      open: true,
      title: "当前连接还有未保存的修改",
      description: "“alpha”的连接修改尚未保存。切换到“beta”将放弃这些修改。",
      consequence: "已经保存的供应商和模型不会改变。",
      continueLabel: "返回继续编辑",
      confirmLabel: "放弃并切换",
      onDiscard,
      onOpenChange,
    }),
  );

  expect(screen.getByRole("dialog", { name: "当前连接还有未保存的修改" })).toHaveTextContent(
    "“alpha”的连接修改尚未保存。切换到“beta”将放弃这些修改。",
  );
  fireEvent.click(screen.getByRole("button", { name: "放弃并切换" }));
  expect(onDiscard).toHaveBeenCalledOnce();
});
