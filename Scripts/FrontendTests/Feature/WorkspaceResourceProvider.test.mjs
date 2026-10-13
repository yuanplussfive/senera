import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import {
  useWorkspaceResourceController,
  WorkspaceResourceProvider,
} from "../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx";

vi.mock("../../../Frontend/src/shared/workspace/WorkspaceResourceWorkbench.tsx", () => ({
  WorkspaceResourceWorkbench: () => React.createElement("div", { "data-resource-workbench": "true" }),
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

describe("workspace resource loading fallback", () => {
  it("announces a modal loading state and inerts the underlying surface", async () => {
    render(
      React.createElement(
        WorkspaceResourceProvider,
        { httpBaseUrl: "ws://agent.example.test/socket" },
        React.createElement(
          React.Fragment,
          null,
          React.createElement("button", { type: "button" }, "Background action"),
          React.createElement(ResourceTrigger),
        ),
      ),
    );

    const trigger = screen.getByRole("button", { name: "Open workspace resource" });
    trigger.focus();
    fireEvent.click(trigger);

    const fallback = screen.getByRole("dialog", { name: frontendMessage("ui.loading") });
    expect(fallback).toHaveAttribute("aria-modal", "true");
    expect(fallback).toHaveAttribute("aria-busy", "true");
    expect(fallback).toHaveAttribute("data-workspace-resource-loading");
    expect(document.querySelector("button")).toHaveProperty("inert", true);
    expect(document.activeElement).toBe(fallback);

    await waitFor(() => expect(document.querySelector("[data-resource-workbench]")).toBeInTheDocument());
    expect(trigger.inert ?? false).toBe(false);
  });
});
