import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import {
  createBlankWorkspaceTab,
  createWebWorkspaceTab,
  createWorkspaceTab,
} from "../../../Frontend/src/shared/workspace/WorkspaceTabs.ts";
import { WorkspaceBrowserSurface } from "../../../Frontend/src/shared/workspace/WorkspaceBrowserSurface.tsx";

vi.mock("../../../Frontend/src/shared/workspace/WorkspaceResourceWorkbench.tsx", () => ({
  WorkspaceResourceWorkbench: ({ locator }) =>
    React.createElement("div", { "data-workspace-workbench": "true" }, locator.path),
}));

vi.mock("../../../Frontend/src/shared/workspace/WorkspaceResourceExplorer.tsx", () => ({
  WorkspaceResourceExplorer: ({ layout, onRefresh, onSelect, revision, showHeader }) =>
    React.createElement(
      "div",
      {
        "data-layout": layout,
        "data-revision": revision,
        "data-show-header": String(showHeader),
        "data-testid": "workspace-explorer",
      },
      React.createElement(
        "button",
        { type: "button", onClick: () => onSelect("src/App.tsx") },
        "Select workspace file",
      ),
      React.createElement("button", { type: "button", onClick: onRefresh }, "Refresh workspace tree"),
    ),
}));

const { openExternalUrlMock } = vi.hoisted(() => {
  const openExternalUrlMock = vi.fn();
  openExternalUrlMock.mockResolvedValue("web");
  return { openExternalUrlMock };
});
vi.mock("../../../Frontend/src/app/desktopBridge.ts", () => ({
  openExternalUrl: openExternalUrlMock,
  supportsNativeWorkspaceWebview: () => false,
}));

afterEach(() => {
  cleanup();
  openExternalUrlMock.mockClear();
});

function createController(overrides = {}) {
  return {
    httpBaseUrl: "ws://agent.example.test/socket",
    tabs: [createBlankWorkspaceTab("tab-1")],
    activeTabId: "tab-1",
    openResource: vi.fn(),
    newBlankTab: vi.fn(),
    activateTab: vi.fn(),
    requestCloseTab: vi.fn(),
    closeTab: vi.fn(),
    cancelCloseTab: vi.fn(),
    navigateActiveTab: vi.fn(),
    navigateTab: vi.fn(),
    setTabTitle: vi.fn(),
    setTabFavicon: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reloadActiveTab: vi.fn(),
    syncTabPath: vi.fn(),
    setTabDirty: vi.fn(),
    dirty: false,
    setDirty: vi.fn(),
    referenceResource: vi.fn(),
    registerReferenceHandler: vi.fn(),
    ...overrides,
  };
}

function renderSurface(controller) {
  render(React.createElement(WorkspaceBrowserSurface, { controller }));
}

