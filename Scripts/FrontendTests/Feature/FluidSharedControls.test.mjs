import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AppMotionProvider } from "../../../Frontend/src/shared/motion/MotionProvider.tsx";
import { SegmentedControl } from "../../../Frontend/src/shared/ui/SegmentedControl.tsx";
import { ScrollArea } from "../../../Frontend/src/shared/ui/ScrollArea.tsx";
import { Switch } from "../../../Frontend/src/shared/ui/Switch.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../Frontend/src/shared/ui/Tabs.tsx";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";

afterEach(cleanup);

function motionless(children) {
  return React.createElement(AppMotionProvider, { level: "none" }, children);
}

test("tabs and segmented controls project the same shared measured selection layer", async () => {
  const user = userEvent.setup();
  function Harness() {
    const [tab, setTab] = React.useState("one");
    const [segment, setSegment] = React.useState("one");
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        Tabs,
        { value: tab, onValueChange: setTab },
        React.createElement(
          TabsList,
          { "aria-label": "Shared tabs" },
          React.createElement(TabsTrigger, { value: "one" }, "One"),
          React.createElement(TabsTrigger, { value: "two" }, "Two"),
        ),
        React.createElement(TabsContent, { value: "one" }, "One content"),
        React.createElement(TabsContent, { value: "two" }, "Two content"),
      ),
      React.createElement(SegmentedControl, {
        ariaLabel: "Shared segments",
        options: [
          { value: "one", label: "One" },
          { value: "two", label: "Two" },
        ],
        value: segment,
        onChange: setSegment,
      }),
    );
  }

  render(motionless(React.createElement(React.StrictMode, null, React.createElement(Harness))));
  await waitFor(() => expect(document.querySelectorAll("[data-fluid-segmented-selection]")).toHaveLength(2));
  await user.click(screen.getAllByRole("tab", { name: "Two" })[0]);
  await user.click(screen.getAllByRole("radio", { name: "Two" })[0]);
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Two content");
  expect(screen.getAllByRole("radio", { name: "Two" })[0]).toHaveAttribute("aria-checked", "true");
});

test("controlled segmented controls remain stable when switching identities", async () => {
  const user = userEvent.setup();
  function IdentityHarness() {
    const [identity, setIdentity] = React.useState("user");
    return React.createElement(SegmentedControl, {
      ariaLabel: "Identity",
      options: [
        { value: "user", label: "User" },
        { value: "assistant", label: "Assistant" },
      ],
      value: identity,
      onChange: setIdentity,
    });
  }

  render(motionless(React.createElement(React.StrictMode, null, React.createElement(IdentityHarness))));
  await user.click(screen.getByRole("radio", { name: "Assistant" }));
  await waitFor(() => expect(document.querySelectorAll("[data-fluid-segmented-selection]")).toHaveLength(1));

  expect(screen.getByRole("radio", { name: "Assistant" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("radio", { name: "User" })).toHaveAttribute("aria-checked", "false");
});

test("switch commits a drag once and does not follow it with a click toggle", () => {
  const onCheckedChange = vi.fn();
  render(motionless(React.createElement(Switch, { checked: false, ariaLabel: "Drag switch", onCheckedChange })));
  const control = screen.getByRole("switch", { name: "Drag switch" });

  fireEvent.pointerDown(control, { pointerId: 1, button: 0, clientX: 2 });
  fireEvent.pointerMove(control, { pointerId: 1, clientX: 30 });
  fireEvent.pointerUp(control, { pointerId: 1, clientX: 30 });
  fireEvent.click(control);

  expect(onCheckedChange).toHaveBeenCalledTimes(1);
  expect(onCheckedChange).toHaveBeenCalledWith(true);
});

test("guarded disabled switches explain the blocked action without toggling", async () => {
  const user = userEvent.setup();
  const onCheckedChange = vi.fn();
  const onDisabledClick = vi.fn();
  render(
    motionless(
      React.createElement(
        TooltipProvider,
        { delayDuration: 0 },
        React.createElement(Switch, {
          checked: true,
          disabled: true,
          disabledReason: "The default model still uses this provider.",
          ariaLabel: "Provider availability",
          onCheckedChange,
          onDisabledClick,
        }),
      ),
    ),
  );

  const control = screen.getByRole("switch", { name: "Provider availability" });
  expect(control).not.toBeDisabled();
  expect(control).toHaveAttribute("aria-disabled", "true");
  await user.click(control);
  expect(onDisabledClick).toHaveBeenCalledTimes(1);
  expect(onCheckedChange).not.toHaveBeenCalled();
});

test("scroll areas provide explicit axis and reveal state through the shared component", () => {
  render(
    motionless(
      React.createElement(
        ScrollArea,
        { orientation: "both", className: "h-24 w-24" },
        React.createElement("div", { className: "h-96 w-96" }, "Long content"),
      ),
    ),
  );
  expect(document.querySelectorAll("[data-slot='scroll-area-scrollbar']")).toHaveLength(2);
  expect(document.querySelector("[data-slot='scroll-area-scrollbar']")).not.toHaveAttribute("data-visible");
  fireEvent.pointerEnter(document.querySelector("[data-slot='scroll-area']"));
  expect(document.querySelector("[data-slot='scroll-area-scrollbar']")).toHaveAttribute("data-visible", "");
});
