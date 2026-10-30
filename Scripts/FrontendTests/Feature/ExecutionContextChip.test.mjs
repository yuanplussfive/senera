import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { ExecutionContextChip } = await import("../../../Frontend/src/shared/workspace/ExecutionContextChip.tsx");
const { WorkspaceMenuContext } = await import("../../../Frontend/src/shared/workspace/WorkspaceMenuContext.ts");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");

afterEach(() => cleanup());

function chipProps(overrides = {}) {
  return {
    approval: { mode: "agent", disabled: false, onSelect: vi.fn() },
    prefersCompactControls: false,
    ...overrides,
  };
}

function boundary() {
  return document.querySelector("[data-execution-context-part='boundary']");
}

test("a healthy boundary stays out of the composer entirely", () => {
  for (const sandboxStatus of [
    null,
    { state: "ready", effectiveMode: "sandbox", provider: "gvisor" },
    // Host execution is the configured environment, not a degraded one.
    { state: "disabled", effectiveMode: "host", message: "宿主执行" },
  ]) {
    const view = renderWithFrontendProviders(React.createElement(ExecutionContextChip, chipProps({ sandboxStatus })));
    expect(boundary()).toBeNull();
    view.unmount();
  }
});

test("an unavailable boundary states the problem in place and explains it on demand", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(
      ExecutionContextChip,
      chipProps({ sandboxStatus: { state: "unavailable", message: "Docker Engine 未响应" } }),
    ),
  );

  const badge = boundary();
  expect(badge).toHaveTextContent(frontendMessage("sandbox.status.unavailable"));
  // Blocked is an error, never the same surface as "still preparing".
  expect(badge.className).toContain("text-brick-600");

  await user.click(badge);
  expect(await screen.findByText("Docker Engine 未响应")).toBeInTheDocument();
});

test("boundary tone is carried by icon and text, not by a filled badge", async () => {
  for (const [state, tone] of [
    ["preparing", "text-umber-600"],
    ["unavailable", "text-brick-600"],
  ]) {
    const view = renderWithFrontendProviders(
      React.createElement(ExecutionContextChip, chipProps({ sandboxStatus: { state, message: "x" } })),
    );
    const badge = boundary();
    expect(badge.className).toContain(tone);
    // A permanent tint would compete with the workspace and approval chips,
    // which only ever get a fill on hover.
    expect(badge.className).not.toMatch(/\bbg-[a-z]+-\d/);
    view.unmount();
  }
});

test("a preparing boundary reads as a wait, not an error", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(
      ExecutionContextChip,
      chipProps({ sandboxStatus: { state: "preparing", message: "正在拉取沙箱镜像" } }),
    ),
  );

  const badge = boundary();
  expect(badge).toHaveTextContent(frontendMessage("sandbox.status.preparing"));
  expect(badge.className).toContain("text-umber-600");
  expect(badge.className).not.toContain("text-brick-600");

  await user.click(badge);
  expect(await screen.findByText("正在拉取沙箱镜像")).toBeInTheDocument();
});

test("the boundary badge links to the execution panel when one is available", async () => {
  const user = userEvent.setup();
  const onOpenExecutionPanel = vi.fn();
  renderWithFrontendProviders(
    React.createElement(
      ExecutionContextChip,
      chipProps({
        sandboxStatus: { state: "unavailable", message: "Docker Engine 未响应" },
        onOpenExecutionPanel,
      }),
    ),
  );

  await user.click(boundary());
  await user.click(
    await screen.findByRole("button", { name: frontendMessage("execution.context.openExecutionPanel") }),
  );
  expect(onOpenExecutionPanel).toHaveBeenCalledTimes(1);
});

test("the boundary never offers a picker — it is decided by the machine", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(
      ExecutionContextChip,
      chipProps({ sandboxStatus: { state: "unavailable", message: "Docker Engine 未响应" } }),
    ),
  );

  await user.click(boundary());
  expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

test("context popover switches workspaces through the shared switcher", async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const menuValue = {
    workspace: {
      connected: true,
      phase: "idle",
      snapshot: {
        workspaceId: "a",
        workspaceRoot: "/repo/a",
        workspaces: [
          { id: "a", name: "Alpha", root: "/repo/a" },
          { id: "b", name: "Beta", root: "/repo/b" },
        ],
        capabilities: { browseDirectories: false },
      },
    },
    select,
    forgetWorkspace: vi.fn(),
    openFolder: vi.fn(),
  };
  renderWithFrontendProviders(
    React.createElement(
      WorkspaceMenuContext.Provider,
      { value: menuValue },
      React.createElement(ExecutionContextChip, chipProps({ sandboxStatus: null })),
    ),
  );

  const context = document.querySelector("[data-execution-context-part='workspace']");
  expect(context).toHaveTextContent("Alpha");

  await user.click(context);
  await user.click(await screen.findByRole("button", { name: /Beta.*\/repo\/b/ }));
  expect(select).toHaveBeenCalledWith("/repo/b");
});

test("approval stays the only part that picks a mode", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  renderWithFrontendProviders(
    React.createElement(ExecutionContextChip, chipProps({ approval: { mode: "agent", disabled: false, onSelect } })),
  );

  const approval = document.querySelector("[data-execution-context-part='approval']");
  expect(approval).toHaveTextContent(frontendMessage("chat.approvalMode.agent"));

  await user.click(approval);
  await user.click(
    await screen.findByRole("menuitem", { name: new RegExp(`^${frontendMessage("chat.approvalMode.alwaysAsk")}`) }),
  );
  expect(onSelect).toHaveBeenCalledWith("always_ask");
});

test("approval is inert while a run owns the composer", async () => {
  renderWithFrontendProviders(
    React.createElement(
      ExecutionContextChip,
      chipProps({ approval: { mode: "agent", disabled: true, onSelect: vi.fn() } }),
    ),
  );

  expect(document.querySelector("[data-execution-context-part='approval']")).toBeDisabled();
});
