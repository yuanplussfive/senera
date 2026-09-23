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
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { FrontendDefaultLocale } = await import("../../../Frontend/src/i18n/frontendLocaleModel.ts");
const { setFrontendLocale } = await import("../../../Frontend/src/i18n/frontendLocaleStore.ts");
const { clearPersistedStore, DEFAULT_USER_PROFILE, useStore } =
  await import("../../../Frontend/src/store/sessionStore.ts");

beforeEach(() => {
  clearPersistedStore();
  setFrontendLocale(FrontendDefaultLocale);
  resetSessionStore();
});

afterEach(() => {
  cleanup();
  setFrontendLocale(FrontendDefaultLocale);
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

test("hides a session after the backend confirms that its history is missing", () => {
  resetSessionStore({
    sessions: {
      stale: session("stale", "Stale local placeholder"),
      current: session("current", "Current session"),
    },
    sessionOrder: ["stale", "current"],
    activeSessionId: "current",
    missingOnServerIds: { stale: true },
  });

  renderWithFrontendProviders(React.createElement(SessionList, createProps()));

  expect(screen.queryByText("Stale local placeholder")).not.toBeInTheDocument();
  expect(screen.getByText("Current session")).toBeVisible();
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

test("moves channel filtering into the Senera menu", async () => {
  const user = userEvent.setup();
  const first = session("first", "Frontend refactor");
  const second = session("second", "QQ support");
  second.channel = { platform: "qq" };
  resetSessionStore({
    sessions: { first, second },
    sessionOrder: ["first", "second"],
    activeSessionId: "first",
  });
  renderWithFrontendProviders(React.createElement(SessionList, createProps()));

  await user.click(screen.getByRole("button", { name: "Senera" }));

  expect(screen.getByRole("menuitem", { name: frontendMessage("session.channel.all") })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: frontendMessage("session.channel.qq") })).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: `${frontendMessage("session.channel.filter")}: ${frontendMessage("session.channel.all")}`,
    }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("menuitem", { name: frontendMessage("session.channel.qq") }));
  await waitFor(() => {
    expect(screen.queryByText("Frontend refactor")).not.toBeInTheDocument();
    expect(screen.getByText("QQ support")).toBeVisible();
  });
});

test("switches profile preferences and keeps settings last", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(SessionList, createProps()));

  await user.click(screen.getByRole("button", { name: new RegExp(DEFAULT_USER_PROFILE.name) }));
  const menu = screen.getByRole("menu");
  expect(menu).toBeVisible();
  expect(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.userSettings") })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.settings") })).toBeVisible();

  await user.hover(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.theme") }));
  await waitFor(() =>
    expect(screen.getByRole("menuitem", { name: frontendMessage("appearance.themeMode.dark") })).toBeVisible(),
  );

  await user.hover(screen.getByRole("menuitem", { name: frontendMessage("profile.menu.language") }));
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "English" })).toBeVisible());
  fireEvent.click(screen.getByRole("menuitem", { name: "English" }));

  expect(frontendMessage("profile.menu.userSettings")).toBe("User settings");
  await user.click(screen.getByRole("button", { name: new RegExp(DEFAULT_USER_PROFILE.name) }));
  expect(screen.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  expect(
    screen.getByRole("menuitem", {
      name: frontendMessage("profile.menu.language"),
    }),
  ).toBeVisible();
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
  expect(sidebar).toHaveClass("m-2.5", "h-[calc(100%-1.25rem)]", "rounded-[12px]");
  expect(
    screen.queryByRole("searchbox", { name: frontendMessage("session.searchPlaceholder") }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: frontendMessage("session.headerExpand") })).toBeVisible();
  expect(screen.getByRole("button", { name: frontendMessage("session.new") })).toBeVisible();

  await user.click(screen.getByRole("button", { name: frontendMessage("session.headerExpand") }));
  expect(sidebar).toHaveAttribute("data-collapsed", "false");
  expect(screen.getByRole("searchbox", { name: frontendMessage("session.searchPlaceholder") })).toBeVisible();
});

test("persistent session sidebar omits reorder controls on desktop", () => {
  const restoreMatchMedia = installDesktopMatchMedia();
  try {
    resetSessionStore({
      sessions: {
        first: session("first", "Frontend refactor"),
        second: session("second", "Provider settings"),
      },
      sessionOrder: ["first", "second"],
      activeSessionId: "first",
    });
    renderWithFrontendProviders(
      React.createElement(SessionList, createProps({ presentation: "auto", onClosePanel: undefined })),
    );

    expect(screen.queryByRole("button", { name: frontendMessage("session.reorder") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "more" })).not.toBeInTheDocument();
  } finally {
    restoreMatchMedia();
  }
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
    childSessionParentIds: {},
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

function installDesktopMatchMedia() {
  const previous = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query) => ({
      matches: [
        "(min-width: 768px)",
        "(min-width: 1024px)",
        "(min-width: 1280px)",
        "(min-width: 1536px)",
        "(hover: hover)",
      ].includes(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
  return () => {
    if (previous) {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: previous });
    } else {
      delete window.matchMedia;
    }
  };
}
