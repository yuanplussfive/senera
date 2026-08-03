import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsWorkbench } from "../../../Frontend/src/features/settings/SettingsWorkbench.tsx";
import { FrontendLocales } from "../../../Frontend/src/i18n/frontendLocaleModel.ts";
import { setFrontendLocale } from "../../../Frontend/src/i18n/frontendLocaleStore.ts";
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
    renderWithFrontendProviders(React.createElement(SettingsWorkbench, baseProps));

    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("uses grouped navigation without migration cards or persistent sync badges", async () => {
    renderWithFrontendProviders(React.createElement(SettingsWorkbench, baseProps));

    await waitFor(() => expect(screen.getByRole("button", { name: "打开设置导航" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "打开设置导航" }));

    expect(screen.getByRole("dialog", { name: "设置导航" })).toBeInTheDocument();
    for (const label of ["模型", "能力与运行", "工具", "个人", "系统"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
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

  it("submits typed MCP inputs without retaining a Secret in the input", () => {
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

    const input = screen.getByLabelText("Tavily API key");
    fireEvent.change(input, { target: { value: "secret-value" } });
    fireEvent.click(screen.getByRole("button", { name: "保存全部更改" }));

    expect(systemConfig.updateMcpInputs).toHaveBeenCalledWith("web-research", { TAVILY_API_KEY: "secret-value" }, []);
    expect(input).toHaveValue("");
    expect(screen.queryByDisplayValue("secret-value")).not.toBeInTheDocument();
  });

  it("submits multiple MCP choices as a typed array", async () => {
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

    await user.click(screen.getByRole("button", { name: /Regions/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "us" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "eu" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "保存全部更改" }));

    expect(systemConfig.updateMcpInputs).toHaveBeenCalledWith("regional-search", { regions: ["us", "eu"] }, []);
  });

  it("renders System tools as extension packages with one package-level save", () => {
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

    expect(screen.getAllByText("命令执行")).toHaveLength(2);
    expect(screen.getByText("在受控执行环境中运行命令。")).toBeInTheDocument();
    expect(screen.getByText("ShellCommandTool")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "启用或停用 命令执行" }));
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    expect(systemConfig.saveConfig).toHaveBeenCalledWith({ Extensions: { execution: { Enabled: false } } });
  });

  it("renders the declared English extension metadata when the interface locale changes", () => {
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

    expect(screen.getAllByText("Shell Commands")).toHaveLength(2);
    expect(screen.getByText("Runs commands in a controlled execution environment.")).toBeInTheDocument();
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
