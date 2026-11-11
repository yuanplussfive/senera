import React from "react";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { WorkspaceMenuProvider } from "../../../Frontend/src/shared/workspace/WorkspaceMenu.tsx";
import { WorkspaceSwitcher } from "../../../Frontend/src/shared/workspace/WorkspaceSwitcher.tsx";
import { ExecutionContextChip } from "../../../Frontend/src/shared/workspace/ExecutionContextChip.tsx";
import { WorkspaceMenuContext } from "../../../Frontend/src/shared/workspace/WorkspaceMenuContext.ts";

const mocks = vi.hoisted(() => ({
  resources: { httpBaseUrl: "http://host/workspaces/a", dirty: false, openResource: vi.fn() },
  bridge: undefined,
  viewport: "desktop",
  host: { capabilities: undefined, revealWorkspace: vi.fn(), openExternalTerminal: vi.fn() },
}));
vi.mock("../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx", () => ({
  useWorkspaceResourceController: () => mocks.resources,
}));
vi.mock("../../../Frontend/src/app/desktopBridge.ts", () => ({ readDesktopBridge: () => mocks.bridge }));
vi.mock("../../../Frontend/src/app/useDesktopHostIntegration.ts", () => ({
  useDesktopHostIntegration: () => mocks.host,
}));
vi.mock("../../../Frontend/src/shared/responsive/index.ts", () => ({
  useResponsiveMode: () => ({ viewport: mocks.viewport }),
}));

beforeEach(() => {
  mocks.resources.dirty = false;
  mocks.bridge = undefined;
  mocks.viewport = "desktop";
  mocks.host.capabilities = undefined;
  mocks.host.revealWorkspace.mockClear();
  mocks.host.openExternalTerminal.mockClear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function controller(overrides = {}) {
  return {
    connected: true,
    phase: "idle",
    error: null,
    unavailable: null,
    switchWorkspace: vi.fn(() => true),
    resetError: vi.fn(),
    snapshot: {
      workspaceId: "a",
      workspaceRoot: "E:/senera",
      workspaces: [
        { id: "a", name: "senera", root: "E:/senera" },
        { id: "b", name: "demo", root: "E:/demo" },
      ],
      capabilities: { browseDirectories: true },
    },
    ...overrides,
  };
}

function SwitcherHarness({ workspace, onClose }) {
  return React.createElement(
    WorkspaceMenuProvider,
    { workspace, httpBaseUrl: "http://host" },
    React.createElement(WorkspaceSwitcher, { onClose }),
  );
}

test("the switcher lists recents with the active one indicated and switches on click", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const workspace = controller();
  renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace, onClose }));

  const activeRow = screen.getByRole("button", { name: /senera.*E:\/senera/ }).closest("[data-workspace-entry]");
  expect(screen.getByRole("button", { name: /senera.*E:\/senera/ })).toHaveAttribute("aria-current", "true");
  // The active workspace cannot be removed, so its row carries no dead remove control.
  expect(within(activeRow).queryByRole("button", { name: "移除工作区" })).toBeNull();
  await user.click(screen.getByRole("button", { name: /demo.*E:\/demo/ }));
  expect(workspace.switchWorkspace).toHaveBeenCalledWith("E:/demo");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("desktop host actions live in the workspace control", async () => {
  mocks.host.capabilities = { revealWorkspace: true, externalTerminal: true };
  const workspace = controller();
  const user = userEvent.setup();
  const menu = {
    workspace,
    select: vi.fn(),
    forgetWorkspace: vi.fn(),
    requestForget: vi.fn(),
    openFolder: vi.fn(),
    error: undefined,
  };
  renderWithFrontendProviders(
    React.createElement(
      WorkspaceMenuContext.Provider,
      { value: menu },
      React.createElement(ExecutionContextChip, {
        approval: { mode: "agent", disabled: false, onSelect: vi.fn() },
        prefersCompactControls: false,
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "切换工作区：senera" }));
  await user.click(await screen.findByRole("button", { name: "在文件管理器中打开" }));
  expect(mocks.host.revealWorkspace).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "切换工作区：senera" }));
  await user.click(await screen.findByRole("button", { name: "在系统终端中打开" }));
  expect(mocks.host.openExternalTerminal).toHaveBeenCalledTimes(1);
});

test("search filters recents by name or path and clears back to the full list", async () => {
  const user = userEvent.setup();
  const workspace = controller();
  renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace }));

  const search = screen.getByRole("textbox", { name: "搜索文件夹" });
  await user.type(search, "demo");
  expect(screen.queryByRole("button", { name: /senera.*E:\/senera/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /demo.*E:\/demo/ })).toBeInTheDocument();

  // Paths are matched too, so a folder outside the visible name still resolves.
  await user.clear(search);
  await user.type(search, "E:/senera");
  expect(screen.getByRole("button", { name: /senera.*E:\/senera/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /demo.*E:\/demo/ })).not.toBeInTheDocument();

  await user.clear(search);
  await user.type(search, "missing");
  expect(screen.getByText("没有匹配的工作区。")).toBeVisible();
  expect(screen.queryByRole("button", { name: /demo.*E:\/demo/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "清空搜索" }));
  expect(screen.getByRole("textbox", { name: "搜索文件夹" })).toHaveValue("");
  expect(screen.getByRole("button", { name: /demo.*E:\/demo/ })).toBeInTheDocument();
});

