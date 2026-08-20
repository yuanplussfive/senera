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
    focus() {
      this.operations.push("focus");
    }
    blur() {
      this.operations.push("blur");
    }
    write(value) {
      this.operations.push(["write", value]);
    }
    reset() {
      this.operations.push("reset");
    }
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
    proposeDimensions() {
      return { cols: 84, rows: 32 };
    }
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
const { BackgroundTerminalPanel } = await import("../../../Frontend/src/features/terminal/BackgroundTerminalPanel.tsx");
const { TerminalRuntimeBoundary } = await import("../../../Frontend/src/features/terminal/TerminalPanelStatus.tsx");

beforeEach(() => {
  xterm.instances.length = 0;
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
    onStartTerminal: vi.fn(),
    onRefresh: vi.fn(),
    onWrite,
    onResize,
    onSignal,
    onClose: vi.fn(),
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
  expect(terminal.options.theme.background).toBe("#0c0c0c");
  expect(terminal.unicode.activeVersion).toBe("11");
  expect(terminal.operations).not.toContain("load:webgl");
  expect(terminal.operations).toContain("blur");
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
  expect(terminal.operations).not.toContain("focus");
  act(() => {
    terminal.emitInput("allowed");
    terminal.emitResize(132, 42);
  });
  await waitFor(() => {
    expect(onWrite).toHaveBeenCalledWith("res_00000000000000000000000000000000", "allowed");
    expect(onResize).toHaveBeenCalledWith("res_00000000000000000000000000000000", 132, 42);
  });
});

test("terminal output appends by cursor without replaying a trimmed text buffer", async () => {
  const resource = terminalResource(["interactive-input"]);
  const panel = (output) =>
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [resource],
        outputs: { [resource.resourceId]: output },
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    );
  const view = render(
    panel({
      cursor: 1,
      generation: 0,
      chunks: [{ cursor: 1, text: "PS E:\\workspace> " }],
      text: "PS E:\\workspace> ",
      truncated: false,
    }),
  );

  await waitFor(() => expect(xterm.instances).toHaveLength(1));
  const terminal = xterm.instances[0];
  expect(terminal.operations).toContainEqual(["write", "PS E:\\workspace> "]);

  view.rerender(
    panel({
      cursor: 2,
      generation: 0,
      chunks: [{ cursor: 2, text: "111" }],
      text: "... earlier terminal output omitted ...\r\n111",
      truncated: true,
    }),
  );

  await waitFor(() => expect(terminal.operations).toContainEqual(["write", "111"]));
  expect(terminal.operations).not.toContain("reset");
});

test("visited terminal instances survive tab switches without being rebuilt", async () => {
  const user = userEvent.setup();
  const resources = [
    terminalResource([], "res_00000000000000000000000000000001", "shell-one", "2026-07-16T00:00:02.000Z", {
      purpose: "interactive-shell",
      title: "shell-one",
    }),
    terminalResource([], "res_00000000000000000000000000000002", "shell-two", "2026-07-16T00:00:01.000Z", {
      purpose: "interactive-shell",
      title: "shell-two",
    }),
  ];
  const panel = (nextResources) =>
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: nextResources,
        outputs: {},
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    );
  const view = render(panel(resources));

  await waitFor(() => expect(xterm.instances).toHaveLength(1));
  const first = xterm.instances[0];
  screen.getByRole("tab", { name: "shell-one" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "shell-two" })).toHaveAttribute("aria-selected", "true");
  await waitFor(() => expect(xterm.instances).toHaveLength(2));
  expect(first.disposed).toBe(false);
  screen.getByRole("tab", { name: "shell-two" }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "shell-one" })).toHaveAttribute("aria-selected", "true");
  expect(xterm.instances).toHaveLength(2);

  const second = xterm.instances[1];
  view.rerender(panel([resources[0]]));
  await waitFor(() => expect(second.disposed).toBe(true));
  expect(first.disposed).toBe(false);
  view.unmount();
});

test("discarding a terminal cancels buffered input instead of sending it to the removed resource", async () => {
  const onWrite = vi.fn();
  const props = {
    outputs: {},
    onStartTerminal: vi.fn(),
    onRefresh: vi.fn(),
    onWrite,
    onResize: vi.fn(),
    onSignal: vi.fn(),
    onClose: vi.fn(),
    onStopAll: vi.fn(),
  };
  const panel = (resources) =>
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, { ...props, resources }),
    );
  const view = render(panel([terminalResource(["interactive-input"])]));
  await waitFor(() => expect(xterm.instances).toHaveLength(1));

  let pendingFrame;
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    pendingFrame = callback;
    return 91;
  });
  const cancelFrame = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  act(() => xterm.instances[0].emitInput("not-sent"));
  view.rerender(panel([]));
  act(() => pendingFrame?.(performance.now()));

  expect(cancelFrame).toHaveBeenCalledWith(91);
  expect(onWrite).not.toHaveBeenCalled();
});

