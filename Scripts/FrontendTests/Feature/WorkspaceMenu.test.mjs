import React, { useState } from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { WorkspaceMenu, WorkspaceMenuProvider } from "../../../Frontend/src/shared/workspace/WorkspaceMenu.tsx";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../Frontend/src/shared/ui/index.ts";

const mocks = vi.hoisted(() => ({
  resources: { httpBaseUrl: "http://host/workspaces/a", dirty: false, openResource: vi.fn() },
  bridge: undefined,
  viewport: "desktop",
}));
vi.mock("../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx", () => ({
  useWorkspaceResourceController: () => mocks.resources,
}));
vi.mock("../../../Frontend/src/app/desktopBridge.ts", () => ({ readDesktopBridge: () => mocks.bridge }));
vi.mock("../../../Frontend/src/shared/responsive/index.ts", () => ({
  useResponsiveMode: () => ({ viewport: mocks.viewport }),
}));
vi.mock("../../../Frontend/src/shared/workspace/WorkspaceFileTree.tsx", () => ({
  WorkspaceFileTree: ({ httpBaseUrl, onSelect }) =>
    React.createElement(
      "button",
      { "data-files-base": httpBaseUrl, onClick: () => onSelect("README.md") },
      "README.md",
    ),
}));

beforeEach(() => {
  mocks.resources.dirty = false;
  mocks.bridge = undefined;
  mocks.viewport = "desktop";
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

function MenuHarness({ workspace }) {
  const [open, setOpen] = useState(false);
  return React.createElement(
    WorkspaceMenuProvider,
    { workspace, httpBaseUrl: "http://host" },
    React.createElement(
      DropdownMenu,
      { modal: false, open, onOpenChange: setOpen },
      React.createElement(DropdownMenuTrigger, { asChild: true }, React.createElement(Button, null, "+")),
      React.createElement(
        DropdownMenuContent,
        null,
        React.createElement(WorkspaceMenu, { onClose: () => setOpen(false) }),
      ),
    ),
  );
}

async function openMenu(user) {
  await user.click(screen.getByRole("button", { name: "+" }));
  await user.click(screen.getByRole("menuitem", { name: /工作区 · senera/ }));
  await screen.findByRole("tab", { name: "切换" });
}

test("one workspace menu provides files and recent workspaces with the active workspace indicated", async () => {
  const workspace = controller();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(MenuHarness, { workspace }));
  await openMenu(user);
  expect(await screen.findByRole("button", { name: "README.md" })).toHaveAttribute(
    "data-files-base",
    mocks.resources.httpBaseUrl,
  );
  await user.click(screen.getByRole("tab", { name: "切换" }));
  expect(screen.getByRole("button", { name: /senera.*E:\/senera/ })).toHaveAttribute("aria-current", "true");
  await user.click(screen.getByRole("button", { name: /demo.*E:\/demo/ }));
  expect(workspace.switchWorkspace).toHaveBeenCalledWith("E:/demo");
});

test("selecting a workspace file closes the command menu and opens the scoped resource", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(MenuHarness, { workspace: controller() }));
  await openMenu(user);
  await user.click(await screen.findByRole("button", { name: "README.md" }));
  expect(mocks.resources.openResource).toHaveBeenCalledWith({ path: "README.md" });
  await waitFor(() => expect(screen.queryByRole("menuitem", { name: /工作区/ })).not.toBeInTheDocument());
});

test("mobile workspace panel survives command menu focus restoration and closes with Escape", async () => {
  mocks.viewport = "mobile";
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(MenuHarness, { workspace: controller() }));
  await openMenu(user);
  expect(screen.getByRole("dialog", { name: "工作区", exact: true })).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: /工作区/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "切换" }));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("dirty workspace changes require confirmation before switching", async () => {
  mocks.resources.dirty = true;
  const workspace = controller();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(MenuHarness, { workspace }));
  await openMenu(user);
  await user.click(screen.getByRole("tab", { name: "切换" }));
  await user.click(screen.getByRole("button", { name: /demo.*E:\/demo/ }));
  expect(workspace.switchWorkspace).not.toHaveBeenCalled();
  const confirm = await screen.findByRole("button", { name: "放弃修改并打开" });
  await user.click(confirm);
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
  renderWithFrontendProviders(React.createElement(MenuHarness, { workspace }));
  await openMenu(user);
  await user.click(screen.getByRole("tab", { name: "切换" }));
  await user.click(screen.getByRole("button", { name: "浏览服务器文件夹" }));
  await screen.findByRole("dialog");
  await screen.findByRole("button", { name: "Source" });
  expect(screen.queryByRole("menuitem", { name: /工作区/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Source" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "打开此文件夹" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "打开此文件夹" }));
  expect(workspace.switchWorkspace).toHaveBeenCalledWith("E:/senera/Source");
});

test("deployment permissions disable folder opening and desktop tray uses a single stable listener", async () => {
  const user = userEvent.setup();
  const workspace = controller({ snapshot: { ...controller().snapshot, capabilities: { browseDirectories: false } } });
  const view = renderWithFrontendProviders(React.createElement(MenuHarness, { workspace }));
  await openMenu(user);
  await user.click(screen.getByRole("tab", { name: "切换" }));
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
  const desktopView = renderWithFrontendProviders(React.createElement(MenuHarness, { workspace: controller() }));
  await act(async () => listener());
  expect(mocks.bridge.chooseWorkspaceFolder).toHaveBeenCalledTimes(1);
  expect(mocks.bridge.onWorkspaceFolderRequested).toHaveBeenCalledTimes(1);
  desktopView.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
