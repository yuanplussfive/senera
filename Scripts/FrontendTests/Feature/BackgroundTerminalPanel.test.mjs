import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";
import { ApprovalRequestStrip } from "../../../Frontend/src/features/chat/ApprovalRequestStrip.tsx";

const xterm = vi.hoisted(() => ({ instances: [] }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    constructor(options) {
      this.options = { ...options };
      this.unicode = { activeVersion: "" };
      this.operations = [];
      this.disposed = false;
      this.inputListener = undefined;
      this.resizeListener = undefined;
      this.customKeyEventHandler = undefined;
      xterm.instances.push(this);
    }
    loadAddon(addon) {
      this.operations.push(`load:${addon.kind ?? "unknown"}`);
    }
    open() {
      this.operations.push("open");
    }
    write() {}
    reset() {}
    dispose() {
      this.disposed = true;
      this.operations.push("dispose");
    }
    onData(listener) {
      this.inputListener = listener;
      return { dispose() {} };
    }
    onResize(listener) {
      this.resizeListener = listener;
      return { dispose() {} };
    }
    attachCustomKeyEventHandler(handler) {
      this.customKeyEventHandler = handler;
    }
    emitInput(value) {
      this.inputListener?.(value);
    }
    emitResize(cols, rows) {
      this.resizeListener?.({ cols, rows });
    }
    emitCustomKey(event) {
      return this.customKeyEventHandler?.(event);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    kind = "fit";
    fit() {}
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class MockSearchAddon {
    kind = "search";
    findNext() {}
    findPrevious() {}
  },
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: class MockUnicode11Addon {
    kind = "unicode11";
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class MockWebLinksAddon {
    kind = "web-links";
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class MockWebglAddon {
    kind = "webgl";
    onContextLoss() {}
    dispose() {}
  },
}));

const { BackgroundTerminalPanel } = await import("../../../Frontend/src/features/terminal/BackgroundTerminalPanel.tsx");
const { TerminalRuntimeBoundary } = await import("../../../Frontend/src/features/terminal/TerminalPanelStatus.tsx");

beforeEach(() => {
  xterm.instances.length = 0;
  vi.stubGlobal("WebGL2RenderingContext", class WebGL2RenderingContext {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("terminal controls follow the effective backend capabilities", async () => {
  const user = userEvent.setup();
  const onWrite = vi.fn();
  const onResize = vi.fn();
  const onSignal = vi.fn();
  const baseProps = {
    outputs: {},
    onRefresh: vi.fn(),
    onWrite,
    onResize,
    onSignal,
    onStopAll: vi.fn(),
  };
  const panel = (resources) =>
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        ...baseProps,
        resources,
      }),
    );
  const view = render(panel([terminalResource([])]));

  const interruptButton = await screen.findByRole("button", { name: "中断当前终端" });
  expect(interruptButton).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "更多终端操作" }));
  expect(await screen.findByRole("menuitem", { name: "停止当前终端" })).toHaveAttribute("data-disabled");
  expect(xterm.instances).toHaveLength(1);
  const terminal = xterm.instances[0];
  expect(terminal.options.allowProposedApi).toBe(true);
  expect(terminal.unicode.activeVersion).toBe("11");
  expect(terminal.operations.indexOf("open")).toBeLessThan(terminal.operations.indexOf("load:webgl"));
  expect(terminal.options.disableStdin).toBe(true);

  act(() => {
    terminal.emitInput("blocked");
    terminal.emitResize(120, 40);
  });
  expect(onWrite).not.toHaveBeenCalled();
  expect(onResize).not.toHaveBeenCalled();

  view.rerender(panel([terminalResource(["interactive-input", "resize", "signals"])]));

  expect(interruptButton).toBeEnabled();
  expect(screen.getByRole("menuitem", { name: "停止当前终端" })).not.toHaveAttribute("data-disabled");
  expect(terminal.options.disableStdin).toBe(false);
  act(() => {
    terminal.emitInput("allowed");
    terminal.emitResize(132, 42);
  });
  await waitFor(() => {
    expect(onWrite).toHaveBeenCalledWith("res_00000000000000000000000000000000", "allowed");
    expect(onResize).toHaveBeenCalledWith("res_00000000000000000000000000000000", 132, 42);
  });
});

test("only the selected resource owns an xterm instance", async () => {
  const user = userEvent.setup();
  const view = render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [
          terminalResource([], "res_00000000000000000000000000000001", "shell-one", "2026-07-16T00:00:02.000Z"),
          terminalResource([], "res_00000000000000000000000000000002", "shell-two", "2026-07-16T00:00:01.000Z"),
        ],
        outputs: {},
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );

  await waitFor(() => expect(xterm.instances).toHaveLength(1));
  const first = xterm.instances[0];
  screen.getByRole("tab", { name: "shell-one" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "shell-two" })).toHaveAttribute("aria-selected", "true");
  await waitFor(() => expect(xterm.instances).toHaveLength(2));
  expect(first.disposed).toBe(true);
  view.unmount();
});