describe("workspace browser surface", () => {
  it("starts on a blank tab with the workspace tree and a refreshable address bar", () => {
    const controller = createController();
    renderSurface(controller);

    expect(document.querySelector("[data-workspace-browser]")).toBeInTheDocument();
    expect(document.querySelector("[data-workspace-blank-tab]")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: frontendMessage("workspace.browser.address") })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-explorer")).toHaveAttribute("data-layout", "panel");
    expect(screen.getByTestId("workspace-explorer")).toHaveAttribute("data-show-header", "false");
    expect(screen.getByRole("tab", { name: frontendMessage("workspace.browser.newTab") })).toBeInTheDocument();

    const reload = screen.getByRole("button", { name: frontendMessage("workspace.browser.reload") });
    expect(reload).not.toBeDisabled();
    fireEvent.click(reload);
    expect(controller.reloadActiveTab).toHaveBeenCalledTimes(1);
  });

  it("opens a workspace file selected from the blank tab tree", () => {
    const controller = createController();
    renderSurface(controller);

    fireEvent.click(screen.getByRole("button", { name: "Select workspace file" }));

    expect(controller.openResource).toHaveBeenCalledWith({ path: "src/App.tsx" });
  });

  it("navigates the active tab to a typed URL and reports invalid input", () => {
    const controller = createController();
    renderSurface(controller);
    const input = screen.getByRole("textbox", { name: frontendMessage("workspace.browser.address") });

    fireEvent.change(input, { target: { value: "localhost:3000" } });
    fireEvent.submit(input.closest("form"));

    expect(controller.navigateActiveTab).toHaveBeenCalledWith({
      kind: "web",
      url: "http://localhost:3000/",
    });
    expect(controller.navigateActiveTab).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: "mailto:team@example.com" } });
    fireEvent.submit(input.closest("form"));

    expect(screen.getByRole("alert")).toHaveTextContent(frontendMessage("workspace.browser.invalidAddress"));
    expect(controller.navigateActiveTab).toHaveBeenCalledTimes(1);
  });

  it("switches, closes, and adds tabs from the tab strip", () => {
    const controller = createController({
      tabs: [createBlankWorkspaceTab("tab-1"), createWorkspaceTab("tab-2", { path: "README.md" })],
      activeTabId: "tab-1",
    });
    renderSurface(controller);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    fireEvent.click(tabs[1]);
    expect(controller.activateTab).toHaveBeenCalledWith("tab-2");

    const workspaceTab = document.querySelector('[data-workspace-tab="tab-2"]');
    fireEvent.click(within(workspaceTab).getByRole("button", { name: frontendMessage("workspace.browser.closeTab") }));
    expect(controller.requestCloseTab).toHaveBeenCalledWith("tab-2");

    fireEvent.click(screen.getByRole("button", { name: frontendMessage("workspace.browser.newTab") }));
    expect(controller.newBlankTab).toHaveBeenCalledTimes(1);
  });

  it("moves tab focus with arrow keys and wraps at the ends", () => {
    const controller = createController({
      tabs: [createBlankWorkspaceTab("tab-1"), createWorkspaceTab("tab-2", { path: "README.md" })],
      activeTabId: "tab-1",
    });
    renderSurface(controller);

    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(controller.activateTab).toHaveBeenCalledWith("tab-2");
    expect(tabs[1]).toHaveFocus();

    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(controller.activateTab).toHaveBeenLastCalledWith("tab-2");
  });

  it("renders a workspace tab through the workbench and a web tab in a sandboxed frame", async () => {
    const controller = createController({
      tabs: [
        createWorkspaceTab("tab-1", { path: "src/App.tsx" }),
        createWebWorkspaceTab("tab-2", "https://example.com/"),
      ],
      activeTabId: "tab-2",
    });
    renderSurface(controller);

    await waitFor(() => expect(document.querySelector("[data-workspace-workbench]")).toBeInTheDocument());
    expect(document.querySelector("[data-workspace-workbench]")).toHaveTextContent("src/App.tsx");

    const frame = document.querySelector("[data-workspace-web-frame]");
    expect(frame).toHaveAttribute("src", "https://example.com/");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");

    const webPanel = frame.closest('[role="tabpanel"]');
    expect(webPanel).not.toHaveAttribute("hidden");
    expect(webPanel).toHaveAttribute("aria-labelledby", "workspace-browser-tab-tab-2");
    const workspacePanel = document.querySelector("#workspace-browser-panel-tab-1");
    expect(workspacePanel).toHaveAttribute("hidden");
  });

  it("keeps every tab in the strip backed by a panel and guards reload while dirty", () => {
    const controller = createController({
      tabs: [
        createWorkspaceTab("tab-1", { path: "README.md" }),
        createWebWorkspaceTab("tab-2", "https://example.com/"),
      ],
      activeTabId: "tab-2",
      dirty: true,
    });
    renderSurface(controller);

    for (const tab of screen.getAllByRole("tab")) {
      const controls = tab.getAttribute("aria-controls");
      expect(document.getElementById(controls)).toBeInTheDocument();
    }

    const reload = screen.getByRole("button", { name: frontendMessage("workspace.browser.reload") });
    expect(reload).toBeDisabled();
  });

  it("reloads a clean tab and opens the active web tab externally", () => {
    const controller = createController({
      tabs: [createWebWorkspaceTab("tab-1", "https://example.com/")],
      activeTabId: "tab-1",
    });
    renderSurface(controller);

    fireEvent.click(screen.getByRole("button", { name: frontendMessage("workspace.browser.reload") }));
    expect(controller.reloadActiveTab).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: frontendMessage("workspace.browser.openExternal") })[0]);
    expect(openExternalUrlMock).toHaveBeenCalledWith("https://example.com/");
  });
});
