import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { PillExpandNavbar } from "../../../Frontend/src/shared/ui/PillExpandNavbar.tsx";
import { Tabs, TabsContent } from "../../../Frontend/src/shared/ui/Tabs.tsx";
import { AppMotionProvider } from "../../../Frontend/src/shared/motion/MotionProvider.tsx";

afterEach(cleanup);

const items = [
  { id: "execution", label: "执行", icon: React.createElement("span", null, "E") },
  { id: "terminal", label: "终端", icon: React.createElement("span", null, "T") },
  { id: "offline", label: "未连接", icon: React.createElement("span", null, "O"), disabled: true },
];

test("hover reveals an action without invoking it and restores the selected action on leave", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const view = render(
    React.createElement(
      AppMotionProvider,
      { level: "none" },
      React.createElement(PillExpandNavbar, {
        items,
        value: "execution",
        onValueChange: onChange,
        label: "工具入口",
      }),
    ),
  );
  const execution = screen.getByRole("button", { name: "执行" });
  const terminal = screen.getByRole("button", { name: "终端" });
  fireEvent.pointerEnter(terminal, { pointerType: "mouse" });
  expect(terminal).toHaveAttribute("data-pill-expanded", "true");
  expect(execution).toHaveAttribute("aria-pressed", "true");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerLeave(view.container.querySelector("nav"));
  expect(execution).toHaveAttribute("data-pill-expanded", "true");
  await user.click(screen.getByRole("button", { name: "未连接" }));
  expect(onChange).not.toHaveBeenCalled();
  await user.click(terminal);
  expect(onChange).toHaveBeenCalledExactlyOnceWith("terminal");
});

test("tabs retain Radix keyboard selection and their associated panel", async () => {
  const user = userEvent.setup();
  function Panel() {
    const [value, setValue] = React.useState("execution");
    return React.createElement(
      AppMotionProvider,
      { level: "none" },
      React.createElement(
        Tabs,
        { value, onValueChange: setValue },
        React.createElement(PillExpandNavbar, { items, value, mode: "tabs", label: "运行面板" }),
        React.createElement(TabsContent, { value: "execution" }, "执行过程"),
        React.createElement(TabsContent, { value: "terminal" }, "终端输出"),
      ),
    );
  }
  render(React.createElement(Panel));
  const execution = screen.getByRole("tab", { name: "执行" });
  execution.focus();
  await user.keyboard("{ArrowRight}");
  const terminal = screen.getByRole("tab", { name: "终端" });
  expect(terminal).toHaveFocus();
  expect(terminal).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("终端输出");
  expect(terminal).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
});
