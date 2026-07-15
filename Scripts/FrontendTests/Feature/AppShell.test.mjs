import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import {
  AppShell,
  readAppShellRenderPlan,
  readAppShellSurfacePlan,
  readWorkflowPanelWidth,
} from "../../../Frontend/src/layout/AppShell.tsx";

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
    showWorkflowDock: false,
    showSessionDrawer: true,
    showWorkflowDrawer: true,
    workflowPanelLayout: "drawer",
    showChatSessionPanelAction: true,
    showChatWorkflowPanelAction: true,
  });
  expect(readAppShellRenderPlan(tablet)).toMatchObject({
    showSessionPersistentPanel: false,
    showWorkflowDock: false,
    showWorkflowPersistentPanel: false,
    workflowPanelLayout: "drawer",
  });
  expect(readAppShellRenderPlan(desktop)).toMatchObject({
    showSessionPersistentPanel: true,
    showWorkflowDock: true,
    showWorkflowPersistentPanel: true,
    workflowPanelLayout: "overlay",
    showSessionDrawer: false,
    showWorkflowDrawer: false,
  });
  expect(readAppShellRenderPlan(inlineDesktop)).toMatchObject({
    workflowPanelLayout: "inline",
  });
  expect(readAppShellRenderPlan(wide)).toMatchObject({
    showSessionPersistentPanel: true,
    showWorkflowDock: true,
    showWorkflowPersistentPanel: true,
    workflowPanelLayout: "inline",
  });
  expect(readWorkflowPanelWidth(desktop)).toBeLessThan(readWorkflowPanelWidth(wide));
});

test("app shell renders persistent wide panels and closes obsolete drawers", async () => {
  const onSessionDrawerOpenChange = vi.fn();
  const onWorkflowDrawerOpenChange = vi.fn();
  renderWithFrontendProviders(
    React.createElement(AppShell, {
      sessionPanel: React.createElement("div", null, "Session panel"),
      sessionDrawer: React.createElement("div", null, "Session drawer"),
      chatPanel: React.createElement("div", null, "Chat panel"),
      workflowDock: React.createElement("div", null, "Workflow dock"),
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
  expect(screen.getByText("Workflow dock")).toBeVisible();
  expect(screen.getByText("Workflow panel")).toBeVisible();
  expect(screen.queryByText("Session drawer")).not.toBeInTheDocument();
  expect(screen.queryByText("Workflow drawer")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(onSessionDrawerOpenChange).toHaveBeenCalledWith(false);
    expect(onWorkflowDrawerOpenChange).toHaveBeenCalledWith(false);
  });
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
