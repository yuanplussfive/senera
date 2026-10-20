import React, { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Slider } from "../../../Frontend/src/shared/ui/Slider.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

test("slider exposes its semantic value and renders named marks", () => {
  const onValueChange = vi.fn();
  renderWithFrontendProviders(
    React.createElement(Slider, {
      ariaLabel: "界面字号",
      value: 1,
      min: 0.9,
      max: 1.12,
      step: 0.001,
      marks: [
        { value: 0.96, label: "紧凑" },
        { value: 1, label: "标准" },
        { value: 1.08, label: "大字" },
      ],
      showValue: true,
      formatValue: (value) => `${Math.round(value * 100)}%`,
      onValueChange,
    }),
  );

  const input = screen.getByRole("slider", { name: "界面字号" });
  expect(input).toHaveAttribute("aria-valuetext", "100%");
  expect(screen.getByText("紧凑")).toBeInTheDocument();
  expect(screen.getByText("标准")).toBeInTheDocument();
  expect(document.querySelector("[data-slider-mark-selected]")).toHaveAttribute("data-slider-mark", "1");

  fireEvent.change(input, { target: { value: "1.08" } });
  expect(onValueChange).toHaveBeenLastCalledWith(1.08);
});

test("slider walks declared discrete values through the keyboard", () => {
  function Harness() {
    const [value, setValue] = useState(40);
    return React.createElement(Slider, {
      ariaLabel: "任务并发数",
      value,
      steps: [10, 40, 80],
      onValueChange: setValue,
    });
  }

  renderWithFrontendProviders(React.createElement(Harness));
  const input = screen.getByRole("slider", { name: "任务并发数" });

  fireEvent.keyDown(input, { key: "ArrowRight" });
  expect(input).toHaveValue("80");
  fireEvent.keyDown(input, { key: "Home" });
  expect(input).toHaveValue("10");
  fireEvent.keyDown(input, { key: "End" });
  expect(input).toHaveValue("80");
});

test("slider keeps disabled state unavailable to input", () => {
  renderWithFrontendProviders(
    React.createElement(Slider, {
      ariaLabel: "不可用阈值",
      value: 60,
      min: 0,
      max: 100,
      disabled: true,
      onValueChange: () => undefined,
    }),
  );

  expect(screen.getByRole("slider", { name: "不可用阈值" })).toBeDisabled();
});

test("slider separates live changes from the settled value", () => {
  const onValueChange = vi.fn();
  const onValueCommit = vi.fn();
  renderWithFrontendProviders(
    React.createElement(Slider, {
      ariaLabel: "预览字号",
      value: 1,
      min: 0.9,
      max: 1.12,
      step: 0.001,
      onValueChange,
      onValueCommit,
    }),
  );

  const input = screen.getByRole("slider", { name: "预览字号" });
  const slider = input.closest("[data-slider]");
  fireEvent.pointerDown(input, { pointerType: "mouse" });
  fireEvent.change(input, { target: { value: "1.06" } });
  expect(onValueChange).toHaveBeenLastCalledWith(1.06);
  expect(onValueCommit).not.toHaveBeenCalled();

  expect(slider).toHaveAttribute("data-slider-interacting", "true");
  fireEvent.pointerUp(input, { pointerType: "mouse" });
  expect(onValueCommit).toHaveBeenCalledWith(1.06);
  fireEvent.blur(input);
  expect(onValueCommit).toHaveBeenCalledTimes(1);
  expect(slider).not.toHaveAttribute("data-slider-interacting");
});
