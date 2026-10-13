import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";

const { ThinkingTimeline } = await import("../../../Frontend/src/features/workflow/ThinkingTimeline.tsx");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");

beforeEach(() => {
  installMemoryLocalStorage();
  resetFrontendStore();
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("thinking timeline renders its empty state and opens a focused workflow view", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(ThinkingTimeline, { presentation: "panel" }));

  expect(screen.getByText(frontendMessage("workflow.panel.emptyTitle"))).toBeInTheDocument();
  const focusButton = screen.getByRole("button", { name: frontendMessage("workflow.panel.focus") });
  expect(focusButton).toHaveClass("text-content-muted");
  expect(document.querySelector("[data-workflow-execution-content]")).toContainElement(focusButton);
  expect(document.querySelector("[data-window-drag-region]")).not.toContainElement(focusButton);
  await user.click(focusButton);
  expect(screen.getByRole("dialog", { name: frontendMessage("workflow.panel.title") })).toBeInTheDocument();
});
