import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import {
  AppShell,
  readAppShellResponsiveEntryPlan,
  readAppShellRenderPlan,
  readAppShellSurfacePlan,
} from "../../../Frontend/src/layout/AppShell.tsx";
import {
  clampWorkflowDockWidth,
  readWorkflowDockWidthConstraints,
} from "../../../Frontend/src/shared/responsive/workflowDock.ts";
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
  expect(readWorkflowDockWidthConstraints(1024, 246)).toEqual({ min: 302, max: 418 });
  expect(readWorkflowDockWidthConstraints(1600, 246)).toEqual({ min: 302, max: 640 });
  expect(clampWorkflowDockWidth(900, { min: 302, max: 640 })).toBe(640);
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
    rightPanelCollapsed: true,
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
    expect(useStore.getState().rightPanelCollapsed).toBe(true);
  });

  act(() => useStore.getState().setRightPanelCollapsed(false));
  await waitFor(() => expect(useStore.getState().rightPanelCollapsed).toBe(false));
  rerender(shell(inlineDesktop));
  expect(useStore.getState().rightPanelCollapsed).toBe(false);

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

  const user = userEvent.setup();
  expect(screen.getByText("Session panel")).toBeVisible();
  expect(screen.getByText("Chat panel")).toBeVisible();
  await waitFor(() => expect(document.querySelector("[data-workflow-dock-capsule]")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "执行" }));
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
  const persistentExecutionTab = screen.getByRole("tab", { name: "执行" });
  const persistentExecutionPanel = screen.getByRole("tabpanel");
  expect(persistentExecutionTab).toHaveAttribute("aria-selected", "true");
  expect(persistentExecutionTab).toHaveAttribute("aria-controls", persistentExecutionPanel.id);
  expect(persistentExecutionPanel).toHaveTextContent("Workflow panel");
  expect(screen.queryByText("Terminal panel")).not.toBeInTheDocument();
  expect(screen.queryByText("Session drawer")).not.toBeInTheDocument();
  expect(screen.queryByText("Workflow drawer")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(onSessionDrawerOpenChange).toHaveBeenCalledWith(false);
    expect(onWorkflowDrawerOpenChange).toHaveBeenCalledWith(false);
  });
});

