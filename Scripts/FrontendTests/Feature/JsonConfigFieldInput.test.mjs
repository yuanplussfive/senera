import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderJsonConfigFieldInput } from "../../../Frontend/src/shared/config/JsonConfigFieldInput.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("model selection remains visible when no capable models are available", () => {
  render(renderJsonConfigFieldInput(modelField([]), "", false, vi.fn()));

  const select = screen.getByRole("combobox");
  expect(select).toHaveValue("");
  expect(screen.getByRole("option", { name: "Automatic" })).toBeInTheDocument();
});

test("model selection uses one stable control for a small dynamic catalog", async () => {
  const onChange = vi.fn();
  render(renderJsonConfigFieldInput(modelField(["vision-a", "vision-b"]), "", false, onChange));

  const select = screen.getByRole("combobox");
  expect(screen.queryByRole("button", { name: "Vision A" })).not.toBeInTheDocument();

  const user = userEvent.setup();
  await user.selectOptions(select, "vision-b");

  expect(onChange).toHaveBeenCalledWith("vision-b");
});

test("optional model selection can return to automatic resolution", async () => {
  const onChange = vi.fn();
  render(renderJsonConfigFieldInput(modelField(["vision-a"]), "vision-a", false, onChange));

  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox"), "");

  expect(onChange).toHaveBeenCalledWith("");
});

function modelField(options) {
  return {
    label: "Vision model",
    section: "model",
    key: "modelProviderId",
    path: ["model", "modelProviderId"],
    type: "string",
    value: "",
    effectiveValue: "",
    configured: false,
    missing: false,
    valueSource: "default",
    placeholder: "Automatic",
    options,
    optionLabels: {
      "vision-a": "Vision A",
      "vision-b": "Vision B",
    },
    required: false,
    essential: true,
    modelSelection: {
      id: "image.vision-model",
      capability: "Vision",
      valueKind: "model-id",
      mutation: "config",
      required: false,
    },
  };
}
