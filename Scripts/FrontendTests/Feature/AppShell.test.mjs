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

test("app shell derives stable surfaces and actions across responsive modes", () => {
  const mobile = responsiveMode("mobile");
  const tablet = responsiveMode("tablet");
  const desktop = responsiveMode("desktop");
  const wide = responsiveMode("wide");

  expect(readAppShellSurfacePlan(mobile)).toEqual({ session: "drawer", workflow: "drawer" });
  expect(readAppShellRenderPlan(mobile)).toMatchObject({
    showSessionRail: false,
    showSessionDrawer: true,
    showWorkflowDrawer: true,
    showChatSessionPanelAction: true,
    showChatWorkflowPanelAction: true,
  });
  expect(readAppShellRenderPlan(tablet)).toMatchObject({
    showSessionRail: true,
    showSessionPersistentPanel: false,
    showWorkflowPersistentPanel: false,
  });
  expect(readAppShellRenderPlan(desktop)).toMatchObject({
    showSessionRail: true,
    showSessionPersistentPanel: false,
    showWorkflowPersistentPanel: true,
  });
  expect(readAppShellRenderPlan(wide)).toMatchObject({
    showSessionRail: false,
    showSessionPersistentPanel: true,
    showWorkflowPersistentPanel: true,
  });
  expect(readWorkflowPanelWidth(desktop)).toBeLessThan(readWorkflowPanelWidth(wide));
});

test("app shell renders persistent wide panels and closes obsolete drawers", async () => {
  const onSessionDrawerOpenChange = vi.fn();
  const onWorkflowDrawerOpenChange = vi.fn();
  renderWithFrontendProviders(
    React.createElement(AppShell, {
      sessionRail: React.createElement("div", null, "Session rail"),
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
    hasPersistentSessionPanel: viewport === "wide",
    hasPersistentWorkflowPanel: viewport === "desktop" || viewport === "wide",
    prefersCompactControls: viewport === "mobile",
    supportsHover: viewport !== "mobile",
    isCoarsePointer: viewport === "mobile",
    prefersReducedMotion: false,
  };
}