test("desktop overlay opens from a floating capsule and switches accessible horizontal tabs", async () => {
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
  const user = userEvent.setup();

  const dock = document.querySelector("[data-workflow-dock]");
  const toggle = document.querySelector("[data-workflow-dock-toggle]");
  expect(dock).toHaveAttribute("data-workflow-dock-layout", "overlay");
  expect(dock).toHaveClass("z-30");
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
  expect(document.querySelector("[data-workflow-dock-tabs]")).toHaveClass("rounded-lg", "bg-surface-subtle");
  expect(executionTab).toHaveClass("flex-1", "relative", "overflow-visible", "data-[state=active]:bg-transparent");
  expect(executionTab).toContainElement(document.querySelector("[data-workflow-dock-active-indicator='dock']"));
  const collapseButton = screen.getByRole("button", { name: /收起/ });
  const resizeHandle = screen.getByRole("separator", { name: "调整功能坞宽度" });
  const focusButton = screen.getByRole("button", { name: "放大查看" });
  const executionPanel = screen.getByRole("tabpanel");
  expect(executionTab).toHaveAttribute("aria-controls", executionPanel.id);
  expect(executionPanel).toContainElement(focusButton);
  expect(collapseButton).toHaveClass("text-content-muted");
  expect(collapseButton).not.toHaveClass("border", "bg-surface-raised", "shadow-sm");
  expect(focusButton).toHaveClass("text-content-muted");
  expect(document.querySelector("[data-workflow-window-controls-cover]")).not.toBeInTheDocument();
  const titlebarSpacer = document.querySelector("[data-workflow-dock-titlebar-spacer]");
  const dockToolbar = document.querySelector("[data-workflow-dock-toolbar]");
  expect(titlebarSpacer).toHaveAttribute("data-window-drag-region");
  expect(titlebarSpacer.nextElementSibling).toBe(dockToolbar);
  expect(dockToolbar).toContainElement(collapseButton);
  expect(dockToolbar).not.toHaveAttribute("data-window-controls-inset");
  expect(document.querySelector("[data-workflow-dock-tabs]")).not.toContainElement(collapseButton);
  expect(document.querySelector("[data-workflow-execution-content]")).toContainElement(focusButton);
  expect(document.querySelector("[data-workflow-dock-tabs]")).not.toContainElement(focusButton);
  expect(dock).toHaveStyle({ right: "0px" });
  expect(document.querySelector("[data-workflow-dock-capsule]")).not.toBeInTheDocument();
  expect(resizeHandle).toHaveAttribute("aria-valuemin", "302");
  expect(resizeHandle).toHaveAttribute("aria-valuemax", "418");
  fireEvent.keyDown(resizeHandle, { key: "Home" });
  expect(useStore.getState().workflowDockWidth).toBe(302);
  fireEvent.keyDown(resizeHandle, { key: "ArrowLeft" });
  expect(useStore.getState().workflowDockWidth).toBe(318);
  fireEvent.pointerDown(resizeHandle, { pointerId: 7, clientX: 400 });
  fireEvent.pointerMove(resizeHandle, { pointerId: 7, clientX: 300 });
  fireEvent.pointerUp(resizeHandle, { pointerId: 7, clientX: 300 });
  expect(useStore.getState().workflowDockWidth).toBe(418);

  act(() => collapseButton.click());
  expect(document.querySelector("[data-workflow-panel-surface]")).not.toBeInTheDocument();
  expect(dock.querySelector("[data-window-drag-region]")).not.toBeInTheDocument();
  const executionToggleAfterCollapse = document.querySelector("[data-workflow-dock-toggle]");
  expect(executionToggleAfterCollapse).not.toHaveAttribute("aria-pressed");
  act(() => executionToggleAfterCollapse.click());
  expect(document.querySelector("[data-workflow-dock-capsule]")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "执行" })).toHaveAttribute("aria-selected", "true");
  expect(useStore.getState().workflowDockWidth).toBe(418);

  const terminalTabAfterReopen = screen.getByRole("tab", { name: "终端" });
  const collapseButtonAfterReopen = screen.getByRole("button", { name: /收起/ });
  await user.click(terminalTabAfterReopen);
  const selectedTerminalTab = screen.getByRole("tab", { name: "终端" });
  expect(selectedTerminalTab).toHaveAttribute("aria-selected", "true");
  expect(selectedTerminalTab).toHaveClass("flex-1", "data-[state=active]:bg-transparent");
  expect(selectedTerminalTab).toContainElement(document.querySelector("[data-workflow-dock-active-indicator='dock']"));
  expect(document.querySelector("[data-terminal-dock='dock']")).toBeInTheDocument();
  expect(document.querySelector("[data-terminal-runtime]")).toHaveTextContent("Live terminal");
  expect(document.querySelector("[data-workflow-dock-tabs-list]")).toHaveClass("rounded-lg", "bg-surface-subtle");
  expect(screen.queryByRole("button", { name: "放大查看" })).not.toBeInTheDocument();
  expect(document.querySelector("[data-workflow-dock-toolbar]")).toContainElement(collapseButtonAfterReopen);
  expect(document.querySelector("[data-workflow-dock-toolbar]")).not.toHaveAttribute("data-window-controls-inset");

  await user.click(selectedTerminalTab);
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
  const user = userEvent.setup();

  expect(await screen.findByRole("tab", { name: "执行" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("separator", { name: "调整功能坞宽度" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "终端" }));
  expect(await screen.findByText("Live terminal")).toBeInTheDocument();
  expect(document.querySelector("[data-terminal-dock='drawer']")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "终端" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("heading", { name: "终端" })).toBeInTheDocument();
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
