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
