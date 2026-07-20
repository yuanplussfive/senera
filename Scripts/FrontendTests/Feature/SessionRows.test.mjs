import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { SessionRow } = await import("../../../Frontend/src/features/session/SessionRows.tsx");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("session rows expose an independent keyboard-operable selection button", async () => {
  const onClick = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(SessionRow, {
      active: true,
      sessionId: "session-1",
      title: "Release plan",
      accent: "idle",
      onClick,
      showInlineActions: true,
      onRename: vi.fn(),
      onClose: vi.fn(),
    }),
  );

  const selection = screen.getByRole("button", { name: "打开会话：Release plan" });
  expect(selection).toHaveAttribute("aria-current", "true");
  expect(selection.closest("[data-session-row]")).toHaveClass("h-11");
  expect(document.querySelector("[data-active-session-indicator]")).not.toBeNull();

  await user.click(selection);
  selection.focus();
  await user.keyboard("{Enter}");

  expect(onClick).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "more" })).toBeInTheDocument();
});

test("desktop session rows expose context actions without a duplicate overflow button", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(SessionRow, {
      active: false,
      sessionId: "session-2",
      title: "Hidden actions",
      accent: "idle",
      onClick: vi.fn(),
      showInlineActions: false,
      onRename: vi.fn(),
      onClose: vi.fn(),
    }),
  );

  const selection = screen.getByRole("button", { name: "打开会话：Hidden actions" });
  expect(selection.closest("[data-session-row]")).toHaveClass("h-9");
  expect(screen.queryByText("1 message")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "more" })).not.toBeInTheDocument();
  selection.focus();
  await user.keyboard("{Shift>}{F10}{/Shift}");
  expect(await screen.findByRole("menu")).toBeVisible();
});
