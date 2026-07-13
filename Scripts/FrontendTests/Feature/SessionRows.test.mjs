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
      subtitle: "3 messages",
      accent: "idle",
      onClick,
      showInlineActions: true,
      onRename: vi.fn(),
      onClose: vi.fn(),
    }),
  );

  const selection = screen.getByRole("button", { name: "打开会话：Release plan" });
  expect(selection).toHaveAttribute("aria-current", "true");

  await user.click(selection);
  selection.focus();
  await user.keyboard("{Enter}");

  expect(onClick).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "more" })).toBeInTheDocument();
});

test("session row exposes its secondary action when keyboard-focused", () => {
  renderWithFrontendProviders(
    React.createElement(SessionRow, {
      active: false,
      sessionId: "session-2",
      title: "Hidden actions",
      subtitle: "1 message",
      accent: "idle",
      onClick: vi.fn(),
      showInlineActions: false,
      onRename: vi.fn(),
      onClose: vi.fn(),
    }),
  );

  expect(screen.getByRole("button", { name: "more" })).toHaveClass("focus-visible:opacity-100");
});
