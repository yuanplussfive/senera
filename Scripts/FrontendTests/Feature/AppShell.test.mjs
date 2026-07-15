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
    showChatWorkflowPanelAction: true,
  });
  expect(readAppShellRenderPlan(inlineDesktop)).toMatchObject({
    workflowPanelLayout: "inline",
  });
  expect(readAppShellRenderPlan(wide)).toMatchObject({
    showSessionPersistentPanel: true,
    showWorkflowPersistentPanel: true,
    workflowPanelLayout: "inline",
    showChatWorkflowPanelAction: true,
  });
  expect(readWorkflowPanelWidth(desktop)).toBeLessThan(readWorkflowPanelWidth(wide));
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
    sessionDrawerOpen: false,
    onSessionDrawerOpenChange: vi.fn(),
    workflowDrawerOpen: false,
    onWorkflowDrawerOpenChange: vi.fn(),
  };
  const inlineDesktop = { ...responsiveMode("desktop"), hasInlineWorkflowPanel: true };
  const { rerender } = render(React.createElement(AppShell, { ...props, responsiveMode: inlineDesktop }));

  await waitFor(() => {
    expect(useStore.getState().sidebarCollapsed).toBe(false);
    expect(useStore.getState().rightPanelCollapsed).toBe(false);
  });

  act(() => useStore.getState().setRightPanelCollapsed(true));
  await waitFor(() => expect(useStore.getState().rightPanelCollapsed).toBe(true));
  rerender(React.createElement(AppShell, { ...props, responsiveMode: inlineDesktop }));
  expect(useStore.getState().rightPanelCollapsed).toBe(true);

  rerender(React.createElement(AppShell, { ...props, responsiveMode: responsiveMode("desktop") }));
  await waitFor(() => {
    expect(useStore.getState().sidebarCollapsed).toBe(false);
    expect(useStore.getState().rightPanelCollapsed).toBe(true);
  });

  act(() => useStore.getState().setRightPanelCollapsed(false));
  await waitFor(() => expect(useStore.getState().rightPanelCollapsed).toBe(false));
  rerender(React.createElement(AppShell, { ...props, responsiveMode: responsiveMode("desktop") }));
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
  expect(document.querySelector("[data-workflow-dock]")).not.toBeInTheDocument();
  expect(screen.queryByText("Session drawer")).not.toBeInTheDocument();
  expect(screen.queryByText("Workflow drawer")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(onSessionDrawerOpenChange).toHaveBeenCalledWith(false);
    expect(onWorkflowDrawerOpenChange).toHaveBeenCalledWith(false);
  });
});

test("desktop overlay owns the full-height right tool surface", () => {
  renderWithFrontendProviders(
    React.createElement(AppShell, {
      sessionPanel: React.createElement("div", null, "Session panel"),
      sessionDrawer: React.createElement("div", null, "Session drawer"),
      chatPanel: React.createElement("div", null, "Chat panel"),
      workflowPanel: React.createElement("div", null, "Workflow overlay"),
      workflowDrawer: React.createElement("div", null, "Workflow drawer"),
      sessionDrawerOpen: false,
      onSessionDrawerOpenChange: vi.fn(),
      workflowDrawerOpen: false,
      onWorkflowDrawerOpenChange: vi.fn(),
      responsiveMode: responsiveMode("desktop"),
    }),
  );

  const surface = document.querySelector("[data-workflow-panel-surface]");
  expect(surface).toHaveClass("top-0", "right-0", "z-30", "[box-shadow:var(--theme-overlay-shadow)]");
  expect(surface).not.toHaveClass("top-[52px]");
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
