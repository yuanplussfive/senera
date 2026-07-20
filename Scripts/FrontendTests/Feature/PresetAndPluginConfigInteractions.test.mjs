import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
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
const { PlanningConfigView } = await import("../../../Frontend/src/features/chat/PlanningConfigView.tsx");
const { PluginConfigContent } = await import("../../../Frontend/src/features/chat/PluginConfigPanel.tsx");
const { TooltipProvider } = await import("../../../Frontend/src/shared/ui/Tooltip.tsx");
const { ConfigSourceNotice, Diagnostics, SettingsView, TomlView, ViewSwitch } =
  await import("../../../Frontend/src/features/chat/PluginConfigViews.tsx");

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

test("planning config selects only chat-capable models and can return to inherited defaults", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const value = {
    ModelProviders: [
      { Id: "planner-a", Model: "Planner Alpha", Capabilities: { Chat: true } },
      { Id: "embedding-a", Model: "Embedding Alpha", Capabilities: { Chat: false } },
    ],
  };
  const view = renderWithFrontendProviders(
    React.createElement(PlanningConfigView, {
      value,
      onChange,
    }),
  );

  await user.click(screen.getByRole("button", { name: "模型: 继承主模型" }));
  expect(screen.queryByText("Embedding Alpha")).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Planner Alpha" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ActionPlanner: { Client: { ModelProviderId: "planner-a" } },
    }),
  );

  view.rerender(
    React.createElement(PlanningConfigView, {
      value: {
        ...value,
        ActionPlanner: { Client: { ModelProviderId: "planner-a" } },
      },
      onChange,
    }),
  );
  await user.click(screen.getByRole("button", { name: "模型: Planner Alpha" }));
  await user.click(screen.getByRole("menuitem", { name: "继承主模型" }));
  expect(onChange.mock.calls.at(-1)[0].ActionPlanner.Client.ModelProviderId).toBeUndefined();
});

test("plugin settings route tool and field changes while parse failures disable controls", async () => {
  const onSetToolEnabled = vi.fn();
  const onUpdateField = vi.fn();
  const user = userEvent.setup();
  const plugin = createPlugin();
  const props = {
    plugin,
    sections: plugin.sections,
    parsedDraft: { General: { Enabled: true } },
    toolsDisabled: false,
    onSetToolEnabled,
    onUpdateField,
  };
  const view = renderWithFrontendProviders(React.createElement(SettingsView, props));

  await user.click(screen.getByText("SearchTool").closest("button"));
  expect(onSetToolEnabled).toHaveBeenCalledWith("SearchTool", false);
  await user.click(screen.getByRole("switch", { name: "关闭 Enable search" }));
  expect(onUpdateField).toHaveBeenCalledWith(plugin.sections[0].fields[0], false);

  view.rerender(
    React.createElement(SettingsView, {
      ...props,
      parseError: "invalid TOML",
    }),
  );
  expect(screen.getByText("配置源码解析失败，修复后才能使用设置视图。")).toBeVisible();
  expect(screen.getByText("SearchTool").closest("button")).toBeDisabled();
});

test("plugin source controls expose view changes, diagnostics, templates, and TOML edits", async () => {
  const onViewChange = vi.fn();
  const onDraftChange = vi.fn();
  const user = userEvent.setup();
  const plugin = createPlugin({
    needsUserConfig: true,
    configTemplatePath: "C:/plugins/Search/PluginConfig.example.toml",
  });
  renderWithFrontendProviders(
    React.createElement(
      "div",
      null,
      React.createElement(ViewSwitch, { value: "settings", onChange: onViewChange }),
      React.createElement(TomlView, { draft: "Enabled = true", onChange: onDraftChange }),
      React.createElement(Diagnostics, {
        diagnostics: [{ severity: "warning", message: "optional key missing" }],
        parseError: "invalid TOML",
        validationErrors: ["value required"],
        saveError: "save rejected",
      }),
      React.createElement(ConfigSourceNotice, { plugin }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "源码" }));
  expect(onViewChange).toHaveBeenCalledWith("toml");
  await user.type(screen.getByRole("textbox"), "\nTimeout = 30");
  expect(onDraftChange).toHaveBeenCalled();
  expect(screen.getByText("optional key missing")).toBeVisible();
  expect(screen.getByText("invalid TOML")).toBeVisible();
  expect(screen.getByText("value required")).toBeVisible();
  expect(screen.getByText("save rejected")).toBeVisible();
  expect(screen.getByText(/PluginConfig\.example\.toml 已根据示例文件初始化配置/)).toBeVisible();
});

