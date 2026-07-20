import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import {
  AppShell,
  readAppShellResponsiveEntryPlan,
  readAppShellRenderPlan,
  readAppShellSurfacePlan,
  readWorkflowPanelWidth,
} from "../../../Frontend/src/layout/AppShell.tsx";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
const { ThinkingTimeline } = await import("../../../Frontend/src/features/workflow/ThinkingTimeline.tsx");
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";

beforeEach(() => {
  installMemoryLocalStorage();
  resetFrontendStore();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("app shell derives integrated workspace surfaces across responsive modes", () => {
  const mobile = responsiveMode("mobile");
  const tablet = responsiveMode("tablet");
  const desktop = responsiveMode("desktop");
  const inlineDesktop = { ...responsiveMode("desktop"), hasInlineWorkflowPanel: true };
  const wide = responsiveMode("wide");

  expect(readAppShellSurfacePlan(mobile)).toEqual({ session: "drawer", workflow: "drawer" });
  expect(readAppShellRenderPlan(mobile)).toMatchObject({
    showSessionPersistentPanel: false,
    showSessionDrawer: true,
    showWorkflowDrawer: true,
    workflowPanelLayout: "drawer",
    showChatSessionPanelAction: true,
    showChatWorkflowPanelAction: true,
  });
  expect(readAppShellRenderPlan(tablet)).toMatchObject({
    showSessionPersistentPanel: false,
    showWorkflowPersistentPanel: false,
    workflowPanelLayout: "drawer",
  });
  expect(readAppShellRenderPlan(desktop)).toMatchObject({
    showSessionPersistentPanel: true,
    showWorkflowPersistentPanel: true,
    workflowPanelLayout: "overlay",
    showSessionDrawer: false,
    showWorkflowDrawer: false,
    showChatWorkflowPanelAction: false,
  });
  expect(readAppShellRenderPlan(inlineDesktop)).toMatchObject({
    workflowPanelLayout: "inline",
  });
  expect(readAppShellRenderPlan(wide)).toMatchObject({
    showSessionPersistentPanel: true,
    showWorkflowPersistentPanel: true,
    workflowPanelLayout: "inline",
    showChatWorkflowPanelAction: false,
  });
  expect(readWorkflowPanelWidth()).toBe(302);
  expect(readWorkflowPanelWidth("terminal")).toBe(420);
  expect(readAppShellResponsiveEntryPlan(mobile)).toEqual({
    sidebarCollapsed: null,
    rightPanelCollapsed: null,
  });
  expect(readAppShellResponsiveEntryPlan(desktop)).toEqual({
    sidebarCollapsed: false,
    rightPanelCollapsed: true,
  });
  expect(readAppShellResponsiveEntryPlan(inlineDesktop)).toEqual({
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
  });
});

test("app shell applies automatic panel defaults only when entering a responsive layout", async () => {
  const props = {
    sessionPanel: React.createElement("div", null, "Session panel"),
    sessionDrawer: React.createElement("div", null, "Session drawer"),
    chatPanel: React.createElement("div", null, "Chat panel"),
    workflowPanel: React.createElement("div", null, "Workflow panel"),
    workflowDrawer: React.createElement("div", null, "Workflow drawer"),
    terminalPanel: React.createElement("div", null, "Terminal panel"),
    workflowDockTool: "execution",
    onWorkflowDockToolChange: vi.fn(),
    sessionDrawerOpen: false,
    onSessionDrawerOpenChange: vi.fn(),
    workflowDrawerOpen: false,
    onWorkflowDrawerOpenChange: vi.fn(),
  };
  const inlineDesktop = { ...responsiveMode("desktop"), hasInlineWorkflowPanel: true };
  const shell = (responsiveMode) =>
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(AppShell, { ...props, responsiveMode }),
    );
  const { rerender } = render(shell(inlineDesktop));

  await waitFor(() => {
    expect(useStore.getState().sidebarCollapsed).toBe(false);
    expect(useStore.getState().rightPanelCollapsed).toBe(false);
  });

  act(() => useStore.getState().setRightPanelCollapsed(true));
  await waitFor(() => expect(useStore.getState().rightPanelCollapsed).toBe(true));
  rerender(shell(inlineDesktop));
  expect(useStore.getState().rightPanelCollapsed).toBe(true);

  rerender(shell(responsiveMode("desktop")));
  await waitFor(() => {
    expect(useStore.getState().sidebarCollapsed).toBe(false);
    expect(useStore.getState().rightPanelCollapsed).toBe(true);
  });

  act(() => useStore.getState().setRightPanelCollapsed(false));
  await waitFor(() => expect(useStore.getState().rightPanelCollapsed).toBe(false));
  rerender(shell(responsiveMode("desktop")));
  expect(useStore.getState().rightPanelCollapsed).toBe(false);
});

test("app shell renders persistent wide panels and closes obsolete drawers", async () => {
  const onSessionDrawerOpenChange = vi.fn();
  const onWorkflowDrawerOpenChange = vi.fn();
  renderWithFrontendProviders(
    React.createElement(AppShell, {
      sessionPanel: React.createElement("div", null, "Session panel"),
      sessionDrawer: React.createElement("div", null, "Session drawer"),
      chatPanel: React.createElement("div", null, "Chat panel"),
      workflowPanel: React.createElement("div", null, "Workflow panel"),
      workflowDrawer: React.createElement("div", null, "Workflow drawer"),
      terminalPanel: React.createElement("div", null, "Terminal panel"),
      workflowDockTool: "execution",
      onWorkflowDockToolChange: vi.fn(),
      sessionDrawerOpen: true,
      onSessionDrawerOpenChange,
      workflowDrawerOpen: true,
      onWorkflowDrawerOpenChange,
      responsiveMode: responsiveMode("wide"),
    }),
  );

  expect(screen.getByText("Session panel")).toBeVisible();
  expect(screen.getByText("Chat panel")).toBeVisible();
  expect(screen.getByText("Workflow panel")).toBeVisible();
  expect(document.querySelector("[data-workflow-dock]")).toBeInTheDocument();
  expect(document.querySelector("[data-workflow-dock-capsule]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-workflow-dock-rail]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-workspace-shell]")).toHaveClass(
    "bg-surface-canvas",
    "[background-image:var(--theme-bg-image)]",
  );
  expect(document.querySelector("[data-workflow-panel-surface]")).toHaveClass(
    "bg-surface-canvas",
    "[background-image:var(--theme-bg-image)]",
  );
  expect(document.querySelector("[data-workflow-panel-surface]")).not.toHaveClass("bg-surface-panel");
  expect(document.querySelector("[data-workflow-dock-gutter]")).toBeInTheDocument();
  expect(screen.queryByText("Terminal panel")).not.toBeInTheDocument();
  expect(screen.queryByText("Session drawer")).not.toBeInTheDocument();
  expect(screen.queryByText("Workflow drawer")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(onSessionDrawerOpenChange).toHaveBeenCalledWith(false);
    expect(onWorkflowDrawerOpenChange).toHaveBeenCalledWith(false);
  });
});

