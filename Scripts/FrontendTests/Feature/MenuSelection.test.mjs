import React, { useState } from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MenuMultiSelect } from "../../../Frontend/src/shared/ui/MenuMultiSelect.tsx";
import { MenuSelect } from "../../../Frontend/src/shared/ui/MenuSelect.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

afterEach(() => {
  cleanup();
});

test("MenuSelect exposes radio semantics and ignores reselecting the current value", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();

  function Harness() {
    const [value, setValue] = useState("red");
    return React.createElement(MenuSelect, {
      value,
      placeholder: "选择颜色",
      options: [
        { value: "red", label: "红色" },
        { value: "blue", label: "蓝色" },
      ],
      ariaLabel: "颜色",
      onChange: (next) => {
        onChange(next);
        setValue(next);
      },
    });
  }

  renderWithFrontendProviders(React.createElement(Harness));

  await user.click(screen.getByRole("button", { name: "颜色: 红色" }));
  expect(screen.getByRole("menuitemradio", { name: "红色" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("menuitemradio", { name: "蓝色" })).toHaveAttribute("aria-checked", "false");

  await user.click(screen.getByRole("menuitemradio", { name: "红色" }));
  expect(onChange).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "颜色: 红色" }));
  await user.click(screen.getByRole("menuitemradio", { name: "蓝色" }));
  expect(onChange).toHaveBeenCalledWith("blue");
});

test("MenuSelect keeps an empty-string option selectable", async () => {
  const user = userEvent.setup();

  renderWithFrontendProviders(
    React.createElement(MenuSelect, {
      value: "",
      placeholder: "选择思考级别",
      options: [
        { value: "", label: "继承" },
        { value: "high", label: "高" },
      ],
      ariaLabel: "思考级别",
      onChange: () => undefined,
    }),
  );

  await user.click(screen.getByRole("button", { name: "思考级别: 继承" }));
  expect(screen.getByRole("menuitemradio", { name: "继承" })).toHaveAttribute("aria-checked", "true");
});

test("MenuMultiSelect keeps the menu open while toggling a checkbox", async () => {
  const user = userEvent.setup();

  function Harness() {
    const [values, setValues] = useState([]);
    return React.createElement(MenuMultiSelect, {
      values,
      placeholder: "选择区域",
      options: [
        { value: "us", label: "美国" },
        { value: "eu", label: "欧洲" },
      ],
      ariaLabel: "区域",
      onChange: setValues,
    });
  }

  renderWithFrontendProviders(React.createElement(Harness));
  await user.click(screen.getByRole("button", { name: "区域: 选择区域" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "美国" }));

  expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(screen.getByRole("menuitemcheckbox", { name: "美国" })).toHaveAttribute("aria-checked", "true");
});

test("MenuMultiSelect renders its empty state", async () => {
  const user = userEvent.setup();

  renderWithFrontendProviders(
    React.createElement(MenuMultiSelect, {
      values: [],
      placeholder: "选择区域",
      options: [],
      emptyState: "暂无可选区域",
      ariaLabel: "区域",
      onChange: () => undefined,
    }),
  );

  await user.click(screen.getByRole("button", { name: "区域: 选择区域" }));
  expect(screen.getByRole("menuitem", { name: "暂无可选区域" })).toBeInTheDocument();
});
