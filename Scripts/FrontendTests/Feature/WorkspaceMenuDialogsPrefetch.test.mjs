import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { WorkspaceMenuProvider } from "../../../Frontend/src/shared/workspace/WorkspaceMenu.tsx";
import { ExecutionContextChip } from "../../../Frontend/src/shared/workspace/ExecutionContextChip.tsx";

const dialogs = vi.hoisted(() => ({ moduleLoads: 0 }));
// Counting factory invocations counts chunk loads: `vi.mock` intercepts both
// the provider's `lazy()` import and the intent prefetch, so a duplicate load
// would show up here.
vi.mock("../../../Frontend/src/shared/workspace/WorkspaceMenuDialogs.tsx", () => {
  dialogs.moduleLoads += 1;
  return { WorkspaceMenuDialogs: () => null };
});

const mocks = vi.hoisted(() => ({
  resources: { httpBaseUrl: "http://host/workspaces/a", dirty: false, openResource: vi.fn() },
  bridge: undefined,
  host: { capabilities: undefined, revealWorkspace: vi.fn(), openExternalTerminal: vi.fn() },
}));
vi.mock("../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx", () => ({
  useWorkspaceResourceController: () => mocks.resources,
}));
vi.mock("../../../Frontend/src/app/desktopBridge.ts", () => ({ readDesktopBridge: () => mocks.bridge }));
vi.mock("../../../Frontend/src/app/useDesktopHostIntegration.ts", () => ({
  useDesktopHostIntegration: () => mocks.host,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function controller() {
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
      workspaces: [{ id: "a", name: "senera", root: "E:/senera" }],
      capabilities: { browseDirectories: true },
    },
  };
}

function ChipHarness({ workspace }) {
  return React.createElement(
    WorkspaceMenuProvider,
    { workspace, httpBaseUrl: "http://host" },
    React.createElement(ExecutionContextChip, {
      approval: { mode: "agent", disabled: false, onSelect: vi.fn() },
      prefersCompactControls: false,
    }),
  );
}

test("opening the workspace popover prefetches the dialogs chunk once, and first paint never does", async () => {
  const user = userEvent.setup();
  const workspace = controller();
  renderWithFrontendProviders(React.createElement(ChipHarness, { workspace }));

  // First paint stays clean: no dialog is plausible before a user gesture.
  expect(dialogs.moduleLoads).toBe(0);

  const trigger = screen.getByRole("button", { name: "切换工作区：senera" });
  await user.click(trigger);
  expect(dialogs.moduleLoads).toBe(1);

  // Closing and reopening must not request the chunk again (single flight).
  await user.click(trigger);
  await user.click(trigger);
  expect(dialogs.moduleLoads).toBe(1);
});
