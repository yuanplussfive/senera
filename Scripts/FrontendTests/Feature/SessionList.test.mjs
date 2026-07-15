import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { openSettingsSurface } = vi.hoisted(() => ({ openSettingsSurface: vi.fn(() => Promise.resolve()) }));

vi.mock("../../../Frontend/src/app/desktopBridge.ts", () => ({ openSettingsSurface }));

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
  expect(screen.getByText("最近 · 2")).toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: frontendMessage("session.headerCollapse") }));
  await user.click(screen.getByRole("button", { name: frontendMessage("session.new") }));
  await user.type(screen.getByRole("searchbox", { name: frontendMessage("session.searchPlaceholder") }), "provider");

  expect(onClosePanel).toHaveBeenCalledTimes(1);
  expect(onNewSession).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Provider settings")).toBeVisible();
  await waitFor(() => expect(screen.queryByText("Frontend refactor")).not.toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: frontendMessage("session.searchClear") }));
  expect(screen.getByRole("searchbox", { name: frontendMessage("session.searchPlaceholder") })).toHaveValue("");
});

test("session row menu submits a trimmed rename", async () => {
  const onRenameSession = vi.fn();
  const user = userEvent.setup();
  resetSessionStore({
    sessions: { first: session("first", "Old title") },
    sessionOrder: ["first"],
    activeSessionId: "first",
  });
  renderWithFrontendProviders(React.createElement(SessionList, createProps({ onRenameSession })));

  await user.click(screen.getByRole("button", { name: "more" }));
  await user.click(await screen.findByRole("menuitem", { name: frontendMessage("session.rename") }));
  const input = screen.getByRole("textbox");
  await user.clear(input);
  await user.type(input, "  New title  ");
  await user.click(screen.getByRole("button", { name: frontendMessage("session.save") }));

  expect(onRenameSession).toHaveBeenCalledWith("first", "New title");
});

test("session row deletion requires explicit confirmation", async () => {
  const onCloseSession = vi.fn();
  const user = userEvent.setup();
  resetSessionStore({
    sessions: { first: session("first", "Disposable session") },
    sessionOrder: ["first"],
    activeSessionId: "first",
  });
  renderWithFrontendProviders(React.createElement(SessionList, createProps({ onCloseSession })));

  await user.click(screen.getByRole("button", { name: "more" }));
  await user.click(await screen.findByRole("menuitem", { name: "删除历史" }));
  expect(screen.getByRole("dialog", { name: frontendMessage("session.deleteCurrentTitle") })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: frontendMessage("session.deleteCurrentConfirm") }));

  expect(onCloseSession).toHaveBeenCalledWith("first");
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