test("desktop overlay opens from a floating capsule and switches horizontal tabs", () => {
  function DockHarness() {
    const [workflowDockTool, setWorkflowDockTool] = React.useState("execution");
    return React.createElement(AppShell, {
      sessionPanel: React.createElement("div", null, "Session panel"),
      sessionDrawer: React.createElement("div", null, "Session drawer"),
      chatPanel: React.createElement("div", null, "Chat panel"),
      workflowPanel: React.createElement(ThinkingTimeline, { presentation: "dock" }),
      workflowDrawer: React.createElement("div", null, "Workflow drawer"),
      terminalPanel: React.createElement("div", { "data-terminal-runtime": "" }, "Live terminal"),
      workflowDockTool,
      onWorkflowDockToolChange: setWorkflowDockTool,
      sessionDrawerOpen: false,
      onSessionDrawerOpenChange: vi.fn(),
      workflowDrawerOpen: false,
      onWorkflowDrawerOpenChange: vi.fn(),
      responsiveMode: responsiveMode("desktop"),
    });
  }

  renderWithFrontendProviders(React.createElement(DockHarness));

  const dock = document.querySelector("[data-workflow-dock]");
  const toggle = document.querySelector("[data-workflow-dock-toggle]");
  expect(dock).toHaveAttribute("data-workflow-dock-layout", "overlay");
  expect(dock).toHaveClass("z-50");
  expect(document.querySelector("[data-workflow-panel-surface]")).not.toBeInTheDocument();
  expect(document.querySelectorAll("[data-workflow-dock-tool]")).toHaveLength(2);
  expect(document.querySelector("[data-workflow-dock-capsule]")).toBeInTheDocument();
  expect(dock).toHaveStyle({ right: "12px" });
  expect(document.querySelector("[data-workflow-dock-gutter]")).toBeInTheDocument();
  expect(dock.querySelector("[data-window-drag-region]")).not.toBeInTheDocument();
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveClass("h-8", "w-8", "rounded-full", "text-content-muted");
  expect(toggle.querySelector("svg")).toHaveClass("h-4", "w-4");
  expect(toggle).not.toHaveAttribute("aria-pressed");
  expect(toggle).not.toHaveClass("bg-accent-surface", "text-accent-content");

  act(() => toggle.click());
  const surface = document.querySelector("[data-workflow-panel-surface]");
  expect(surface).toHaveClass("absolute", "inset-y-0", "[box-shadow:var(--theme-overlay-shadow)]");
  expect(surface).toHaveClass("bg-surface-panel");
  const executionTab = screen.getByRole("tab", { name: "执行" });
  expect(document.querySelector("[data-workflow-dock-tabs]")).toHaveClass("rounded-full", "bg-surface-subtle");
  expect(executionTab).toHaveClass("flex-1", "bg-surface-raised", "text-content-primary");
  const collapseButton = screen.getByRole("button", { name: /收起/ });
  const focusButton = screen.getByRole("button", { name: "放大查看" });
  expect(collapseButton).toHaveClass("text-content-muted");
  expect(collapseButton).not.toHaveClass("border", "bg-surface-raised", "shadow-sm");
  expect(focusButton).toHaveClass("text-content-muted");
  expect(document.querySelector("[data-workflow-window-controls-cover]")).toContainElement(collapseButton);
  expect(document.querySelector("[data-workflow-dock-tabs]")).not.toContainElement(collapseButton);
  expect(document.querySelector("[data-workflow-execution-content]")).toContainElement(focusButton);
  expect(document.querySelector("[data-workflow-dock-tabs]")).not.toContainElement(focusButton);
  expect(dock).toHaveStyle({ right: "0px" });
  expect(document.querySelector("[data-workflow-dock-capsule]")).not.toBeInTheDocument();

  act(() => collapseButton.click());
  expect(document.querySelector("[data-workflow-panel-surface]")).not.toBeInTheDocument();
  expect(dock.querySelector("[data-window-drag-region]")).not.toBeInTheDocument();
  const executionToggleAfterCollapse = document.querySelector("[data-workflow-dock-toggle]");
  expect(executionToggleAfterCollapse).not.toHaveAttribute("aria-pressed");
  act(() => executionToggleAfterCollapse.click());
  expect(document.querySelector("[data-workflow-dock-capsule]")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "执行" })).toHaveAttribute("aria-selected", "true");

  const terminalTabAfterReopen = screen.getByRole("tab", { name: "终端" });
  const collapseButtonAfterReopen = screen.getByRole("button", { name: /收起/ });
  act(() => terminalTabAfterReopen.click());
  const selectedTerminalTab = screen.getByRole("tab", { name: "终端" });
  expect(selectedTerminalTab).toHaveAttribute("aria-selected", "true");
  expect(selectedTerminalTab).toHaveClass("flex-1", "bg-surface-raised", "text-content-primary");
  expect(document.querySelector("[data-terminal-dock='dock']")).toBeInTheDocument();
  expect(document.querySelector("[data-terminal-runtime]")).toHaveTextContent("Live terminal");
  expect(document.querySelector("[data-workflow-dock-tabs-list]")).toHaveClass("rounded-full", "bg-surface-subtle");
  expect(screen.queryByRole("button", { name: "放大查看" })).not.toBeInTheDocument();
  expect(document.querySelector("[data-workflow-window-controls-cover]")).toContainElement(collapseButtonAfterReopen);

  act(() => selectedTerminalTab.click());
  expect(screen.getByRole("tab", { name: "终端" })).toHaveAttribute("aria-selected", "true");
  expect(document.querySelector("[data-terminal-runtime]")).toBeInTheDocument();

  act(() => collapseButtonAfterReopen.click());
  expect(document.querySelector("[data-workflow-panel-surface]")).not.toBeInTheDocument();
  expect(dock.querySelector("[data-window-drag-region]")).not.toBeInTheDocument();

  const terminalToggle = document.querySelector("[data-workflow-dock-tool=terminal]");
  expect(terminalToggle).not.toHaveAttribute("aria-pressed");
  act(() => terminalToggle.click());
  expect(document.querySelector("[data-workflow-dock-capsule]")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "终端" })).toHaveAttribute("aria-selected", "true");
  expect(document.querySelector("[data-workflow-panel-surface]")).toBeInTheDocument();
});

