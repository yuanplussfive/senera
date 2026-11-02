import React, { useState } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithFrontendProviders as render } from "../renderWithFrontendProviders.mjs";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SearchSelect } from "../../../Frontend/src/shared/ui/SearchSelect.tsx";
import { ModelSelect, modelSelectOption } from "../../../Frontend/src/shared/models/ModelSelect.tsx";
import { ChatModelSelector } from "../../../Frontend/src/features/chat/ChatModelSelector.tsx";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { DurationInput } from "../../../Frontend/src/shared/ui/DurationInput.tsx";
import { SecretInput } from "../../../Frontend/src/shared/ui/SecretInput.tsx";

afterEach(cleanup);

test("model pickers retain custom logos and searchable provider metadata without showing a provider line", async () => {
  const user = userEvent.setup();
  const model = modelSelectOption({
    id: "owned-model",
    model: "GPT Vision",
    icon: "/profile/my-logo.png",
    providerId: "My provider",
  });
  const onChange = vi.fn();
  render(React.createElement(ModelSelect, { value: model.value, options: [model], placeholder: "模型", onChange }));
  const input = screen.getByRole("combobox");
  expect(input.closest("[data-radix-popper-content-wrapper]")).toBeNull();
  expect(input.parentElement.parentElement.querySelector("img")).toHaveAttribute("src", "/profile/my-logo.png");
  await user.click(input);
  await user.type(input, "provider");
  const option = screen.getByRole("option", { name: "GPT Vision" });
  expect(option).toHaveAccessibleDescription("My provider");
  expect(option.querySelector("[title]")).toBeNull();
  expect(screen.queryByText("My provider")).not.toBeInTheDocument();
  expect(option.querySelector("img")).toHaveAttribute("src", "/profile/my-logo.png");
  await user.click(option);
  expect(onChange).toHaveBeenCalledWith("owned-model");
  await user.click(input);
  await user.clear(input);
  await user.type(input, "555");
  expect(screen.getByText(frontendMessage("chat.model.noMatches"))).toBeVisible();
});

test("chat keeps its selected model clean and nested reasoning choices remain interactive", async () => {
  const user = userEvent.setup();
  const onLevel = vi.fn();
  const model = {
    id: "reasoning",
    model: "Custom model",
    providerId: "Local",
    icon: "/profile/logo.png",
    capabilities: { Chat: true, Reasoning: true },
    toolPlanningMode: "baml",
    stream: true,
    isDefault: true,
    thinkingLevels: ["medium", "high"],
    defaultThinkingLevel: "medium",
  };
  render(
    React.createElement(ChatModelSelector, {
      models: [model],
      selectedId: model.id,
      selectedThinkingLevel: "medium",
      disabled: false,
      prefersCompactControls: false,
      onSelect: vi.fn(),
      onSelectThinkingLevel: onLevel,
    }),
  );
  const input = screen.getByRole("combobox");
  expect(input.parentElement.parentElement.querySelector("img")).toBeNull();
  await user.click(input);
  expect(screen.getByRole("option").querySelector("img")).toHaveAttribute("src", "/profile/logo.png");
  await user.click(screen.getByRole("button", { name: /推理等级/ }));
  await user.click(screen.getByRole("menuitemradio", { name: "high" }));
  expect(onLevel).toHaveBeenCalledWith("high");
});

test("model search selects real IDs, while custom names require explicit opt-in", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    React.createElement(SearchSelect, {
      value: "",
      ariaLabel: "模型",
      placeholder: "选择模型",
      options: [
        { value: "first-id", label: "Image model", description: "Image provider" },
        { value: "second-id", label: "Chat model", description: "Local provider" },
      ],
      onChange,
    }),
  );
  const input = screen.getByRole("combobox", { name: "模型" });
  await user.type(input, "local");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onChange).toHaveBeenLastCalledWith("second-id");
  onChange.mockClear();
  await user.clear(input);
  await user.type(input, "unregistered");
  await user.tab();
  expect(onChange).not.toHaveBeenCalled();
});

test("custom names commit on blur, and Escape discards unfinished editing", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    React.createElement(SearchSelect, {
      allowCustom: true,
      value: "original",
      options: [],
      placeholder: "模型名称",
      onChange,
    }),
  );
  const input = screen.getByRole("combobox");
  await user.clear(input);
  await user.type(input, "custom-model");
  await user.tab();
  expect(onChange).toHaveBeenCalledWith("custom-model");
  onChange.mockClear();
  await user.clear(input);
  await user.type(input, "discard");
  await user.keyboard("{Escape}");
  await user.tab();
  expect(onChange).not.toHaveBeenCalled();
});

test("duration unit changes preserve the stored value and edits convert back to its declared unit", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  function Example() {
    const [value, setValue] = useState(1500);
    return React.createElement(DurationInput, {
      value,
      storageUnit: "milliseconds",
      ariaLabel: "超时",
      min: 1,
      onChange: (next) => {
        onChange(next);
        setValue(next);
      },
    });
  }
  render(React.createElement(Example));
  const input = screen.getByRole("spinbutton", { name: "超时" });
  expect(input).toHaveValue(1.5);
  fireEvent.change(input, { target: { value: "2.25" } });
  expect(onChange).toHaveBeenLastCalledWith(2250);
  onChange.mockClear();
  await user.click(screen.getByRole("button", { name: /单位/ }));
  await user.click(screen.getByRole("menuitemradio", { name: "分钟" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(input).toHaveValue(0.0375);
  fireEvent.change(input, { target: { value: "1" } });
  expect(onChange).toHaveBeenLastCalledWith(60000);
});

test("secret reveal does not modify or copy the key", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    React.createElement(SecretInput, {
      value: "a-long-stored-key",
      ariaLabel: "密钥",
      showLabel: "显示密钥",
      hideLabel: "隐藏密钥",
      onChange,
    }),
  );
  expect(screen.getByLabelText("密钥")).toHaveAttribute("type", "password");
  await user.click(screen.getByRole("button", { name: "显示密钥" }));
  expect(screen.getByLabelText("密钥")).toHaveAttribute("type", "text");
  await user.click(screen.getByRole("button", { name: "隐藏密钥" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /复制/ })).not.toBeInTheDocument();
});

test("viewing a duration never writes back a rounded conversion", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    React.createElement(DurationInput, {
      value: 1234567890123456,
      storageUnit: "milliseconds",
      ariaLabel: "期限",
      onChange,
    }),
  );
  await user.click(screen.getByRole("spinbutton", { name: "期限" }));
  await user.tab();
  expect(onChange).not.toHaveBeenCalled();
});
