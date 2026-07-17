import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { SessionList } = await import("../../../Frontend/src/features/session/SessionList.tsx");
const { SessionRow } = await import("../../../Frontend/src/features/session/SessionRows.tsx");
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

test("account menu exposes one settings entry and a flatter profile editor", async () => {
  const user = userEvent.setup();
  const onOpenSettings = vi.fn();
  renderWithFrontendProviders(React.createElement(SessionList, createProps({ onOpenSettings })));

  await user.click(screen.getByRole("button", { name: /用户/ }));
  expect(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.edit") })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.settings") })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.about") })).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "外观设置" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "通用设置" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.settings") }));
  expect(onOpenSettings).toHaveBeenCalledWith(undefined, expect.any(HTMLButtonElement));

  await user.click(screen.getByRole("button", { name: /用户/ }));
  await user.click(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.about") }));
  expect(onOpenSettings).toHaveBeenLastCalledWith("about", expect.any(HTMLButtonElement));

  await user.click(screen.getByRole("button", { name: /用户/ }));
  await user.click(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.edit") }));
  expect(screen.getByRole("dialog", { name: frontendMessage("profile.title") })).toBeVisible();
  const editor = document.querySelector("[data-profile-editor]");
  expect(editor).not.toBeNull();
  expect(editor.querySelector(":scope > .rounded-lg.border")).toBeNull();
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

test("session rename dialog stays open when the command is rejected", async () => {
  const onRenameSession = vi.fn(() => false);
  const user = userEvent.setup();
  resetSessionStore({
    sessions: { first: session("first", "Old title") },
    sessionOrder: ["first"],
    activeSessionId: "first",
  });
  renderWithFrontendProviders(React.createElement(SessionList, createProps({ onRenameSession })));

  await user.click(screen.getByRole("button", { name: "more" }));
  await user.click(await screen.findByRole("menuitem", { name: frontendMessage("session.rename") }));
  await user.clear(screen.getByRole("textbox"));
  await user.type(screen.getByRole("textbox"), "New title");
  await user.click(screen.getByRole("button", { name: frontendMessage("session.save") }));

  expect(onRenameSession).toHaveBeenCalledWith("first", "New title");
  expect(screen.getByRole("dialog", { name: frontendMessage("session.renameDialogTitle") })).toBeVisible();
});

test("desktop session rows use the context menu without a duplicate overflow button", async () => {
  const onRename = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(SessionRow, {
      active: true,
      sessionId: "desktop-session",
      title: "Desktop session",
      accent: "idle",
      onClick: vi.fn(),
      showInlineActions: false,
      onRename,
      onClose: vi.fn(),
    }),
  );

  const sessionButton = screen.getByRole("button", { name: "打开会话：Desktop session" });
  expect(screen.queryByRole("button", { name: "more" })).not.toBeInTheDocument();
  fireEvent.contextMenu(sessionButton, { clientX: 24, clientY: 24 });
  await user.click(await screen.findByRole("menuitem", { name: frontendMessage("session.rename") }));
  expect(onRename).toHaveBeenCalledTimes(1);
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
