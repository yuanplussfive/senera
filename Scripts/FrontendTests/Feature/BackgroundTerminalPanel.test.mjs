import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useSetAppearancePreference } from "../../../Frontend/src/shared/theme/useAppearance.tsx";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";
import { ApprovalRequestStrip } from "../../../Frontend/src/features/chat/ApprovalRequestStrip.tsx";

const xterm = vi.hoisted(() => ({ instances: [], webgl: [], failWebgl: false }));
const { ExecutionResourceOutputStore } = await import("../../../Frontend/src/app/executionResourceOutputStore.ts");
let outputStore;

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    constructor(options) {
      this.options = { ...options };
      this.cols = options.cols ?? 100;
      this.rows = options.rows ?? 30;
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
    getSelection() {
      return this.selection ?? "";
    }
    write(value, callback) {
      this.operations.push(["write", value]);
      callback?.();
    }
    refresh(start, end) {
      this.operations.push(["refresh", start, end]);
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
      this.cols = cols;
      this.rows = rows;
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
    clearDecorations() {}
    onDidChangeResults() {
      return { dispose() {} };
    }
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
    disposed = false;
    constructor() {
      if (xterm.failWebgl) throw new Error("WebGL2 unavailable");
      xterm.webgl.push(this);
    }
    onContextLoss(listener) {
      this.contextLoss = listener;
      return {
        dispose: () => {
          this.contextLoss = undefined;
        },
      };
    }
    dispose() {
      this.disposed = true;
    }
  },
}));
const { BackgroundTerminalPanel } = await import("../../../Frontend/src/features/terminal/BackgroundTerminalPanel.tsx");
const { TerminalRuntimeBoundary } = await import("../../../Frontend/src/features/terminal/TerminalPanelStatus.tsx");

