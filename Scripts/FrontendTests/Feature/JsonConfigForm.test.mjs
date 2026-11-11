import React, { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import {
  JsonConfigSettingsView,
  validateJsonConfigDraft,
  writeJsonConfigFieldValue,
} from "../../../Frontend/src/shared/config/JsonConfigForm.tsx";
import { sameJsonValue } from "../../../Frontend/src/shared/config/JsonConfigValue.ts";

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

test("clearing an optional field deletes its empty parent object", () => {
  const original = { defaults: { modelProviderId: "child-model" }, untouched: true };

  const updated = writeJsonConfigFieldValue(original, ["defaults", "modelProviderId"], undefined);

  expect(updated).toEqual({ untouched: true });
  expect(original).toEqual({ defaults: { modelProviderId: "child-model" }, untouched: true });
});

test("JSON equality ignores object key order while preserving array order", () => {
  expect(
    sameJsonValue(
      { Runtime: { Enabled: true, Limits: { Requests: 4, Bytes: 1024 } } },
      { Runtime: { Limits: { Bytes: 1024, Requests: 4 }, Enabled: true } },
    ),
  ).toBe(true);
  expect(sameJsonValue({ Values: ["first", "second"] }, { Values: ["second", "first"] })).toBe(false);
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

test("optional object children become required only when their parent is present", () => {
  const sections = [
    {
      name: "models",
      fields: [
        {
          path: ["Models"],
          label: "模型",
          type: "array",
          itemType: "table",
          itemFields: [
            {
              path: ["Models", "Generation", "Api"],
              label: "生成协议",
              type: "string",
              required: true,
              optionalParents: [["Models", "Generation"]],
              options: ["images"],
            },
          ],
        },
      ],
    },
  ];
  expect(validateJsonConfigDraft(sections, { Models: [{}, { Generation: { Api: "images" } }] })).toEqual([]);
  expect(validateJsonConfigDraft(sections, { Models: [{ Generation: {} }] })).toEqual(["生成协议 缺少必填配置"]);
  expect(validateJsonConfigDraft(sections, { Models: [{ Generation: { Api: "invalid" } }] })).toEqual([
    "生成协议 必须是允许的选项",
  ]);
});

test("table items inherit effective values by label instead of array position", () => {
  const sections = [
    {
      name: "models",
      label: "Models",
      fields: [
        {
          path: ["Providers"],
          label: "Providers",
          type: "array",
          itemType: "table",
          itemLabelPath: ["Id"],
          effectiveValue: [
            { Id: "catalog", Icon: "", ApiKey: "" },
            { Id: "custom", Icon: "custom-icon", ApiKey: "" },
          ],
          itemFields: [
            { path: ["Providers", "Id"], label: "Provider ID", type: "string" },
            { path: ["Providers", "Icon"], label: "Icon", type: "string", required: false, minLength: 1 },
            { path: ["Providers", "ApiKey"], label: "API Key", type: "string", required: false, minLength: 1 },
          ],
        },
      ],
    },
  ];

  expect(validateJsonConfigDraft(sections, { Providers: [{ Id: "custom" }] })).toEqual([]);
  expect(validateJsonConfigDraft(sections, { Providers: [{ Id: "custom", ApiKey: "" }] })).toEqual([
    "API Key 不能为空",
  ]);
});

test("table item controls show effective values of the matching label", () => {
  render(
    React.createElement(JsonConfigSettingsView, {
      sections: [
        {
          name: "models",
          label: "Models",
          fields: [
            {
              path: ["Providers"],
              label: "Providers",
              type: "array",
              itemType: "table",
              itemLabelPath: ["Id"],
              effectiveValue: [
                { Id: "catalog", Icon: "openai" },
                { Id: "custom", Icon: "custom-icon" },
              ],
              addLabel: "添加供应商",
              defaultItem: { Id: "" },
              essential: true,
              itemFields: [
                { path: ["Providers", "Id"], label: "Provider ID", type: "string", essential: true },
                { path: ["Providers", "Icon"], label: "Icon", type: "string", essential: true },
              ],
            },
          ],
        },
      ],
      value: { Providers: [{ Id: "custom" }] },
      onChange: vi.fn(),
    }),
  );

  expect(screen.getByDisplayValue("custom-icon")).toBeInTheDocument();
  expect(screen.queryByDisplayValue("openai")).not.toBeInTheDocument();
});

test("settings form updates boolean, option, number, array, and record controls", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(React.createElement(ConfigHarness, { onChange }));

  await user.click(screen.getByRole("switch", { name: "Enabled" }));
  await user.click(screen.getByRole("radio", { name: "Safe" }));
  const number = screen.getByRole("spinbutton");
  await user.clear(number);
  await user.type(number, "3");
  await user.click(screen.getByRole("button", { name: "添加标签" }));
  await user.click(screen.getByRole("button", { name: "添加键值" }));

  expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("radio", { name: "Safe" })).toHaveAttribute("aria-checked", "true");
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

test("settings can hide section headings", () => {
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

test("settings use declared essential visibility independently from required validation", async () => {
  const user = userEvent.setup();
  const { container } = render(
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
              essential: true,
            },
            {
              path: ["OptionalValue"],
              label: "Optional value",
              type: "string",
              effectiveValue: "default",
              required: false,
              essential: false,
            },
            {
              path: ["OptionalSwitch"],
              label: "Optional switch",
              type: "boolean",
              effectiveValue: false,
              required: false,
              essential: true,
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
  expect(screen.getAllByText("必填")).toHaveLength(1);
  expect(container.querySelector('[data-json-config-section="scope"]')).toHaveClass("rounded-lg", "border");

  await user.click(screen.getByRole("button", { name: /全部/ }));

  expect(screen.getByText("Optional value")).toBeVisible();
  expect(screen.queryByText("可选")).not.toBeInTheDocument();
});

test("settings without essential fields open on all fields and hide the empty filter", () => {
  render(
    React.createElement(JsonConfigSettingsView, {
      sections: [
        {
          name: "retention",
          label: "Retention",
          fields: [
            {
              path: ["Artifacts", "RetentionHours"],
              label: "Artifact retention",
              type: "number",
              effectiveValue: 168,
              required: false,
              essential: false,
            },
            {
              path: ["Uploads", "RetentionHours"],
              label: "Upload retention",
              type: "number",
              effectiveValue: 72,
              required: false,
              essential: false,
            },
          ],
        },
      ],
      value: {},
      onChange: vi.fn(),
    }),
  );

  expect(screen.getByText("Artifact retention")).toBeVisible();
  expect(screen.getByText("Upload retention")).toBeVisible();
  expect(screen.queryByRole("group", { name: "配置范围" })).not.toBeInTheDocument();
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
        essential: true,
      },
      {
        path: ["Mode"],
        label: "Mode",
        type: "string",
        options: ["fast", "safe"],
        optionLabels: { fast: "Fast", safe: "Safe" },
        effectiveValue: "fast",
        required: true,
        essential: true,
      },
      {
        path: ["Retries"],
        label: "Retries",
        type: "number",
        min: 0,
        max: 5,
        effectiveValue: 1,
        required: true,
        essential: true,
      },
      {
        path: ["Tags"],
        label: "Tags",
        type: "array",
        itemType: "string",
        addLabel: "添加标签",
        effectiveValue: ["release"],
        required: true,
        essential: true,
      },
      {
        path: ["Headers"],
        label: "Headers",
        type: "record",
        itemType: "string",
        effectiveValue: { existing: "value" },
        required: true,
        essential: true,
      },
    ],
  },
];
