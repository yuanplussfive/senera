import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { createWebWorkspaceTab } from "../../../Frontend/src/shared/workspace/WorkspaceTabs.ts";
import { WorkspaceWebFrame } from "../../../Frontend/src/shared/workspace/WorkspaceWebFrame.tsx";

const { capabilities, openExternalUrlMock } = vi.hoisted(() => ({
  capabilities: { native: false },
  openExternalUrlMock: vi.fn().mockResolvedValue("web"),
}));

vi.mock("../../../Frontend/src/app/desktopBridge.ts", () => ({
  openExternalUrl: openExternalUrlMock,
  supportsNativeWorkspaceWebview: () => capabilities.native,
}));

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 480 });
});

afterEach(() => {
  cleanup();
  capabilities.native = false;
  openExternalUrlMock.mockClear();
  vi.restoreAllMocks();
});

function createController() {
  return { navigateTab: vi.fn(), setTabTitle: vi.fn(), setTabFavicon: vi.fn(), reloadActiveTab: vi.fn() };
}

function webEntry(url) {
  return { kind: "web", url };
}

function renderFrame(tab, entry, controller) {
  return render(React.createElement(WorkspaceWebFrame, { tab, entry, controller }));
}

function dispatchWebviewEvent(element, type, detail) {
  const event = new Event(type);
  Object.assign(event, detail);
  fireEvent(element, event);
}

describe("workspace web frame", () => {
  it("falls back to a sandboxed iframe with an external escape hatch outside the desktop shell", () => {
    const tab = createWebWorkspaceTab("tab-1", "https://example.com/");
    renderFrame(tab, webEntry("https://example.com/"), createController());

    const frame = document.querySelector("[data-workspace-web-frame]");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "https://example.com/");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByText(frontendMessage("workspace.browser.embedHint"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: frontendMessage("workspace.browser.openExternal") }));
    expect(openExternalUrlMock).toHaveBeenCalledWith("https://example.com/");
  });

  it("renders a hardened native webview when the desktop shell exposes the capability", () => {
    capabilities.native = true;
    const tab = createWebWorkspaceTab("tab-1", "https://example.com/");
    const controller = createController();
    const { rerender } = render(
      React.createElement(WorkspaceWebFrame, {
        tab,
        entry: webEntry("https://example.com/"),
        controller,
        active: false,
      }),
    );

    const webview = document.querySelector("[data-workspace-web-frame]");
    expect(webview.tagName).toBe("WEBVIEW");
    expect(webview).not.toHaveAttribute("src");
    HTMLElement.prototype.getBoundingClientRect.mockReturnValue({ width: 0, height: 0 });
    rerender(
      React.createElement(WorkspaceWebFrame, {
        tab,
        entry: webEntry("https://example.com/"),
        controller,
        active: true,
      }),
    );
    expect(webview).not.toHaveAttribute("src");
    HTMLElement.prototype.getBoundingClientRect.mockReturnValue({ width: 640, height: 480 });
    rerender(
      React.createElement(WorkspaceWebFrame, {
        tab,
        entry: webEntry("https://example.com/"),
        controller,
        active: true,
      }),
    );
    expect(webview).toHaveAttribute("src", "https://example.com/");
    expect(webview).toHaveAttribute("partition", "persist:senera-workspace-browser");
    expect(webview).toHaveAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no");
    expect(screen.queryByText(frontendMessage("workspace.browser.embedHint"))).not.toBeInTheDocument();
  });

  it("follows guest navigations and page titles back into the tab model exactly once", () => {
    capabilities.native = true;
    const controller = createController();
    const tab = createWebWorkspaceTab("tab-1", "https://example.com/");
    renderFrame(tab, webEntry("https://example.com/"), controller);

    const webview = document.querySelector("[data-workspace-web-frame]");
    dispatchWebviewEvent(webview, "did-navigate", { url: "https://example.com/login" });
    expect(controller.navigateTab).toHaveBeenCalledWith("tab-1", {
      kind: "web",
      url: "https://example.com/login",
    });

    dispatchWebviewEvent(webview, "did-navigate-in-page", { url: "https://example.com/login" });
    expect(controller.navigateTab).toHaveBeenCalledTimes(1);

    dispatchWebviewEvent(webview, "did-navigate-in-page", { url: "https://example.com/login#step-2" });
    expect(controller.navigateTab).toHaveBeenCalledTimes(2);

    dispatchWebviewEvent(webview, "page-title-updated", { title: "Example login" });
    expect(controller.setTabTitle).toHaveBeenCalledWith("tab-1", "Example login");

    dispatchWebviewEvent(webview, "page-favicon-updated", { favicons: ["javascript:alert(1)", "/site-icon.png"] });
    expect(controller.setTabFavicon).toHaveBeenCalledWith(
      "tab-1",
      "https://example.com/login#step-2",
      "https://example.com/site-icon.png",
    );
  });

  it("reloads the guest when the tab reload token changes", () => {
    capabilities.native = true;
    const controller = createController();
    const tab = createWebWorkspaceTab("tab-1", "https://example.com/");
    const { rerender } = renderFrame(tab, webEntry("https://example.com/"), controller);

    const webview = document.querySelector("[data-workspace-web-frame]");
    webview.reload = vi.fn();
    dispatchWebviewEvent(webview, "did-attach", {});
    dispatchWebviewEvent(webview, "dom-ready", {});
    dispatchWebviewEvent(webview, "did-fail-load", { isMainFrame: false, errorCode: -105 });
    dispatchWebviewEvent(webview, "did-fail-load", { isMainFrame: true, errorCode: -3 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    dispatchWebviewEvent(webview, "did-fail-load", {
      isMainFrame: true,
      errorCode: -105,
      errorDescription: "ERR_NAME_NOT_RESOLVED",
    });
    dispatchWebviewEvent(webview, "did-stop-loading", {});
    expect(screen.getByRole("alert")).toHaveTextContent("ERR_NAME_NOT_RESOLVED");
    rerender(
      React.createElement(WorkspaceWebFrame, {
        tab: { ...tab, reloadToken: tab.reloadToken + 1 },
        entry: webEntry("https://example.com/"),
        controller,
      }),
    );

    expect(webview.reload).toHaveBeenCalledTimes(1);
    dispatchWebviewEvent(webview, "dom-ready", {});
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("queues changed tab URLs through the native source attribute before the guest attaches", () => {
    capabilities.native = true;
    const controller = createController();
    const tab = createWebWorkspaceTab("tab-1", "https://example.com/");
    const { rerender } = renderFrame(tab, webEntry("https://example.com/"), controller);

    const webview = document.querySelector("[data-workspace-web-frame]");
    webview.loadURL = vi.fn(() => {
      throw new Error("Guest not attached");
    });
    rerender(
      React.createElement(WorkspaceWebFrame, {
        tab: { ...tab },
        entry: webEntry("https://example.com/next"),
        controller,
      }),
    );

    expect(webview.loadURL).not.toHaveBeenCalled();
    expect(webview).toHaveAttribute("src", "https://example.com/next");
    expect(controller.navigateTab).not.toHaveBeenCalled();
  });
});