test("a newly created terminal becomes the active tab", async () => {
  const first = terminalResource(
    ["interactive-input"],
    "res_00000000000000000000000000000001",
    "shell-one",
    "2026-07-16T00:00:01.000Z",
    { purpose: "interactive-shell", title: "shell-one" },
  );
  const view = render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [first],
        outputs: {},
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );

  expect(await screen.findByRole("tab", { name: "shell-one" })).toHaveAttribute("aria-selected", "true");
  const second = terminalResource(
    ["interactive-input"],
    "res_00000000000000000000000000000002",
    "shell-two",
    "2026-07-16T00:00:02.000Z",
    { purpose: "interactive-shell", title: "shell-two" },
  );
  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [first, second],
        outputs: {},
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );

  await waitFor(() => expect(screen.getByRole("tab", { name: "shell-two" })).toHaveAttribute("aria-selected", "true"));
  expect(xterm.instances.at(-1)?.operations).not.toContain("focus");
});

test("closes only the terminal represented by the clicked tab", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [
          terminalResource([], "res_00000000000000000000000000000011", "shell-one", "2026-07-16T00:00:01.000Z", {
            purpose: "interactive-shell",
            title: "shell-one",
          }),
          terminalResource([], "res_00000000000000000000000000000012", "shell-two", "2026-07-16T00:00:02.000Z", {
            purpose: "interactive-shell",
            title: "shell-two",
          }),
        ],
        outputs: {},
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose,
        onStopAll: vi.fn(),
      }),
    ),
  );

  const closeButtons = await screen.findAllByRole("button", { name: "关闭终端" });
  await user.click(closeButtons[0]);
  expect(onClose).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledWith("res_00000000000000000000000000000012");
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
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
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
          onStartTerminal: vi.fn(),
          onRefresh: vi.fn(),
          onWrite: vi.fn(),
          onResize: vi.fn(),
          onSignal: vi.fn(),
          onClose: vi.fn(),
          onStopAll: vi.fn(),
        }),
      ),
    ),
  );

  expect(await screen.findByRole("region", { name: "终端" })).toBeVisible();
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
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );

  await waitFor(() => expect(xterm.instances).toHaveLength(1));
  const initialTerminal = xterm.instances[0];
  view.unmount();
  await waitFor(() => expect(initialTerminal.disposed).toBe(true));
});

test("terminal workbench creates an interactive terminal and ignores non-terminal process resources", async () => {
  const user = userEvent.setup();
  const onStartTerminal = vi.fn();
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [processResource()],
        outputs: {},
        onStartTerminal,
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );

  expect(screen.queryByRole("tab", { name: "npm run dev" })).not.toBeInTheDocument();
  expect(screen.getByText("没有打开的终端")).toBeVisible();
  expect(xterm.instances).toHaveLength(0);
  await user.click(screen.getAllByRole("button", { name: "新建终端" })[0]);
  expect(onStartTerminal).toHaveBeenCalledOnce();
  expect(onStartTerminal).toHaveBeenCalledWith();
  expect(xterm.instances).toHaveLength(0);
});

test("terminal labels use presentation metadata and never parse URL fragments from commands", async () => {
  const legacy = terminalResource(
    ["interactive-input"],
    "res_00000000000000000000000000000004",
    "Invoke-WebRequest https://chat.senerapi.com/; exit",
    "2026-07-16T00:00:04.000Z",
    undefined,
  );
  const task = terminalResource(
    ["interactive-input"],
    "res_00000000000000000000000000000005",
    "Invoke-WebRequest https://chat.senerapi.com/; exit",
    "2026-07-16T00:00:05.000Z",
    { purpose: "command-task", title: "测试 API 延迟" },
  );
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [legacy, task],
        outputs: {},
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );

  expect(await screen.findByRole("tab", { name: "测试 API 延迟" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "PowerShell" })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "; exit" })).not.toBeInTheDocument();
});

test("completed terminal tasks are read-only and do not keep an active cursor", async () => {
  const completed = terminalResource(
    ["interactive-input", "resize", "signals"],
    "res_00000000000000000000000000000006",
    "npm test",
    "2026-07-16T00:00:06.000Z",
    { purpose: "command-task", title: "运行测试" },
    "completed",
  );
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [completed],
        outputs: {},
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );

  await waitFor(() => expect(xterm.instances).toHaveLength(1));
  expect(xterm.instances[0].options.disableStdin).toBe(true);
  expect(xterm.instances[0].options.cursorBlink).toBe(false);
  expect(xterm.instances[0].operations).toContain("blur");
  expect(screen.getByText("已完成")).toBeVisible();
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
  presentation = { purpose: "interactive-shell" },
  state = "running",
) {
  return {
    resourceId,
    kind: "terminal",
    state,
    command,
    cwd: "E:\\workspace",
    createdAt,
    updatedAt: createdAt,
    cursor: 1,
    oldestCursor: 1,
    truncated: false,
    events: [],
    ...(presentation ? { presentation } : {}),
    terminal: {
      backend: "docker-engine-sidecar",
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

function processResource() {
  return {
    resourceId: "res_00000000000000000000000000000003",
    kind: "process",
    state: "running",
    command: "npm run dev",
    cwd: "E:\\workspace",
    createdAt: "2026-07-16T00:00:03.000Z",
    updatedAt: "2026-07-16T00:00:03.000Z",
    cursor: 1,
    oldestCursor: 1,
    truncated: false,
    events: [],
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