test("dirty workspace changes require confirmation before switching", async () => {
  mocks.resources.dirty = true;
  const workspace = controller();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace }));

  await user.click(screen.getByRole("button", { name: /demo.*E:\/demo/ }));
  expect(workspace.switchWorkspace).not.toHaveBeenCalled();
  await user.click(await screen.findByRole("button", { name: "放弃并打开" }));
  expect(workspace.switchWorkspace).toHaveBeenCalledWith("E:/demo");
});

test("browser folder selection remains mounted and interactive after the menu closes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => ({
      ok: true,
      json: async () => ({
        path: new URL(url).searchParams.get("path"),
        parent: "E:/",
        directories: [{ path: "E:/senera/Source", name: "Source" }],
      }),
    })),
  );
  const workspace = controller();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace }));

  await user.click(screen.getByRole("button", { name: "浏览服务器文件夹" }));
  await user.click(await screen.findByRole("button", { name: "Source" }));
  // The declaration is the current directory; browsing never implies switching.
  expect(workspace.switchWorkspace).not.toHaveBeenCalled();
});

test("deployment permissions disable folder opening and desktop tray uses a single stable listener", async () => {
  const workspace = controller({ snapshot: { ...controller().snapshot, capabilities: { browseDirectories: false } } });
  const view = renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace }));
  expect(screen.getByRole("button", { name: "浏览服务器文件夹" })).toBeDisabled();
  view.unmount();

  let listener;
  const unsubscribe = vi.fn();
  mocks.bridge = {
    chooseWorkspaceFolder: vi.fn(async () => "E:/demo"),
    onWorkspaceFolderRequested: vi.fn((callback) => {
      listener = callback;
      return unsubscribe;
    }),
  };
  const desktopView = renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace: controller() }));
  await act(async () => listener());
  expect(mocks.bridge.chooseWorkspaceFolder).toHaveBeenCalledTimes(1);
  expect(mocks.bridge.onWorkspaceFolderRequested).toHaveBeenCalledTimes(1);
  desktopView.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("a desktop bridge picks a folder through the native dialog, not an in-app browser", async () => {
  const chooseWorkspaceFolder = vi.fn(async () => "E:/demo");
  mocks.bridge = { chooseWorkspaceFolder };
  const workspace = controller();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace }));

  await user.click(screen.getByRole("button", { name: "选择本地文件夹" }));
  await waitFor(() => expect(chooseWorkspaceFolder).toHaveBeenCalledTimes(1));
  expect(workspace.switchWorkspace).toHaveBeenCalledWith("E:/demo");
});

test("the confirmation renders outside the switcher container so collapsing it cannot remove the dialog", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ workspaces: [], defaultWorkspaceId: "a" }) })),
  );
  const workspace = controller();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace }));

  const container = document.querySelector("[data-workspace-switcher]");
  const entry = within(container)
    .getByRole("button", { name: /demo.*E:\/demo/ })
    .closest("[data-workspace-entry]");
  await user.click(within(entry).getByRole("button", { name: "移除工作区" }));

  const dialog = await screen.findByRole("dialog", { name: "移除这个工作区？" });
  // The callers are portals that unmount on the opening click, so the dialog must
  // not be a descendant of the switcher that requested it.
  expect(container.contains(dialog)).toBe(false);
  expect(dialog.closest("[data-workspace-switcher]")).toBeNull();
});

test("confirming a forget request reaches the workspace API for that entry", async () => {
  const forgetRequest = vi.fn(async () => ({
    ok: true,
    json: async () => ({ workspaces: [], defaultWorkspaceId: "a" }),
  }));
  vi.stubGlobal("fetch", forgetRequest);
  mocks.resources.csrfToken = "csrf";
  const workspace = controller();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace }));

  const entry = screen.getByRole("button", { name: /demo.*E:\/demo/ }).closest("[data-workspace-entry]");
  await user.click(within(entry).getByRole("button", { name: "移除工作区" }));
  const dialog = await screen.findByRole("dialog", { name: "移除这个工作区？" });
  expect(within(dialog).getByText("E:/demo")).toBeVisible();
  await user.click(within(dialog).getByRole("button", { name: "移除" }));

  await waitFor(() => expect(forgetRequest).toHaveBeenCalledTimes(1));
  const [url, init] = forgetRequest.mock.calls[0];
  expect(String(url)).toContain("workspaceId=b");
  expect(init.method).toBe("DELETE");
  expect(init.headers["X-Senera-Csrf"]).toBe("csrf");
});

test("cancelling the confirmation closes only the dialog", async () => {
  const workspace = controller();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(SwitcherHarness, { workspace }));

  const entry = screen.getByRole("button", { name: /demo.*E:\/demo/ }).closest("[data-workspace-entry]");
  await user.click(within(entry).getByRole("button", { name: "移除工作区" }));
  const dialog = await screen.findByRole("dialog", { name: "移除这个工作区？" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "移除这个工作区？" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: /demo.*E:\/demo/ })).toBeInTheDocument();
});
