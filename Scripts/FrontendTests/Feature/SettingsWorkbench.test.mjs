import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsWorkbench } from "../../../Frontend/src/features/settings/SettingsWorkbench.tsx";
import { ProviderConnectionEditor } from "../../../Frontend/src/features/settings/sections/ProviderConnectionEditor.tsx";
import { FrontendLocales } from "../../../Frontend/src/i18n/frontendLocaleModel.ts";
import { setFrontendLocale } from "../../../Frontend/src/i18n/frontendLocaleStore.ts";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const baseProps = {
  section: "general",
  onSectionChange: vi.fn(),
  environment: {
    appVersion: "1.0.0",
    frontendVersion: "1.0.0",
    mode: "test",
    surface: "web",
  },
  values: {
    defaultSidebarCollapsed: false,
    defaultRightPanelCollapsed: true,
  },
  motionLevel: "full",
  onValueChange: vi.fn(),
  onMotionLevelChange: vi.fn(),
};

beforeEach(() => {
  setFrontendLocale(FrontendLocales.ZhCn);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  baseProps.onSectionChange.mockClear();
});

afterEach(() => {
  setFrontendLocale(FrontendLocales.ZhCn);
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsWorkbench", () => {
  it("offers launch preferences for both side panels", () => {
    const { container } = renderWithFrontendProviders(React.createElement(SettingsWorkbench, baseProps));

    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(container.querySelectorAll("[data-settings-content-frame]")).toHaveLength(1);
    expect(container.querySelector("[data-settings-section='general']")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-settings-panel]")).toHaveLength(3);
  });

  it("uses grouped navigation without migration cards or persistent sync badges", async () => {
    renderWithFrontendProviders(React.createElement(SettingsWorkbench, baseProps));

    await waitFor(() => expect(screen.getByRole("button", { name: "打开设置导航" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "打开设置导航" }));

    expect(screen.getByRole("dialog", { name: "设置导航" })).toBeInTheDocument();
    for (const label of ["模型", "能力与运行", "工具", "个人", "系统"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(document.querySelectorAll("[data-settings-navigation-indicator]")).toHaveLength(1);
    expect(screen.queryByText("已同步")).not.toBeInTheDocument();
    expect(screen.queryByText(/迁移/)).not.toBeInTheDocument();
    expect(screen.queryByText(/状态卡/)).not.toBeInTheDocument();
  });

  it("keeps search results grouped and delegates controlled section changes", async () => {
    renderWithFrontendProviders(React.createElement(SettingsWorkbench, baseProps));
    await waitFor(() => expect(screen.getByRole("button", { name: "打开设置导航" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "打开设置导航" }));

    fireEvent.change(screen.getByRole("textbox", { name: "搜索设置" }), { target: { value: "供应商" } });
    expect(screen.getByText("模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /供应商/ })).toBeInTheDocument();
    expect(screen.queryByText("个人")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /供应商/ }));
    expect(baseProps.onSectionChange).toHaveBeenCalledWith("model-service");
  });

  it("reserves a stable save-status rail while the configuration is idle", async () => {
    const { container } = renderWithFrontendProviders(
      React.createElement(SettingsWorkbench, {
        ...baseProps,
        section: "runtime",
        systemConfig: createSystemConfig(),
      }),
    );

    await waitFor(() => expect(container.querySelector("[data-settings-save-status]")).toBeInTheDocument());
    const rail = container.querySelector("[data-settings-save-status]");
    expect(rail).toHaveClass("h-7", "opacity-0");
    expect(rail).toHaveAttribute("aria-hidden", "true");
  });

  it("automatically syncs typed MCP inputs without retaining a Secret in the input", async () => {
    const systemConfig = createSystemConfig({
      mcpServers: [
        {
          id: "web-research",
          packageName: "web-research",
          source: "bundled",
          descriptorKind: "mcpb",
          transport: "stdio",
          status: "needs_input",
          inputs: [
            {
              id: "TAVILY_API_KEY",
              title: "Tavily API key",
              type: "string",
              required: true,
              secret: true,
              multiple: false,
              configured: true,
              stored: true,
              source: "vault",
              provenance: "mcpb",
            },
          ],
        },
      ],
    });
    renderWithFrontendProviders(
      React.createElement(SettingsWorkbench, {
        ...baseProps,
        section: "mcp-servers",
        systemConfig,
      }),
    );

    const input = await screen.findByLabelText("Tavily API key");
    fireEvent.change(input, { target: { value: "secret-value" } });

    await waitFor(() =>
      expect(systemConfig.updateMcpInputs).toHaveBeenCalledWith("web-research", { TAVILY_API_KEY: "secret-value" }, []),
    );
    expect(screen.queryByRole("button", { name: "保存全部更改" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear the workspace value for Tavily API key" }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(screen.queryByDisplayValue("secret-value")).not.toBeInTheDocument();
  });

  it("keeps a newer MCP value while the previous hot update is awaiting its receipt", async () => {
    let updateNumber = 0;
    const updateMcpInputs = vi.fn(() => `mcp-save-${++updateNumber}`);
    const systemConfig = createSystemConfig({
      updateMcpInputs,
      mcpServers: [
        {
          id: "local-tool",
          packageName: "local-tool",
          source: "workspace",
          descriptorKind: "mcpb",
          transport: "stdio",
          status: "needs_input",
          inputs: [
            {
              id: "endpoint",
              title: "Endpoint",
              type: "string",
              required: true,
              secret: false,
              multiple: false,
              configured: false,
              stored: false,
              source: "missing",
              provenance: "mcpb",
            },
          ],
        },
      ],
    });
    const view = renderWithFrontendProviders(
      React.createElement(SettingsWorkbench, {
        ...baseProps,
        section: "mcp-servers",
        systemConfig,
      }),
    );

    const input = await screen.findByLabelText("Endpoint");
    fireEvent.change(input, { target: { value: "first-value" } });
    await waitFor(() => expect(updateMcpInputs).toHaveBeenCalledWith("local-tool", { endpoint: "first-value" }, []));
    fireEvent.change(input, { target: { value: "newer-value" } });

    systemConfig.mcpInputOperation = { requestId: "mcp-save-1", status: "success" };
    view.rerender(
      React.createElement(
        TooltipProvider,
        { delayDuration: 0 },
        React.createElement(SettingsWorkbench, {
          ...baseProps,
          section: "mcp-servers",
          systemConfig,
        }),
      ),
    );

    await waitFor(() => expect(updateMcpInputs).toHaveBeenCalledWith("local-tool", { endpoint: "newer-value" }, []));
  });

  it("automatically syncs multiple MCP choices as a typed array", async () => {
    const user = userEvent.setup();
    const systemConfig = createSystemConfig({
      mcpServers: [
        {
          id: "regional-search",
          packageName: "regional-search",
          source: "bundled",
          descriptorKind: "mcpb",
          transport: "stdio",
          status: "needs_input",
          inputs: [
            {
              id: "regions",
              title: "Regions",
              type: "string",
              required: true,
              secret: false,
              multiple: true,
              choices: ["us", "eu", "apac"],
              configured: false,
              stored: false,
              source: "missing",
              provenance: "mcpb",
            },
          ],
        },
      ],
    });
    renderWithFrontendProviders(
      React.createElement(SettingsWorkbench, {
        ...baseProps,
        section: "mcp-servers",
        systemConfig,
      }),
    );

    await user.click(await screen.findByRole("button", { name: /Regions/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "us" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "eu" }));
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(systemConfig.updateMcpInputs).toHaveBeenCalledWith("regional-search", { regions: ["us", "eu"] }, []),
    );
  });

  it("hot-updates System extension packages without a separate save flow", async () => {
    const systemConfig = createSystemConfig({
      systemExtensions: [
        {
          id: "execution",
          version: "1.0.0",
          displayName: { "zh-CN": "命令执行", "en-US": "Shell Commands" },
          description: {
            "zh-CN": "在受控执行环境中运行命令。",
            "en-US": "Runs commands in a controlled execution environment.",
          },
          enabled: true,
          configured: false,
          tools: [
            {
              name: "ShellCommandTool",
              description: "Runs a command.",
              loading: "always",
              capability: "shell.run",
            },
          ],
          skillCount: 0,
          mcpServerCount: 0,
        },
      ],
    });
    renderWithFrontendProviders(
      React.createElement(SettingsWorkbench, {
        ...baseProps,
        section: "system-tools",
        systemConfig,
      }),
    );

    expect(await screen.findAllByText("命令执行")).toHaveLength(2);
    expect(await screen.findByText("在受控执行环境中运行命令。")).toBeInTheDocument();
    expect(screen.getByText("ShellCommandTool")).toBeInTheDocument();
    expect(screen.queryByText(/v1\.0\.0/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "启用或停用 命令执行" }));
    expect(screen.queryByRole("button", { name: "保存更改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(systemConfig.saveConfig).toHaveBeenCalledWith({ Extensions: { execution: { Enabled: false } } }),
    );
  });

  it("loads the real provider key into a password field and keeps a newer typed value stable", async () => {
    const provider = {
      Id: "openai",
      Enabled: true,
      BaseUrl: "https://api.openai.com/v1",
      ApiKey: "__senera_redacted_secret__",
    };
    const props = {
      acceptedProvider: provider,
      dirty: false,
      draftProvider: provider,
      disabled: false,
      localError: null,
      providerIndex: 0,
      onReadApiKey: vi.fn(async () => "sk-stored-secret"),
      onChange: vi.fn(),
      onConfirm: vi.fn(),
    };
    const view = renderWithFrontendProviders(React.createElement(ProviderConnectionEditor, props));
    const apiKeyInput = screen.getByPlaceholderText("sk-...");

    expect(apiKeyInput).toHaveAttribute("type", "password");
    await waitFor(() => expect(apiKeyInput).toHaveValue("sk-stored-secret"));
    expect(props.onReadApiKey).toHaveBeenCalledWith("openai");
    fireEvent.click(screen.getByRole("button", { name: "显示 API Key" }));
    expect(apiKeyInput).toHaveAttribute("type", "text");

    fireEvent.change(apiKeyInput, { target: { value: "sk-local-draft" } });
    expect(apiKeyInput).toHaveValue("sk-local-draft");

    view.rerender(
      React.createElement(
        TooltipProvider,
        { delayDuration: 0 },
        React.createElement(ProviderConnectionEditor, {
          ...props,
          operation: { commandId: "save-1", kind: "provider.endpoint.upsert", status: "success" },
          draftProvider: { ...provider },
        }),
      ),
    );

    expect(screen.getByDisplayValue("sk-local-draft")).toBeInTheDocument();
    expect(screen.queryByText(/已启用.*已配置模型/)).not.toBeInTheDocument();
  });

  it("debounces System extension configuration through the shared settings draft", async () => {
    const systemConfig = createSystemConfig({
      systemExtensions: [
        {
          id: "execution",
          version: "1.0.0",
          displayName: { "zh-CN": "命令执行", "en-US": "Shell Commands" },
          description: { "zh-CN": "运行命令。", "en-US": "Runs commands." },
          enabled: true,
          configured: false,
          tools: [],
          skillCount: 0,
          mcpServerCount: 0,
          configuration: {
            configured: false,
            value: {},
            defaults: { defaultCommand: "" },
            effectiveValue: { defaultCommand: "" },
            sections: [
              {
                name: "execution",
                label: { "zh-CN": "执行设置", "en-US": "Execution settings" },
                keyCount: 1,
                fields: [
                  {
                    label: { "zh-CN": "默认命令", "en-US": "Default command" },
                    section: "execution",
                    key: "defaultCommand",
                    path: ["defaultCommand"],
                    type: "string",
                    value: undefined,
                    effectiveValue: "",
                    configured: false,
                    missing: false,
                    valueSource: "default",
                    required: false,
                    essential: true,
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    renderWithFrontendProviders(
      React.createElement(SettingsWorkbench, {
        ...baseProps,
        section: "system-tools",
        systemConfig,
      }),
    );

    const field = (await screen.findByText("默认命令")).closest(".grid");
    const input = field?.querySelector("input");
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "npm run check.types" } });

    await waitFor(() =>
      expect(systemConfig.saveConfig).toHaveBeenCalledWith({
        Extensions: {
          execution: { Enabled: true, Configuration: { defaultCommand: "npm run check.types" } },
        },
      }),
    );
  });

  it("renders the declared English extension metadata when the interface locale changes", async () => {
    setFrontendLocale(FrontendLocales.EnUs);
    const systemConfig = createSystemConfig({
      systemExtensions: [
        {
          id: "execution",
          version: "1.0.0",
          displayName: { "zh-CN": "命令执行", "en-US": "Shell Commands" },
          description: {
            "zh-CN": "在受控执行环境中运行命令。",
            "en-US": "Runs commands in a controlled execution environment.",
          },
          enabled: true,
          configured: false,
          tools: [],
          skillCount: 0,
          mcpServerCount: 0,
        },
      ],
    });

    renderWithFrontendProviders(
      React.createElement(SettingsWorkbench, {
        ...baseProps,
        section: "system-tools",
        systemConfig,
      }),
    );

    expect(await screen.findAllByText("Shell Commands")).toHaveLength(2);
    expect(await screen.findByText("Runs commands in a controlled execution environment.")).toBeInTheDocument();
  });
});

function createSystemConfig(overrides = {}) {
  return {
    socketStatus: "open",
    configOperation: null,
    configSnapshot: {
      path: "test",
      version: 1,
      revision: 1,
      value: {},
      source: "sqlite",
      diagnostics: [],
      form: {
        version: 1,
        sections: [{ name: "runtime", label: "运行", keyCount: 0, fields: [] }],
      },
    },
    refreshConfig: vi.fn(),
    saveConfig: vi.fn(() => "save-1"),
    systemTools: [],
    systemExtensions: [],
    mcpServers: [],
    mcpInputOperation: null,
    toolSettingsSynced: { systemTools: true, mcpServers: true },
    refreshToolSettings: vi.fn(() => true),
    updateMcpInputs: vi.fn(() => "mcp-save-1"),
    restartMcpServer: vi.fn(() => true),
    ...overrides,
  };
}