test("the responsive right drawer switches from execution to the live terminal", async () => {
  function DrawerHarness() {
    const [workflowDockTool, setWorkflowDockTool] = React.useState("execution");
    const [workflowDrawerOpen, setWorkflowDrawerOpen] = React.useState(true);
    return React.createElement(AppShell, {
      sessionPanel: React.createElement("div", null, "Session panel"),
      sessionDrawer: React.createElement("div", null, "Session drawer"),
      chatPanel: React.createElement("div", null, "Chat panel"),
      workflowPanel: React.createElement(ThinkingTimeline, { presentation: "dock" }),
      workflowDrawer: React.createElement(ThinkingTimeline, { presentation: "panel", hidePanelTitle: true }),
      terminalPanel: React.createElement("div", { "data-terminal-runtime": "" }, "Live terminal"),
      workflowDockTool,
      onWorkflowDockToolChange: setWorkflowDockTool,
      sessionDrawerOpen: false,
      onSessionDrawerOpenChange: vi.fn(),
      workflowDrawerOpen,
      onWorkflowDrawerOpenChange: setWorkflowDrawerOpen,
      responsiveMode: responsiveMode("mobile"),
    });
  }

  renderWithFrontendProviders(React.createElement(DrawerHarness));

  expect(await screen.findByRole("tab", { name: "执行" })).toHaveAttribute("aria-selected", "true");
  act(() => screen.getByRole("tab", { name: "终端" }).click());
  expect(await screen.findByText("Live terminal")).toBeInTheDocument();
  expect(document.querySelector("[data-terminal-dock='drawer']")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "终端" })).toHaveAttribute("aria-selected", "true");
});

function responsiveMode(viewport) {
  return {
    viewport,
    hasPersistentSessionPanel: viewport === "desktop" || viewport === "wide",
    hasPersistentWorkflowPanel: viewport === "desktop" || viewport === "wide",
    hasInlineWorkflowPanel: viewport === "wide",
    prefersCompactControls: viewport === "mobile",
    supportsHover: viewport !== "mobile",
    isCoarsePointer: viewport === "mobile",
    prefersReducedMotion: false,
  };
}
