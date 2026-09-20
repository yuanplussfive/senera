import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { PresetControl } = await import("../../../Frontend/src/features/chat/PresetPanel.tsx");
const { PresetSidebar } = await import("../../../Frontend/src/features/chat/PresetSidebar.tsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("preset sidebar keeps the fluid hover gap from selecting a preset", async () => {
  const onSelect = vi.fn();
  renderWithFrontendProviders(
    React.createElement(PresetSidebar, {
      activePreset: null,
      busy: false,
      enabled: true,
      filterText: "",
      onCreate: vi.fn(),
      onFilterTextChange: vi.fn(),
      onRefresh: vi.fn(),
      onSelect,
      presets: createPresetControlProps().presets,
      selectedName: "writer.json",
    }),
  );

  const list = document.querySelector("[data-preset-list]");
  const row = document.querySelector("[data-preset-list-item]");
  expect(list).toBeInTheDocument();
  expect(row).toBeInTheDocument();
  vi.spyOn(list, "getBoundingClientRect").mockReturnValue(createRect(0));
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(createRect(8));

  fireEvent.pointerMove(list, { clientY: 20, pointerType: "mouse" });
  await waitFor(() => expect(document.querySelector("[data-preset-fluid-hover]")).toBeInTheDocument());

  fireEvent.click(list);
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(row);
  expect(onSelect).toHaveBeenCalledWith("writer.json");
});

test("preset control saves a structured persona card with activation", async () => {
  const onSave = vi.fn(() => "save-request");
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(PresetControl, createPresetControlProps({ onSave, presets: [] })));

  await user.click(screen.getByRole("button", { name: "角色预设" }));
  const nameInput = await screen.findByRole("textbox", { name: "预设名称" });
  await user.clear(nameInput);
  await user.type(nameInput, "reviewer");
  const personaInput = screen.getByRole("textbox", { name: "核心人设" });
  const styleInput = screen.getByRole("textbox", { name: "语言风格" });
  await user.clear(personaInput);
  await user.clear(styleInput);
  await user.type(personaInput, "审阅代码时给出具体风险");
  await user.type(styleInput, "直接、简洁");
  await user.click(screen.getByRole("button", { name: "保存并启用" }));

  expect(onSave).toHaveBeenCalledWith({
    name: "reviewer",
    activate: true,
    card: expect.objectContaining({
      schemaVersion: "senera.persona/v2",
      title: "reviewer",
      corePersona: "审阅代码时给出具体风险",
      languageStyle: "直接、简洁",
      examples: [],
      lore: [],
    }),
  });
}, 30_000);

test("preset control requires confirmation before deleting the selected preset", async () => {
  const onDelete = vi.fn(() => "delete-request");
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(PresetControl, createPresetControlProps({ onDelete })));

  await user.click(screen.getByRole("button", { name: "角色预设" }));
  await screen.findByRole("textbox", { name: "预设名称" });
  await user.click(screen.getByRole("button", { name: "删除当前预设" }));
  expect(screen.getByText("删除这个预设？")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "删除预设" }));

  expect(onDelete).toHaveBeenCalledWith("writer.json");
});

test("preset control keeps an existing card's storage identity when its title changes", async () => {
  const onSave = vi.fn(() => "save-request");
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(PresetControl, createPresetControlProps({ onSave })));

  await user.click(screen.getByRole("button", { name: "角色预设" }));
  const nameInput = await screen.findByRole("textbox", { name: "预设名称" });
  await user.clear(nameInput);
  await user.type(nameInput, "Reviewer");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(onSave).toHaveBeenCalledWith({
    name: "writer.json",
    activate: false,
    card: expect.objectContaining({ title: "Reviewer" }),
  });
});

test("preset control binds a declarative resident world without editing JSON", async () => {
  const onSave = vi.fn(() => "save-request");
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(
      PresetControl,
      createPresetControlProps({
        onSave,
        worldPackages: [
          {
            id: "night-life",
            title: "夜间生活",
            entityCount: 3,
            relationCount: 0,
            stateMachineCount: 1,
            habitCount: 1,
            autonomyCount: 0,
          },
        ],
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "角色预设" }));
  await user.click(await screen.findByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ card: expect.objectContaining({ worldPackageIds: ["night-life"] }) }),
  );
});

function createPresetControlProps(overrides = {}) {
  return {
    disabled: false,
    enabled: true,
    rootDir: ".senera/presets",
    presets: [
      {
        name: "writer.json",
        title: "Writer",
        sizeBytes: 32,
        updatedAt: "2026-07-11T00:00:00.000Z",
        active: false,
        card: {
          schemaVersion: "senera.persona/v2",
          title: "Writer",
          corePersona: "清晰写作",
          languageStyle: "简洁",
          worldPackageIds: [],
          examples: [],
          lore: [],
        },
        diagnostics: [],
      },
    ],
    worldPackages: [],
    activePresetName: null,
    operations: {},
    onRefresh: vi.fn(),
    onSave: vi.fn(() => null),
    onDelete: vi.fn(() => null),
    onSetActive: vi.fn(() => null),
    ...overrides,
  };
}

function createRect(top) {
  return {
    bottom: top + 36,
    height: 36,
    left: 0,
    right: 220,
    top,
    width: 220,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}