beforeEach(() => {
  xterm.instances.length = 0;
  xterm.webgl.length = 0;
  xterm.failWebgl = false;
  outputStore = new ExecutionResourceOutputStore();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("terminal controls follow the effective backend capabilities", async () => {
  let setAppearance;
  function AppearanceControl() {
    setAppearance = useSetAppearancePreference();
    return null;
  }
  const user = userEvent.setup();
  const onWrite = vi.fn();
  const onResize = vi.fn();
  const onSignal = vi.fn();
  const baseProps = {
    outputStore,
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
      React.createElement(AppearanceControl),
      React.createElement(BackgroundTerminalPanel, {
        ...baseProps,
        resources,
      }),
    );
  const view = render(panel([terminalResource([])]));

  await user.click(screen.getByRole("button", { name: "更多终端操作" }));
  const interruptButton = await screen.findByRole("menuitem", { name: "中断当前终端" });
  expect(interruptButton).toHaveAttribute("data-disabled");
  expect(await screen.findByRole("menuitem", { name: "停止当前终端" })).toHaveAttribute("data-disabled");
  expect(xterm.instances).toHaveLength(1);
  const terminal = xterm.instances[0];
  expect(terminal.options.allowProposedApi).toBe(true);
  expect(terminal.options.theme.background).toBe("rgb(255,255,255)");
  expect(terminal.unicode.activeVersion).toBe("11");
  expect(terminal.operations).toContain("load:webgl");
  expect(terminal.operations).toContain("blur");
  expect(terminal.options.disableStdin).toBe(true);

  act(() => {
    terminal.emitInput("blocked");
    terminal.emitResize(120, 40);
  });
  expect(onWrite).not.toHaveBeenCalled();
  expect(onResize).not.toHaveBeenCalled();

  view.rerender(panel([terminalResource(["interactive-input", "resize", "signals"])]));

  expect(interruptButton).not.toHaveAttribute("data-disabled");
  expect(screen.getByRole("menuitem", { name: "停止当前终端" })).not.toHaveAttribute("data-disabled");
  expect(terminal.options.disableStdin).toBe(false);
  expect(terminal.operations).not.toContain("focus");
  act(() => setAppearance({ themeMode: "dark" }));
  await waitFor(() => expect(terminal.options.theme.background).toBe("rgb(31,41,55)"));
  expect(document.querySelector("[data-terminal-panel]")).toHaveAttribute("data-terminal-theme", "dark");
  expect(xterm.instances).toHaveLength(1);
  act(() => setAppearance({ themeMode: "light" }));
  await waitFor(() => expect(terminal.options.theme.background).toBe("rgb(255,255,255)"));
  act(() => {
    terminal.emitInput("allowed");
    terminal.emitResize(132, 42);
  });
  await waitFor(() => {
    expect(onWrite).toHaveBeenCalledWith("res_00000000000000000000000000000000", "allowed");
    expect(onResize).toHaveBeenCalledWith("res_00000000000000000000000000000000", 132, 42);
  });
});

test("terminal output appends directly without rendering the panel or replaying a trimmed journal", async () => {
  const resource = terminalResource(["interactive-input"]);
  outputStore.append(resource.resourceId, 1, "PS E:\\workspace> ");
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [resource],
        outputStore,
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
  const terminal = xterm.instances[0];
  expect(terminal.operations).toContainEqual(["write", "PS E:\\workspace> "]);
  act(() => outputStore.append(resource.resourceId, 2, "111", true));
  await waitFor(() => expect(terminal.operations).toContainEqual(["write", "111"]));
  expect(terminal.operations).not.toContain("reset");
});

test("terminal instances survive selection changes without being rebuilt", async () => {
  const user = userEvent.setup();
  const resources = [
    terminalResource([], "res_00000000000000000000000000000001", "shell-one", "2026-07-16T00:00:01.000Z", {
      purpose: "interactive-shell",
      title: "shell-one",
    }),
    terminalResource([], "res_00000000000000000000000000000002", "shell-two", "2026-07-16T00:00:02.000Z", {
      purpose: "interactive-shell",
      title: "shell-two",
    }),
  ];
  const panel = (nextResources, active = true) =>
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: nextResources,
        active,
        outputStore,
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

  await waitFor(() => expect(xterm.instances).toHaveLength(2));
  const first = xterm.instances[0];
  await chooseTerminal(user, "shell-two");
  expect(screen.getByRole("button", { name: "选择终端: shell-two" })).toBeVisible();
  expect(first.disposed).toBe(false);
  await chooseTerminal(user, "shell-one");
  expect(screen.getByRole("button", { name: "选择终端: shell-one" })).toBeVisible();
  expect(xterm.instances).toHaveLength(2);

  const second = xterm.instances[1];
  view.rerender(panel(resources, false));
  expect(document.querySelectorAll("[data-terminal-active='true']")).toHaveLength(0);
  expect(xterm.webgl.every((renderer) => renderer.disposed)).toBe(true);
  expect(first.disposed).toBe(false);
  view.rerender(panel(resources, true));
  expect(document.querySelectorAll("[data-terminal-active='true']")).toHaveLength(1);
  expect(xterm.instances).toHaveLength(2);
  const background = terminalResource(
    [],
    "res_00000000000000000000000000000003",
    "npm run dev",
    "2026-07-16T00:00:03.000Z",
    { purpose: "background-process", title: "dev server" },
  );
  view.rerender(panel([...resources, background]));
  expect(screen.getByRole("button", { name: "选择终端: shell-one" })).toBeVisible();
  expect(xterm.instances).toHaveLength(3);
  view.rerender(panel([resources[0]]));
  await waitFor(() => expect(second.disposed).toBe(true));
  expect(first.disposed).toBe(false);
  view.unmount();
});

test("discarding a terminal cancels buffered input instead of sending it to the removed resource", async () => {
  const onWrite = vi.fn();
  const props = {
    outputStore,
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

test("a newly created terminal becomes the selected terminal", async () => {
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
        outputStore,
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

  expect(await screen.findByRole("button", { name: "选择终端: shell-one" })).toBeVisible();
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
        outputStore,
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

  await waitFor(() => expect(screen.getByRole("button", { name: "选择终端: shell-two" })).toBeVisible());
  expect(xterm.instances.at(-1)?.operations).not.toContain("focus");
});

test("close targets the selected terminal", async () => {
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
        outputStore,
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

  await chooseTerminal(user, "shell-two");
  await user.click(screen.getByRole("button", { name: "更多终端操作" }));
  await user.click(screen.getByRole("menuitem", { name: "关闭终端" }));
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
        outputStore,
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
          outputStore,
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

test("closing from the menu waits for the server to remove the PTY resource", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [terminalResource([])],
        outputStore,
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
  const selector = await screen.findByRole("button", { name: "选择终端: PowerShell" });
  await user.click(screen.getByRole("button", { name: "更多终端操作" }));
  await user.click(screen.getByRole("menuitem", { name: "关闭终端" }));
  expect(onClose).toHaveBeenCalledWith("res_00000000000000000000000000000000");
  expect(selector).toBeInTheDocument();
  expect(xterm.instances[0].disposed).toBe(false);
});

test("WebGL context loss keeps terminal output and input usable with the DOM renderer", async () => {
  const onWrite = vi.fn();
  const resource = terminalResource(["interactive-input"]);
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [resource],
        outputStore,
        onStartTerminal: vi.fn(),
        onRefresh: vi.fn(),
        onWrite,
        onResize: vi.fn(),
        onSignal: vi.fn(),
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    ),
  );
  await waitFor(() => expect(xterm.webgl).toHaveLength(1));
  act(() => xterm.webgl[0].contextLoss());
  expect(xterm.webgl[0].disposed).toBe(true);
  expect(document.querySelector("[data-terminal-renderer='dom']")).toBeInTheDocument();
  act(() => {
    outputStore.append(resource.resourceId, 1, "still running");
    xterm.instances[0].emitInput("\r");
  });
  expect(xterm.instances[0].operations).toContainEqual(["write", "still running"]);
  expect(onWrite).toHaveBeenCalledWith(resource.resourceId, "\r");
  expect(xterm.instances[0].disposed).toBe(false);
});

test("an unavailable WebGL device opens a usable DOM terminal", async () => {
  xterm.failWebgl = true;
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [terminalResource(["interactive-input"])],
        outputStore,
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
  await waitFor(() => expect(document.querySelector("[data-terminal-renderer='dom']")).toBeInTheDocument());
  expect(xterm.instances[0].disposed).toBe(false);
  expect(xterm.instances[0].options.disableStdin).toBe(false);
});

test("unmounting the terminal dock releases its xterm resource", async () => {
  const view = render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources: [terminalResource([])],
        outputStore,
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

test("terminal workbench keeps foreground commands out and displays background process logs", async () => {
  const user = userEvent.setup();
  const onStartTerminal = vi.fn();
  const onSignal = vi.fn();
  const panel = (resources) =>
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(BackgroundTerminalPanel, {
        resources,
        outputStore,
        onStartTerminal,
        onRefresh: vi.fn(),
        onWrite: vi.fn(),
        onResize: vi.fn(),
        onSignal,
        onClose: vi.fn(),
        onStopAll: vi.fn(),
      }),
    );
  const view = render(panel([processResource()]));

  expect(screen.queryByRole("tab", { name: "npm run dev" })).not.toBeInTheDocument();
  expect(screen.getByText("没有打开的终端")).toBeVisible();
  expect(xterm.instances).toHaveLength(0);
  await user.click(screen.getAllByRole("button", { name: "新建终端" })[0]);
  expect(onStartTerminal).toHaveBeenCalledOnce();
  expect(onStartTerminal).toHaveBeenCalledWith();
  expect(xterm.instances).toHaveLength(0);

  const background = {
    ...processResource(),
    presentation: { purpose: "background-process", title: "npm run dev" },
  };
  outputStore.append(background.resourceId, 1, "server listening\nready\n");
  view.rerender(panel([background]));
  await waitFor(() => expect(xterm.instances).toHaveLength(1));
  expect(screen.queryByText("没有打开的终端")).not.toBeInTheDocument();
  expect(xterm.instances[0].options.convertEol).toBe(true);
  expect(xterm.instances[0].options.disableStdin).toBe(true);
  expect(xterm.instances[0].operations).toContainEqual(["write", "server listening\nready\n"]);
  await user.click(screen.getByRole("button", { name: "更多终端操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "停止当前终端" }));
  expect(onSignal).toHaveBeenCalledWith(background.resourceId, "terminate");
});

test("terminal labels use presentation metadata and never parse URL fragments from commands", async () => {
  const user = userEvent.setup();
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
        outputStore,
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

  await user.click(await screen.findByRole("button", { name: "选择终端: 测试 API 延迟" }));
  expect(screen.getByRole("menuitemradio", { name: /^测试 API 延迟/ })).toBeVisible();
  expect(screen.getByRole("menuitemradio", { name: /^PowerShell/ })).toBeVisible();
  expect(screen.queryByRole("menuitemradio", { name: "; exit" })).not.toBeInTheDocument();
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
        outputStore,
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
  expect(screen.getAllByRole("img", { name: "已完成" }).every((icon) => icon.querySelector("svg"))).toBe(true);
  expect(screen.queryByText("已完成")).not.toBeInTheDocument();
});

test("the selector closes a specific terminal without changing selection before removal is acknowledged", async () => {
  const user = userEvent.setup();
  const onSignal = vi.fn();
  const onClose = vi.fn();
  const first = terminalResource(["signals"], "first", "first", undefined, { title: "终端一" });
  const second = terminalResource(["signals"], "second", "second", undefined, { title: "终端二" });
  const completed = terminalResource(["signals"], "done", "done", undefined, { title: "已结束终端" }, "completed");
  const unsupported = terminalResource([], "readonly", "readonly", undefined, { title: "只读终端" });
  const stopping = terminalResource(
    ["signals"],
    "stopping",
    "stopping",
    undefined,
    { title: "正在停止终端" },
    "stopping",
  );
  renderTerminalPanel([first, completed, unsupported, stopping, second], { onSignal, onClose });

  await user.click(await screen.findByRole("button", { name: "选择终端: 终端二" }));
  const radio = screen.getByRole("menuitemradio", { name: "终端一" });
  expect(radio).toHaveAttribute("aria-checked", "false");
  expect(screen.getByRole("menuitem", { name: "关闭并移除 终端一" }).closest('[role="menuitemradio"]')).toBeNull();
  await user.click(screen.getByRole("menuitem", { name: "关闭并移除 终端一" }));

  expect(onClose).toHaveBeenCalledExactlyOnceWith("first");
  expect(onSignal).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "选择终端: 终端二" })).toBeVisible();
  expect(screen.getByRole("menu")).toBeVisible();
  await user.click(screen.getByRole("menuitem", { name: "关闭并移除 已结束终端" }));
  expect(onClose).toHaveBeenLastCalledWith("done");
  await user.click(screen.getByRole("menuitem", { name: "关闭并移除 只读终端" }));
  expect(onClose).toHaveBeenLastCalledWith("readonly");
  await user.click(screen.getByRole("menuitem", { name: "关闭并移除 正在停止终端" }));
  expect(onClose).toHaveBeenLastCalledWith("stopping");
  expect(screen.queryByText("运行中")).not.toBeInTheDocument();
});

test("right click copies only the xterm selection without opening or propagating a menu", async () => {
  userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const parentMenu = vi.fn();
  renderTerminalPanel([terminalResource([])], {}, { onContextMenu: parentMenu });
  await waitFor(() => expect(xterm.instances).toHaveLength(1));
  const viewport = document.querySelector("[data-terminal-active='true']");

  fireEvent.contextMenu(viewport);
  expect(writeText).not.toHaveBeenCalled();
  xterm.instances[0].selection = "选中的内容\nline two";
  expect(fireEvent.contextMenu(viewport)).toBe(false);
  await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("选中的内容\nline two"));
  expect(parentMenu).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

test("terminal information replaces the actions menu and dismisses on Escape", async () => {
  const user = userEvent.setup();
  renderTerminalPanel([terminalResource([])]);
  const trigger = await screen.findByRole("button", { name: "更多终端操作" });
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "终端信息" }));
  const dialog = await screen.findByRole("dialog", { name: "终端信息" });
  expect(dialog).toBeVisible();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
      arguments: { mode: "shell", dialect: "powershell", script: "npm test", workspaceEffect: "read" },
    },
  };
}

async function chooseTerminal(user, label) {
  await user.click(screen.getByRole("button", { name: /^选择终端:/ }));
  await user.click(
    await screen.findByRole("menuitemradio", { name: (name) => name.startsWith(`${label} `) || name === label }),
  );
}

function renderTerminalPanel(resources, overrides = {}, wrapperProps = {}) {
  return render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        "div",
        wrapperProps,
        React.createElement(BackgroundTerminalPanel, {
          resources,
          outputStore,
          onStartTerminal: vi.fn(),
          onRefresh: vi.fn(),
          onWrite: vi.fn(),
          onResize: vi.fn(),
          onSignal: vi.fn(),
          onClose: vi.fn(),
          onStopAll: vi.fn(),
          ...overrides,
        }),
      ),
    ),
  );
}