test("the terminal search overlay opens from the terminal keyboard shortcut without resizing the viewport", async () => {
  const user = userEvent.setup();
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [terminalResource(["interactive-input", "resize", "signals"])],
        outputs: {},
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );

  await waitFor(() => expect(xterm.instances).toHaveLength(1));
  let propagateToTerminal;
  act(() => {
    propagateToTerminal = xterm.instances[0].emitCustomKey({
      ctrlKey: true,
      metaKey: false,
      key: "f",
      type: "keydown",
    });
  });

  expect(propagateToTerminal).toBe(false);
  expect(await screen.findByRole("search")).toBeVisible();
  const searchInput = screen.getByRole("textbox", { name: "搜索当前终端" });
  await user.type(searchInput, "server logs{Escape}");
  expect(screen.queryByRole("search")).not.toBeInTheDocument();
  expect(xterm.instances).toHaveLength(1);
});

test("the docked terminal stays non-modal and does not block approval actions", async () => {
  const onResolve = vi.fn();
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ApprovalRequestStrip, {
          approvals: [pendingApproval()],
          onResolve,
        }),
        React.createElement(BackgroundTerminalPanel, {
          resources: [terminalResource([])],
          outputs: {},
          onRefresh: vi.fn(),
          onWrite: vi.fn(),
          onResize: vi.fn(),
          onSignal: vi.fn(),
          onStopAll: vi.fn(),
        }),
      ),
    ),
  );

  expect(await screen.findByRole("region", { name: "后台终端" })).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => {
    screen.getByRole("button", { name: "通过" }).click();
  });
  expect(onResolve).toHaveBeenCalledWith("approval_terminal_test", "approve_once");
});

test("unmounting the terminal dock releases its xterm resource", async () => {
  const view = render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [terminalResource([])],
        outputs: {},
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );

  await waitFor(() => expect(xterm.instances).toHaveLength(1));
  const initialTerminal = xterm.instances[0];
  view.unmount();
  await waitFor(() => expect(initialTerminal.disposed).toBe(true));
});

test("terminal runtime failures stay inside the dock and can be retried", async () => {
  const onRetry = vi.fn();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const preventExpectedError = (event) => event.preventDefault();
  window.addEventListener("error", preventExpectedError);
  let shouldThrow = true;
  function Runtime() {
    if (shouldThrow) throw new Error("terminal runtime failed");
    return React.createElement("div", null, "terminal restored");
  }

  try {
    render(
      React.createElement(
        TooltipProvider,
        { delayDuration: 0 },
        React.createElement(
          TerminalRuntimeBoundary,
          {
            resetKey: 0,
            onRetry: () => {
              shouldThrow = false;
              onRetry();
            },
          },
          React.createElement(Runtime),
        ),
      ),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("终端界面无法打开");
    await act(async () => {
      screen.getByRole("button", { name: "重新打开" }).click();
    });
    expect(await screen.findByText("terminal restored")).toBeInTheDocument();
    expect(onRetry).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("error", preventExpectedError);
    consoleError.mockRestore();
  }
});

function terminalResource(
  capabilities,
  resourceId = "res_00000000000000000000000000000000",
  command = "interactive-shell",
  createdAt = "2026-07-16T00:00:00.000Z",
) {
  return {
    resourceId,
    kind: "terminal",
    state: "running",
    command,
    cwd: "E:\\workspace",
    createdAt,
    updatedAt: createdAt,
    cursor: 1,
    oldestCursor: 1,
    truncated: false,
    events: [],
    terminal: {
      backend: "microsandbox-tty",
      shellDialect: "powershell",
      requestedBoundary: "sandbox",
      effectiveBoundary: "sandbox",
      capabilities,
      columns: 100,
      rows: 30,
      sandboxId: "sandbox-test",
    },
  };
}

function pendingApproval() {
  return {
    approvalId: "approval_terminal_test",
    approvalKind: "tool_call",
    status: "pending",
    title: "需要确认",
    reason: "终端运行期间仍需批准工具调用",
    availableDecisions: ["approve_once", "deny"],
    createdAt: "2026-07-18T00:00:00.000Z",
    subject: {
      kind: "tool_call",
      toolName: "ShellCommandTool",
      arguments: { command: "npm test" },
    },
  };
}
