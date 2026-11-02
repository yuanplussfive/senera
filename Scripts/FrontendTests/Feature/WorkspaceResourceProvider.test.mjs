import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import {
  WorkspaceBrowserSurface,
  useWorkspaceResourceController,
  WorkspaceResourceProvider,
} from "../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx";

vi.mock("../../../Frontend/src/shared/workspace/WorkspaceBrowserSurface.tsx", () => ({
  WorkspaceBrowserSurface: () => React.createElement("div", { "data-browser-surface": "true" }),
}));

afterEach(cleanup);

function ResourceTrigger() {
  const controller = useWorkspaceResourceController();
  return React.createElement(
    "button",
    {
      type: "button",
      onClick: () => controller?.openResource({ path: "Source/App.ts" }),
    },
    "Open workspace resource",
  );
}

describe("workspace resource tabs", () => {
  it("keeps the browser surface mounted while the opened resource becomes a tab", async () => {
    const onOpenInDock = vi.fn();
    render(
      React.createElement(
        WorkspaceResourceProvider,
        { httpBaseUrl: "ws://agent.example.test/socket", dockAvailable: true, onOpenInDock },
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ResourceTrigger),
          React.createElement(WorkspaceBrowserSurface),
        ),
      ),
    );

    await waitFor(() => expect(document.querySelector("[data-browser-surface]")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Open workspace resource" }));

    expect(onOpenInDock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: frontendMessage("ui.loading") })).not.toBeInTheDocument();
    expect(document.querySelector("[data-browser-surface]")).toBeInTheDocument();
  });

  it("navigates and retitles an individual browser tab", async () => {
    function TabProbe() {
      const controller = useWorkspaceResourceController();
      const activeTab = controller?.tabs.find((tab) => tab.id === controller.activeTabId);
      const entry = activeTab ? activeTab.history[activeTab.historyIndex] : undefined;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "span",
          { "data-active-title": activeTab?.title ?? "", "data-active-url": entry?.kind === "web" ? entry.url : "" },
          "Probe",
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () =>
              activeTab && controller?.navigateTab(activeTab.id, { kind: "web", url: "https://example.com/" }),
          },
          "Navigate tab",
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => activeTab && controller?.setTabTitle(activeTab.id, "  Example page  "),
          },
          "Retitle tab",
        ),
      );
    }

    render(
      React.createElement(
        WorkspaceResourceProvider,
        { httpBaseUrl: "ws://agent.example.test/socket", dockAvailable: true },
        React.createElement(TabProbe),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Navigate tab" }));
    await waitFor(() => expect(screen.getByText("Probe")).toHaveAttribute("data-active-url", "https://example.com/"));
    expect(screen.getByText("Probe")).toHaveAttribute("data-active-title", "example.com");

    fireEvent.click(screen.getByRole("button", { name: "Retitle tab" }));
    await waitFor(() => expect(screen.getByText("Probe")).toHaveAttribute("data-active-title", "Example page"));
  });

  it("reuses the blank tab and focuses an existing resource instead of duplicating it", async () => {
    function TabProbe() {
      const controller = useWorkspaceResourceController();
      const activeTab = controller?.tabs.find((tab) => tab.id === controller.activeTabId);
      const entry = activeTab ? activeTab.history[activeTab.historyIndex] : undefined;
      return React.createElement(
        "button",
        {
          type: "button",
          "data-tab-count": controller?.tabs.length ?? 0,
          "data-active-tab": controller?.activeTabId ?? "",
          "data-active-kind": entry?.kind ?? "",
          onClick: () => controller?.openResource({ path: "Source/App.ts" }),
        },
        "Open twice",
      );
    }

    render(
      React.createElement(
        WorkspaceResourceProvider,
        { httpBaseUrl: "ws://agent.example.test/socket", dockAvailable: true },
        React.createElement(TabProbe),
      ),
    );

    const probe = screen.getByRole("button", { name: "Open twice" });
    fireEvent.click(probe);
    await waitFor(() => expect(probe).toHaveAttribute("data-active-kind", "workspace"));
    expect(probe).toHaveAttribute("data-tab-count", "1");
    const activeTabId = probe.getAttribute("data-active-tab");
    fireEvent.click(probe);

    expect(screen.getByRole("button", { name: "Open twice" })).toHaveAttribute("data-tab-count", "1");
    expect(screen.getByRole("button", { name: "Open twice" })).toHaveAttribute("data-active-tab", activeTabId);
  });
});