test("plugin config autosaves changes and keeps the latest value during a snapshot refresh", async () => {
  const onSave = vi.fn(() => "save-request");
  const user = userEvent.setup();
  const props = {
    layoutMode: "workspace",
    plugins: [createPlugin()],
    operations: {},
    onRefresh: vi.fn(),
    onSave,
    onSetEnabled: vi.fn(() => "toggle-request"),
  };
  const view = renderWithFrontendProviders(React.createElement(PluginConfigContent, props));
  await user.click(screen.getByRole("button", { name: /Search plugin1\/1/ }));

  await user.click(screen.getByRole("switch", { name: "关闭 Enable search" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith("SearchPlugin", expect.stringContaining("Enabled = false")));

  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(PluginConfigContent, {
        ...props,
        plugins: [createPlugin({ description: "refreshed metadata" })],
      }),
    ),
  );
  expect(screen.getByRole("switch", { name: "开启 Enable search" })).toBeInTheDocument();
  expect(onSave).toHaveBeenCalledTimes(1);
});

test("plugin config accepts later snapshots after save success includes the saved snapshot", async () => {
  const onSave = vi.fn(() => "save-request");
  const user = userEvent.setup();
  const props = {
    layoutMode: "workspace",
    plugins: [createPlugin()],
    operations: {},
    onRefresh: vi.fn(),
    onSave,
    onSetEnabled: vi.fn(() => "toggle-request"),
  };
  const view = renderWithFrontendProviders(React.createElement(PluginConfigContent, props));
  await user.click(screen.getByRole("button", { name: /Search plugin1\/1/ }));
  await user.click(screen.getByRole("switch", { name: "关闭 Enable search" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

  const savedToml = onSave.mock.calls[0][1];
  const successfulOperation = {
    "save-request": {
      requestId: "save-request",
      pluginName: "SearchPlugin",
      kind: "update",
      status: "success",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
  };
  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(PluginConfigContent, {
        ...props,
        plugins: [createPlugin({ toml: savedToml })],
        operations: successfulOperation,
      }),
    ),
  );
  await waitFor(() => expect(screen.getByRole("switch", { name: "开启 Enable search" })).toBeVisible());

  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(PluginConfigContent, {
        ...props,
        plugins: [createPlugin({ toml: "[General]\nEnabled = true" })],
        operations: successfulOperation,
      }),
    ),
  );

  await waitFor(() => expect(screen.getByRole("switch", { name: "关闭 Enable search" })).toBeVisible());
  expect(onSave).toHaveBeenCalledTimes(1);
});

test("plugin drafts and errors stay isolated when switching during a save", async () => {
  const onSave = vi.fn(() => "search-save");
  const user = userEvent.setup();
  const plugins = [createPlugin(), createPlugin({ name: "OtherPlugin", title: "Other plugin" })];
  const props = {
    layoutMode: "workspace",
    plugins,
    operations: {},
    onRefresh: vi.fn(),
    onSave,
    onSetEnabled: vi.fn(() => "toggle-request"),
  };
  const view = renderWithFrontendProviders(React.createElement(PluginConfigContent, props));

  await user.click(screen.getByRole("button", { name: /Search plugin/ }));
  await user.click(screen.getByRole("switch", { name: "关闭 Enable search" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith("SearchPlugin", expect.stringContaining("Enabled = false")));

  await user.click(screen.getByRole("button", { name: "返回技能列表" }));
  await user.click(screen.getByRole("button", { name: /Other plugin/ }));
  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(PluginConfigContent, {
        ...props,
        operations: {
          "search-save": {
            requestId: "search-save",
            pluginName: "SearchPlugin",
            kind: "update",
            status: "error",
            message: "search rejected",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        },
      }),
    ),
  );

  expect(screen.queryByText("search rejected")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "返回技能列表" }));
  await user.click(screen.getByRole("button", { name: /Search plugin/ }));
  expect(screen.getByRole("switch", { name: "开启 Enable search" })).toBeVisible();
  expect(screen.getByRole("button", { name: /重试|Retry/ })).toBeVisible();
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

function createPlugin(overrides = {}) {
  const enabledField = {
    section: "General",
    key: "Enabled",
    path: ["General", "Enabled"],
    label: "Enable search",
    type: "boolean",
    value: true,
  };
  return {
    name: "SearchPlugin",
    title: "Search plugin",
    kind: "ToolPlugin",
    rootKind: "User",
    rootPath: "C:/plugins/Search",
    manifestPath: "C:/plugins/Search/PluginManifest.json",
    configPath: "C:/plugins/Search/PluginConfig.toml",
    configExists: true,
    configSource: "file",
    configTemplateExists: false,
    needsUserConfig: false,
    enabled: true,
    available: true,
    toolCount: 1,
    enabledToolCount: 1,
    tools: [{ name: "SearchTool", summary: "Search files", enabled: true }],
    sections: [
      {
        name: "General",
        label: "General",
        keyCount: 1,
        fields: [enabledField],
      },
    ],
    toml: "[General]\nEnabled = true",
    diagnostics: [],
    ...overrides,
  };
}
