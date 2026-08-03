import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/code/CodeTextEditor.tsx", () => ({
  CodeTextEditor: ({ ariaLabel, disabled, onChange, value }) =>
    React.createElement("textarea", {
      "aria-label": ariaLabel,
      disabled,
      onChange: (event) => onChange(event.currentTarget.value),
      value,
    }),
}));

const { PresetControl } = await import("../../../Frontend/src/features/chat/PresetPanel.tsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("preset control edits and saves a selected preset with activation", async () => {
  const onSave = vi.fn(() => "save-request");
  const onSetActive = vi.fn(() => "active-request");
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(
      PresetControl,
      createPresetControlProps({
        onSave,
        onSetActive,
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "角色预设" }));
  const nameInput = await screen.findByRole("textbox", { name: "预设名称" });
  const contentInput = await screen.findByRole("textbox", { name: "角色预设内容" });
  await user.clear(nameInput);
  await user.type(nameInput, "reviewer");
  await user.clear(contentInput);
  await user.type(contentInput, "Review changes and report risks.");
  await user.click(screen.getByRole("button", { name: "保存并启用" }));

  expect(onSave).toHaveBeenCalledWith({
    name: "reviewer.md",
    format: "markdown",
    content: "Review changes and report risks.",
    activate: true,
  });

  await user.click(screen.getByRole("button", { name: "启用" }));
  expect(onSetActive).toHaveBeenCalledWith("writer.md");
}, 10_000);

test("preset control requires confirmation before deleting the selected preset", async () => {
  const onDelete = vi.fn(() => "delete-request");
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(PresetControl, createPresetControlProps({ onDelete })));

  await user.click(screen.getByRole("button", { name: "角色预设" }));
  await screen.findByRole("textbox", { name: "预设名称" });
  await user.click(screen.getByRole("button", { name: "删除" }));
  expect(screen.getByText("删除角色预设")).toBeVisible();
  const deleteButtons = screen.getAllByRole("button", { name: "删除" });
  await user.click(deleteButtons[0]);

  expect(onDelete).toHaveBeenCalledWith("writer.md");
});

function createPresetControlProps(overrides = {}) {
  return {
    disabled: false,
    enabled: true,
    rootDir: ".senera/presets",
    presets: [
      {
        name: "writer.md",
        title: "Writer",
        format: "markdown",
        sizeBytes: 32,
        updatedAt: "2026-07-11T00:00:00.000Z",
        active: false,
        content: "Write clearly.",
        diagnostics: [],
      },
    ],
    activePresetName: null,
    operations: {},
    onRefresh: vi.fn(),
    onSave: vi.fn(() => null),
    onDelete: vi.fn(() => null),
    onSetActive: vi.fn(() => null),
    ...overrides,
  };
}
