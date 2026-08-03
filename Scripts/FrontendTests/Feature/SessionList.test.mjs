import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { SessionList } = await import("../../../Frontend/src/features/session/SessionList.tsx");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { clearPersistedStore, DEFAULT_USER_PROFILE, useStore } =
  await import("../../../Frontend/src/store/sessionStore.ts");

beforeEach(() => {
  clearPersistedStore();
  resetSessionStore();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("session panel renders store sessions and selects a row", async () => {
  const onSessionSelected = vi.fn();
  const user = userEvent.setup();
  resetSessionStore({
    sessions: {
      first: session("first", "First session"),
      second: session("second", "Second session"),
    },
    sessionOrder: ["first", "second"],
    activeSessionId: "first",
  });
  renderWithFrontendProviders(React.createElement(SessionList, createProps({ onSessionSelected })));

  await user.click(screen.getByRole("button", { name: "打开会话：Second session" }));

  expect(useStore.getState().activeSessionId).toBe("second");
  expect(onSessionSelected).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("最近 · 2")).not.toBeInTheDocument();
  const rows = Array.from(document.querySelectorAll("[data-session-row]"));
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => (row.classList.contains("h-11") ? "h-11" : "h-9"))).size).toBe(1);
});

test("integrated sidebar exposes collapse, new-session, and real session search", async () => {
  const onNewSession = vi.fn();
  const onClosePanel = vi.fn();
  const user = userEvent.setup();
  resetSessionStore({
    sessions: {
      first: session("first", "Frontend refactor"),
      second: session("second", "Provider settings"),
    },
    sessionOrder: ["first", "second"],
    activeSessionId: "first",
  });
  renderWithFrontendProviders(
    React.createElement(
      SessionList,
      createProps({
        onNewSession,
        onClosePanel,
      }),
    ),
  );

  const collapseButton = screen.getByRole("button", { name: frontendMessage("session.headerCollapse") });
  const newSessionButton = screen.getByRole("button", { name: frontendMessage("session.new") });
  expect(collapseButton).toHaveClass("text-content-muted");
  expect(newSessionButton).toHaveClass("text-content-muted");
  await user.click(collapseButton);
  await user.click(newSessionButton);
  await user.type(screen.getByRole("searchbox", { name: frontendMessage("session.searchPlaceholder") }), "provider");

  expect(onClosePanel).toHaveBeenCalledTimes(1);
  expect(onNewSession).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Provider settings")).toBeVisible();
  await waitFor(() => expect(screen.queryByText("Frontend refactor")).not.toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: frontendMessage("session.searchClear") }));
  expect(screen.getByRole("searchbox", { name: frontendMessage("session.searchPlaceholder") })).toHaveValue("");
});

test("persistent session sidebar collapses into the prototype tool rail", async () => {
  const user = userEvent.setup();
  resetSessionStore({
    sessions: { first: session("first", "Frontend refactor") },
    sessionOrder: ["first"],
    activeSessionId: "first",
  });
  renderWithFrontendProviders(
    React.createElement(
      SessionList,
      createProps({
        presentation: "auto",
        onClosePanel: undefined,
      }),
    ),
  );

  expect(screen.getByRole("searchbox", { name: frontendMessage("session.searchPlaceholder") })).toBeVisible();
  await user.click(screen.getByRole("button", { name: frontendMessage("session.headerCollapse") }));

  const sidebar = document.querySelector("[data-session-sidebar]");
  expect(sidebar).toHaveAttribute("data-collapsed", "true");
  expect(sidebar).toHaveClass("w-[58px]");
  expect(
    screen.queryByRole("searchbox", { name: frontendMessage("session.searchPlaceholder") }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: frontendMessage("session.headerExpand") })).toBeVisible();
  expect(screen.getByRole("button", { name: frontendMessage("session.new") })).toBeVisible();

  await user.click(screen.getByRole("button", { name: frontendMessage("session.headerExpand") }));
  expect(sidebar).toHaveAttribute("data-collapsed", "false");
  expect(sidebar).toHaveClass("w-[246px]");
  expect(screen.getByRole("searchbox", { name: frontendMessage("session.searchPlaceholder") })).toBeVisible();
});

function createProps(overrides = {}) {
  return {
    onNewSession: vi.fn(),
    onCloseSession: vi.fn(),
    onCloseSessions: vi.fn(),
    onRefreshSessions: vi.fn(),
    onRenameSession: vi.fn(),
    userProfile: DEFAULT_USER_PROFILE,
    onUpdateUserProfile: vi.fn(),
    socketStatus: "open",
    onOpenSettings: vi.fn(),
    presentation: "panel",
    ...overrides,
  };
}

function resetSessionStore(overrides = {}) {
  useStore.setState({
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    motionLevel: "reduced",
    viewedRunIdBySession: {},
    historyLoadedIds: {},
    historyLoadingIds: {},
    historyFailedIds: {},
    historyReplayBuffers: {},
    historyStepBuffers: {},
    historyEventRunIds: {},
    historyActiveRequestIds: {},
    processedEventIds: {},
    processedEventIdOrder: [],
    missingOnServerIds: {},
    pendingCreatedSessionIds: {},
    pendingDeletedSessionIds: {},
    ...overrides,
  });
}

function session(sessionId, title) {
  return {
    sessionId,
    title,
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entryCount: 0,
    messageCount: 0,
    messages: [],
    runs: [],
  };
}
