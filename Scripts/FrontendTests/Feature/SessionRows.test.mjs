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

test("session rows expose an independent selection button without inline actions", async () => {
  const onClick = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(SessionRow, {
      active: true,
      sessionId: "session-1",
      title: "Release plan",
      accent: "idle",
      onClick,
      onRename: vi.fn(),
      onClose: vi.fn(),
    }),
  );

  const selection = screen.getByRole("button", { name: "打开会话：Release plan" });
  expect(selection).toHaveAttribute("aria-current", "true");
  expect(document.querySelector("[data-active-session-indicator]")).not.toBeNull();

  await user.click(selection);

  expect(onClick).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("1 message")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "more" })).not.toBeInTheDocument();
});
