// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { StreamingMarkdownRenderer } from "../../../Frontend/src/shared/code/StreamingMarkdownRenderer.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { ChatComposer, readComposerAction } = await import("../../../Frontend/src/features/chat/ChatComposer.tsx");
const { SessionRow } = await import("../../../Frontend/src/features/session/SessionRows.tsx");
const { frontendChatMessage } = await import("../../../Frontend/src/i18n/frontendChatMessageCatalog.ts");
const { createComposerProps, withUploadPreviewProvider } = await import("./chatCoreComponentFixtures.mjs");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("paints current streaming text without waiting for another animation frame", () => {
  const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  const { rerender } = render(React.createElement(StreamingMarkdownRenderer, null, "第一段"));
  rerender(React.createElement(StreamingMarkdownRenderer, null, "第一段，新的增量"));
  expect(screen.getByText("第一段，新的增量")).toBeVisible();
  rerender(React.createElement(StreamingMarkdownRenderer, null, "另一条消息"));
  expect(screen.getByText("另一条消息")).toBeVisible();
  expect(screen.queryByText("第一段，新的增量")).not.toBeInTheDocument();
  expect(frame).not.toHaveBeenCalled();
});

test("chat composer derives one trailing action for every run phase", () => {
  expect(readComposerAction({ running: false, settling: false, cancelling: false, canSubmit: false })).toBe("send");
  expect(readComposerAction({ running: true, settling: false, cancelling: false, canSubmit: false })).toBe("cancel");
  expect(readComposerAction({ running: true, settling: false, cancelling: false, canSubmit: true })).toBe("steer");
  expect(readComposerAction({ running: true, settling: true, cancelling: false, canSubmit: true })).toBe("follow_up");
  expect(readComposerAction({ running: true, settling: true, cancelling: true, canSubmit: true })).toBe("cancelling");
});

test("chat composer keeps the toolkit to message input actions", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(withUploadPreviewProvider(React.createElement(ChatComposer, createComposerProps())));

  await user.click(screen.getByRole("button", { name: frontendChatMessage("chat.composer.toolkit.tooltip") }));

  expect(
    screen.getByRole("menuitem", { name: frontendChatMessage("chat.composer.toolkit.fileAndImage") }),
  ).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /Agent/ })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "提示词预设" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "插件" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "技能" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "打开工作区" })).not.toBeInTheDocument();
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
  expect(screen.queryByRole("button", { name: "more" })).not.toBeInTheDocument();
});

test("session rows keep the conversation title without inline overflow actions", () => {
  renderWithFrontendProviders(
    React.createElement(SessionRow, {
      active: false,
      sessionId: "session-2",
      title: "Hidden actions",
      accent: "idle",
      onClick: vi.fn(),
      onRename: vi.fn(),
      onClose: vi.fn(),
    }),
  );

  const selection = screen.getByRole("button", { name: "打开会话：Hidden actions" });
  expect(selection.closest("[data-session-row]")).toHaveTextContent("Hidden actions");
  expect(screen.queryByText("1 message")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "more" })).not.toBeInTheDocument();
});
