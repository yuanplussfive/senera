import React, { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import {
  JsonConfigSettingsView,
  validateJsonConfigDraft,
  writeJsonConfigFieldValue,
} from "../../../Frontend/src/shared/config/JsonConfigForm.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("nested config writes are immutable and create missing parent records", () => {
  const original = {
    Server: { Host: "127.0.0.1" },
    untouched: { enabled: true },
  };

  const updated = writeJsonConfigFieldValue(original, ["Server", "Port"], 8787);
  const created = writeJsonConfigFieldValue(updated, ["AgentLoop", "PiSessions", "RootDir"], ".senera/pi");

  expect(original).toEqual({
    Server: { Host: "127.0.0.1" },
    untouched: { enabled: true },
  });
  expect(created).toEqual({
    Server: { Host: "127.0.0.1", Port: 8787 },
    AgentLoop: { PiSessions: { RootDir: ".senera/pi" } },
    untouched: { enabled: true },
  });
  expect(created.untouched).not.toBe(original.untouched);
});

test("draft validation reports nested table, range, and option violations", () => {
  const sections = [
    {
      name: "runtime",
      label: "Runtime",
      fields: [
        {
          path: ["Retries"],
          label: "Retries",
          type: "number",
          min: 0,
          max: 3,
        },
        {
          path: ["Mode"],
          label: "Mode",
          type: "string",
          options: ["safe", "fast"],
        },
        {
          path: ["Providers"],
          label: "Providers",
          type: "array",
          itemType: "table",
          itemFields: [
            {
              path: ["Providers", "Id"],
              label: "Provider ID",
              type: "string",
              minLength: 2,
            },
          ],
        },
      ],
    },
  ];

  expect(
    validateJsonConfigDraft(sections, {
      Retries: 9,
      Mode: "unknown",
      Providers: [{ Id: "" }, "invalid"],
    }),
  ).toEqual(["Retries 不能大于 3", "Mode 必须是允许的选项", "Provider ID 不能为空", "Providers 第 2 项 必须是对象"]);
});

test("settings form updates boolean, option, number, array, and record controls", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(React.createElement(ConfigHarness, { onChange }));

  await user.click(screen.getByRole("switch", { name: "Enabled" }));
  await user.click(screen.getByRole("button", { name: "Safe" }));
  const number = screen.getByRole("spinbutton");
  await user.clear(number);
  await user.type(number, "3");
  await user.click(screen.getByRole("button", { name: "添加标签" }));
  await user.click(screen.getByRole("button", { name: "添加键值" }));

  expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute("aria-checked", "true");
  expect(number).toHaveValue(3);
  const tagsSection = screen.getByText("Tags").closest("div.grid");
  expect(within(tagsSection).getAllByRole("textbox")).toHaveLength(2);
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      Enabled: true,
      Mode: "safe",
      Retries: 3,
      Tags: ["release", ""],
      Headers: { existing: "value", key: "" },
    }),
  );
});

test("multi-section settings expose lightweight section navigation", () => {
  render(
    React.createElement(JsonConfigSettingsView, {
      sections: [
        ...configSections,
        {
          name: "planning",
          label: "Planning",
          fields: [{ path: ["Plan"], label: "Plan", type: "string", effectiveValue: "", required: true }],
        },
      ],
      value: initialConfig,
      onChange: vi.fn(),
    }),
  );

  expect(screen.getByRole("navigation", { name: "配置分区" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Runtime" })).toHaveAttribute("href", "#json-config-section-runtime");
  expect(screen.getByRole("link", { name: "Planning" })).toHaveAttribute("href", "#json-config-section-planning");
  cleanup();
  render(
    React.createElement(JsonConfigSettingsView, {
      sections: configSections,
      showSectionHeading: false,
      value: initialConfig,
      onChange: vi.fn(),
    }),
  );
  expect(screen.queryByRole("heading", { name: "Runtime" })).not.toBeInTheDocument();
});

test("settings default to required fields and switches, then reveal all optional fields on demand", async () => {
  const user = userEvent.setup();
  render(
    React.createElement(JsonConfigSettingsView, {
      sections: [
        {
          name: "scope",
          label: "Scope",
          fields: [
            {
              path: ["RequiredValue"],
              label: "Required value",
              type: "string",
              effectiveValue: "ready",
              required: true,
            },
            {
              path: ["OptionalValue"],
              label: "Optional value",
              type: "string",
              effectiveValue: "default",
              required: false,
            },
            {
              path: ["OptionalSwitch"],
              label: "Optional switch",
              type: "boolean",
              effectiveValue: false,
              required: false,
            },
          ],
        },
      ],
      value: {},
      onChange: vi.fn(),
    }),
  );

  expect(screen.getByText("Required value")).toBeVisible();
  expect(screen.getByText("Optional switch")).toBeVisible();
  expect(screen.queryByText("Optional value")).not.toBeInTheDocument();
  expect(screen.getAllByText("必填")).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: /全部/ }));

  expect(screen.getByText("Optional value")).toBeVisible();
  expect(screen.getAllByText("可选")).not.toHaveLength(0);
});

test("disabled settings form blocks every mutable control", () => {
  render(
    React.createElement(JsonConfigSettingsView, {
      sections: configSections,
      value: initialConfig,
      disabled: true,
      onChange: vi.fn(),
    }),
  );

  for (const control of screen.getAllByRole("button")) {
    expect(control).toBeDisabled();
  }
  for (const control of [...screen.getAllByRole("textbox"), ...screen.getAllByRole("spinbutton")]) {
    expect(control).toBeDisabled();
  }
});

function ConfigHarness({ onChange }) {
  const [value, setValue] = useState(initialConfig);
  return React.createElement(JsonConfigSettingsView, {
    sections: configSections,
    value,
    onChange: (next) => {
      setValue(next);
      onChange(next);
    },
  });
}

const initialConfig = {
  Enabled: false,
  Mode: "fast",
  Retries: 1,
  Tags: ["release"],
  Headers: { existing: "value" },
};

const configSections = [
  {
    name: "runtime",
    label: "Runtime",
    description: "Runtime settings",
    fields: [
      {
        path: ["Enabled"],
        label: "Enabled",
        type: "boolean",
        effectiveValue: false,
        required: true,
      },
      {
        path: ["Mode"],
        label: "Mode",
        type: "string",
        options: ["fast", "safe"],
        optionLabels: { fast: "Fast", safe: "Safe" },
        effectiveValue: "fast",
        required: true,
      },
      {
        path: ["Retries"],
        label: "Retries",
        type: "number",
        min: 0,
        max: 5,
        effectiveValue: 1,
        required: true,
      },
      {
        path: ["Tags"],
        label: "Tags",
        type: "array",
        itemType: "string",
        addLabel: "添加标签",
        effectiveValue: ["release"],
        required: true,
      },
      {
        path: ["Headers"],
        label: "Headers",
        type: "record",
        itemType: "string",
        effectiveValue: { existing: "value" },
        required: true,
      },
    ],
  },
];
