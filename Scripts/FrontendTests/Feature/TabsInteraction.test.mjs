import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../Frontend/src/shared/ui/Tabs.tsx";

afterEach(() => {
  cleanup();
});

test("controlled tabs switch content by click and expose linked tabpanel semantics", async () => {
  const onValueChange = vi.fn();

  function Harness() {
    const [value, setValue] = React.useState("execution");
    return React.createElement(
      Tabs,
      {
        value,
        onValueChange: (nextValue) => {
          onValueChange(nextValue);
          setValue(nextValue);
        },
      },
      React.createElement(
        TabsList,
        { "aria-label": "工作区" },
        React.createElement(TabsTrigger, { value: "execution" }, "执行"),
        React.createElement(TabsTrigger, { value: "terminal" }, "终端"),
      ),
      React.createElement(TabsContent, { value: "execution" }, "执行内容"),
      React.createElement(TabsContent, { value: "terminal" }, "终端内容"),
    );
  }

  render(React.createElement(Harness));
  const terminalTab = screen.getByRole("tab", { name: "终端" });
  const user = userEvent.setup();

  expect(screen.getByRole("tab", { name: "执行" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("执行内容");
  expect(screen.queryByText("终端内容")).not.toBeInTheDocument();

  await user.click(terminalTab);

  expect(onValueChange).toHaveBeenCalledWith("terminal");
  expect(terminalTab).toHaveAttribute("aria-selected", "true");
  const terminalPanel = screen.getByRole("tabpanel");
  expect(terminalPanel).toHaveTextContent("终端内容");
  expect(terminalTab).toHaveAttribute("aria-controls", terminalPanel.id);
});

test("tabs provide roving focus, wrap navigation, and skip disabled triggers", async () => {
  render(
    React.createElement(
      Tabs,
      { defaultValue: "execution" },
      React.createElement(
        TabsList,
        { "aria-label": "工作区" },
        React.createElement(TabsTrigger, { value: "execution" }, "执行"),
        React.createElement(TabsTrigger, { value: "disabled", disabled: true }, "禁用"),
        React.createElement(TabsTrigger, { value: "terminal" }, "终端"),
      ),
      React.createElement(TabsContent, { value: "execution" }, "执行内容"),
      React.createElement(TabsContent, { value: "disabled" }, "禁用内容"),
      React.createElement(TabsContent, { value: "terminal" }, "终端内容"),
    ),
  );

  const executionTab = screen.getByRole("tab", { name: "执行" });
  const disabledTab = screen.getByRole("tab", { name: "禁用" });
  const terminalTab = screen.getByRole("tab", { name: "终端" });
  const user = userEvent.setup();

  await user.tab();
  expect(executionTab).toHaveFocus();
  expect(disabledTab).toHaveAttribute("tabindex", "-1");

  await user.click(disabledTab);
  expect(executionTab).toHaveAttribute("aria-selected", "true");

  await user.keyboard("{ArrowRight}");
  expect(terminalTab).toHaveFocus();
  expect(terminalTab).toHaveAttribute("aria-selected", "true");
  expect(disabledTab).toHaveAttribute("aria-selected", "false");

  await user.keyboard("{ArrowRight}");
  expect(executionTab).toHaveFocus();

  await user.keyboard("{End}");
  expect(terminalTab).toHaveFocus();

  await user.keyboard("{Home}");
  expect(executionTab).toHaveFocus();

  await user.keyboard("{ArrowLeft}");
  expect(terminalTab).toHaveFocus();
  expect(screen.getByRole("tabpanel")).toHaveTextContent("终端内容");
});
