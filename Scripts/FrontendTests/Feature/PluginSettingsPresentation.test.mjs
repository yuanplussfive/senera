import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpServersSection } from "../../../Frontend/src/features/settings/sections/McpServersSection.tsx";
import { PluginsSection } from "../../../Frontend/src/features/settings/sections/PluginsSection.tsx";
import { SystemToolsSection } from "../../../Frontend/src/features/settings/sections/SystemToolsSection.tsx";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const ExploreDomain = {
  id: "explore",
  displayName: { "zh-CN": "探索与检索", "en-US": "Explore and Retrieve" },
  description: { "zh-CN": "读取工作区和外部资源。", "en-US": "Read workspace and external resources." },
  presentation: {
    category: "explore",
    icon: "search",
    group: { id: "explore", title: { "zh-CN": "探索资源", "en-US": "Explore resources" } },
    activity: { action: { "zh-CN": "探索", "en-US": "Explore" } },
  },
};

const ExecuteDomain = {
  id: "execute",
  displayName: { "zh-CN": "执行与交互", "en-US": "Execute and Interact" },
  description: { "zh-CN": "运行受控命令。", "en-US": "Run governed commands." },
  presentation: {
    category: "execute",
    icon: "terminal",
    group: { id: "execute", title: { "zh-CN": "执行任务", "en-US": "Run tasks" } },
    activity: { action: { "zh-CN": "执行", "en-US": "Run" } },
  },
};

const McpSecretDebounceMs = 350;

afterEach(() => cleanup());

function createImagenMcpServer() {
  return {
    id: "imagen",
    packageName: "@senera/imagen-mcp",
    displayName: { "zh-CN": "Imagen", "en-US": "Imagen" },
    description: { "zh-CN": "图像生成服务。", "en-US": "Image generation service." },
    source: "bundled",
    descriptorKind: "mcpb",
    transport: "http",
    status: "configured",
    enabled: true,
    inputs: [
      {
        id: "IMAGEN_API_KEY",
        title: "Imagen API Key",
        description: "用于请求图像生成服务。",
        type: "string",
        required: true,
        secret: true,
        multiple: false,
        configured: true,
        stored: true,
        source: "vault",
        provenance: "mcpb",
        updatedAt: "2026-08-18T00:00:00.000Z",
      },
    ],
  };
}

function createMcpSectionSystemConfig(overrides = {}) {
  return {
    socketStatus: "open",
    mcpServers: [createImagenMcpServer()],
    toolSettingsSynced: { systemTools: true, mcpServers: true },
    mcpInputOperation: null,
    refreshToolSettings: vi.fn(),
    restartMcpServer: vi.fn(() => true),
    updateMcpInputs: vi.fn(() => "request-1"),
    ...overrides,
  };
}

describe("plugin settings presentation", () => {
  it("uses declared package identity marks and a stable default without inferring MCP transport icons", async () => {
    const user = userEvent.setup();
    const updateDraft = vi.fn();
    const { container } = renderWithFrontendProviders(
      React.createElement(PluginsSection, {
        draftState: {
          draft: {},
          saving: false,
          localError: null,
          flushSave: vi.fn(),
          updateDraft,
        },
        systemConfig: {
          socketStatus: "open",
          configSnapshot: null,
          systemExtensions: [
            {
              id: "git",
              settingsSurface: "system-tools",
              domain: ExecuteDomain,
              version: "1.0.0",
              displayName: { "zh-CN": "Git 版本控制", "en-US": "Git Version Control" },
              description: { "zh-CN": "管理当前仓库。", "en-US": "Manage the current repository." },
              presentation: {
                category: "version-control",
                icon: "git-branch",
                brandIcon: "git",
                group: { id: "version-control", title: { "zh-CN": "版本控制", "en-US": "Version control" } },
                activity: { action: { "zh-CN": "使用 Git", "en-US": "Use Git" } },
              },
              enabled: true,
              configured: false,
              tools: [],
              skillCount: 0,
              mcpServerCount: 0,
            },
          ],
          mcpServers: [createImagenMcpServer()],
          toolSettingsSynced: { systemTools: true, mcpServers: true },
          mcpInputOperation: null,
          refreshConfig: vi.fn(),
          refreshToolSettings: vi.fn(),
          restartMcpServer: vi.fn(() => true),
          updateMcpInputs: vi.fn(),
        },
      }),
    );

    expect(container.querySelector('[data-plugin-brand-icon="git"]')).toBeInTheDocument();
    expect(container.querySelector('[data-plugin-fallback-icon="server"]')).toBeInTheDocument();
    expect(container.querySelectorAll("[data-plugin-directory-item]")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "全部 2" })).toBeVisible();
    await user.click(screen.getByRole("switch", { name: "启用或停用 Imagen" }));
    expect(updateDraft).toHaveBeenCalledWith({ McpServers: { imagen: { Enabled: false } } }, "immediate");
    await user.click(screen.getByText("Imagen"));
    expect(container.querySelector("[data-plugin-detail-page]")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "启用或停用 Imagen" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "返回插件目录" }));
    await user.click(screen.getByRole("switch", { name: "启用或停用 Git 版本控制" }));
    expect(updateDraft).toHaveBeenCalledWith({ Extensions: { git: { Enabled: false } } }, "immediate");
    expect(container.querySelector("[data-plugin-detail-page]")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "系统扩展 1" }));
    expect(container.querySelectorAll("[data-plugin-directory-item]")).toHaveLength(1);
    await user.click(screen.getByText("Git 版本控制"));
    expect(container.querySelector("[data-plugin-detail-page]")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回插件目录" }));
    expect(container.querySelector("[data-plugins-directory]")).toBeInTheDocument();
  });

  it("locks an MCP activation switch until its required configuration is complete", () => {
    const server = {
      ...createImagenMcpServer(),
      id: "weather",
      status: "needs_input",
      enabled: false,
      inputs: [
        {
          ...createImagenMcpServer().inputs[0],
          id: "WEATHER_API_KEY",
          configured: false,
          stored: false,
          source: "missing",
        },
      ],
    };
    renderWithFrontendProviders(
      React.createElement(PluginsSection, {
        draftState: {
          // A stored activation preference must not make an incomplete MCP
          // appear usable. Its input state is the authoritative readiness gate.
          draft: { McpServers: { weather: { Enabled: true } } },
          saving: false,
          localError: null,
          flushSave: vi.fn(),
          updateDraft: vi.fn(),
        },
        systemConfig: {
          socketStatus: "open",
          configSnapshot: null,
          systemExtensions: [],
          mcpServers: [server],
          toolSettingsSynced: { systemTools: true, mcpServers: true },
          mcpInputOperation: null,
          refreshConfig: vi.fn(),
          refreshToolSettings: vi.fn(),
          restartMcpServer: vi.fn(() => true),
          updateMcpInputs: vi.fn(),
        },
      }),
    );

    const activationSwitch = screen.getByRole("switch", { name: "启用或停用 Imagen" });
    expect(activationSwitch).toBeDisabled();
    expect(activationSwitch).not.toBeChecked();
  });

  it("keeps system extension internals out of the default tool directory", async () => {
    const user = userEvent.setup();
    const { container } = renderWithFrontendProviders(
      React.createElement(SystemToolsSection, {
        draftState: {
          draft: {},
          saving: false,
          localError: null,
          flushSave: vi.fn(),
          updateDraft: vi.fn(),
        },
        systemConfig: {
          socketStatus: "open",
          configSnapshot: null,
          systemExtensions: [
            {
              id: "workspace-tools",
              settingsSurface: "system-tools",
              domain: ExploreDomain,
              version: "1.0.0",
              displayName: { "zh-CN": "工作区工具", "en-US": "Workspace tools" },
              description: { "zh-CN": "读取、搜索和浏览当前工作区。", "en-US": "Read and search the workspace." },
              presentation: {
                category: "workspace",
                icon: "file-text",
                group: { id: "workspace", title: { "zh-CN": "浏览工作区", "en-US": "Explore workspace" } },
                activity: { action: { "zh-CN": "浏览", "en-US": "Explore" } },
              },
              enabled: true,
              configured: false,
              tools: [
                {
                  name: "WorkspaceRead",
                  description: "读取工作区内的文本文件。",
                  loading: "eager",
                  capability: "system.tool.workspace-tools.WorkspaceRead",
                  presentation: {
                    category: "workspace-read",
                    icon: "file-text",
                    group: { id: "workspace", title: { "zh-CN": "浏览工作区", "en-US": "Explore workspace" } },
                    activity: { action: { "zh-CN": "读取文件", "en-US": "Read" } },
                  },
                },
              ],
              skillCount: 0,
              mcpServerCount: 0,
            },
            {
              id: "shell",
              settingsSurface: "system-tools",
              domain: ExecuteDomain,
              version: "1.0.0",
              displayName: { "zh-CN": "命令执行", "en-US": "Shell Commands" },
              description: { "zh-CN": "在受控环境中运行命令。", "en-US": "Run commands in a governed environment." },
              presentation: ExecuteDomain.presentation,
              enabled: true,
              configured: false,
              tools: [],
              skillCount: 0,
              mcpServerCount: 0,
            },
          ],
          toolSettingsSynced: { systemTools: true, mcpServers: true },
          refreshConfig: vi.fn(),
          refreshToolSettings: vi.fn(),
        },
      }),
    );

    expect(screen.getAllByText("工作区工具")).toHaveLength(1);
    expect(container.querySelector("[data-system-extension-directory]")).toBeInTheDocument();
    expect(
      [...container.querySelectorAll("[data-settings-entity-group]")].map(
        (element) => element.dataset.settingsEntityGroup,
      ),
    ).toEqual(["execute", "explore"]);
    expect(container.querySelector("[data-settings-entity-group='explore']")).toHaveTextContent("探索与检索");
    expect(container.querySelector("[data-system-extension-tools]")).not.toBeInTheDocument();
    expect(container.querySelector("[data-extension-preview]")).toHaveTextContent("无需配置");
    expect(container.querySelector("[data-settings-state='on']")).toHaveTextContent("ON");
    await user.click(screen.getByRole("button", { name: "管理扩展开关" }));
    const extensionManager = screen.getByRole("dialog", { name: "管理扩展开关" });
    expect(extensionManager).toHaveAttribute("data-extension-bulk-manager");
    expect(extensionManager.querySelector("[data-extension-bulk-scroll-region]")).toHaveClass("min-h-0", "flex-1");
    await user.keyboard("{Escape}");
    await user.click(screen.getByText("工作区工具"));
    await waitFor(() => expect(container.querySelector("[data-system-extension-tools]")).toBeInTheDocument());
    expect(screen.getByText("WorkspaceRead")).toBeVisible();
    expect(container.querySelector('[data-system-extension-tool-icon="file-text"]')).toBeInTheDocument();
    expect(screen.getByTestId("extension-metrics")).toHaveTextContent("工具");
    await user.click(screen.getByRole("radio", { name: "配置" }));
    expect(screen.getByText("无需配置")).toBeVisible();
    expect(screen.getByText("该扩展没有公开配置字段。")).toBeVisible();
    expect(screen.queryByText("workspace-tools")).not.toBeInTheDocument();
    expect(screen.queryByText("system.tool.workspace-tools.WorkspaceRead")).not.toBeInTheDocument();
  });

  it("keeps MCP configuration focused on user-editable inputs", async () => {
    const user = userEvent.setup();
    const { container } = renderWithFrontendProviders(
      React.createElement(McpServersSection, {
        systemConfig: {
          socketStatus: "open",
          mcpServers: [
            {
              id: "imagen",
              packageName: "@senera/imagen-mcp",
              displayName: { "zh-CN": "Imagen", "en-US": "Imagen" },
              description: { "zh-CN": "图像生成服务。", "en-US": "Image generation service." },
              source: "bundled",
              descriptorKind: "mcpb",
              transport: "http",
              status: "configured",
              inputs: [
                {
                  id: "IMAGEN_API_KEY",
                  title: "Imagen API Key",
                  description: "用于请求图像生成服务。",
                  type: "string",
                  required: true,
                  secret: true,
                  multiple: false,
                  configured: true,
                  stored: true,
                  source: "vault",
                  provenance: "mcpb",
                  updatedAt: "2026-08-18T00:00:00.000Z",
                },
              ],
            },
          ],
          toolSettingsSynced: { systemTools: true, mcpServers: true },
          mcpInputOperation: null,
          refreshToolSettings: vi.fn(),
          restartMcpServer: vi.fn(() => true),
          updateMcpInputs: vi.fn(),
        },
      }),
    );

    expect(screen.getAllByText("Imagen")).toHaveLength(1);
    expect(container.querySelector("[data-settings-entity-group='bundled']")).toHaveTextContent("内置");
    expect(container.querySelector("[data-mcp-preview]")).toHaveTextContent("配置 1 项");
    expect(container.querySelector("[data-mcp-status='configured']")).toHaveTextContent("可用");
    expect(screen.queryByText("Imagen API Key")).not.toBeInTheDocument();
    await user.click(screen.getByText("Imagen"));
    expect(
      screen.getAllByText("Imagen API Key").find((element) => !element.classList.contains("sr-only")),
    ).toBeVisible();
    expect(screen.getByText("已保存在 Secret Vault")).toBeVisible();
    expect(screen.getByTestId("mcp-metrics")).toHaveTextContent("来源");
    expect(screen.queryByText("@senera/imagen-mcp")).not.toBeInTheDocument();
    expect(screen.queryByText("IMAGEN_API_KEY")).not.toBeInTheDocument();
    expect(screen.queryByText("2026")).not.toBeInTheDocument();
    expect(screen.queryByText("MCP 修改已自动同步")).not.toBeInTheDocument();
  });

  it("shows the host capabilities that keep an MCP server unavailable", async () => {
    const user = userEvent.setup();
    renderWithFrontendProviders(
      React.createElement(McpServersSection, {
        systemConfig: {
          socketStatus: "open",
          mcpServers: [
            {
              id: "zavora-computer-use",
              packageName: "zavora-computer-use",
              displayName: { "zh-CN": "Zavora 桌面控制", "en-US": "Zavora Computer Use" },
              description: { "zh-CN": "桌面控制服务。", "en-US": "Desktop control service." },
              source: "bundled",
              descriptorKind: "mcpb",
              transport: "stdio",
              status: "unavailable",
              unavailableCapabilityDetails: [
                {
                  id: "interactive-desktop",
                  reason: "Linux requires DISPLAY or WAYLAND_DISPLAY for local desktop control.",
                },
              ],
              inputs: [],
            },
          ],
          toolSettingsSynced: { systemTools: true, mcpServers: true },
          mcpInputOperation: null,
          refreshToolSettings: vi.fn(),
          restartMcpServer: vi.fn(() => true),
          updateMcpInputs: vi.fn(),
        },
      }),
    );

    await user.click(screen.getByText("Zavora 桌面控制"));
    expect(screen.getByText("缺少的宿主能力")).toBeVisible();
    expect(screen.getByText("interactive-desktop")).toBeVisible();
    expect(screen.getByText("Linux requires DISPLAY or WAYLAND_DISPLAY for local desktop control.")).toBeVisible();
  });

  it("commits MCP secrets on blur instead of auto-saving keystrokes", async () => {
    const user = userEvent.setup();
    const updateMcpInputs = vi.fn(() => "request-1");
    renderWithFrontendProviders(
      React.createElement(McpServersSection, {
        systemConfig: createMcpSectionSystemConfig({ updateMcpInputs }),
      }),
    );

    await user.click(screen.getByText("Imagen"));
    const secretField = screen.getByLabelText("Imagen API Key");
    expect(secretField).toHaveAttribute("type", "password");
    expect(secretField).toHaveAttribute("placeholder", "输入新 Secret 以替换");

    await user.type(secretField, "sk-live-key");
    // Keystrokes alone must not write a partial secret to the vault.
    await new Promise((resolve) => setTimeout(resolve, McpSecretDebounceMs + 200));
    expect(updateMcpInputs).not.toHaveBeenCalled();

    await user.tab();
    expect(updateMcpInputs).toHaveBeenCalledTimes(1);
    expect(updateMcpInputs).toHaveBeenCalledWith("imagen", { IMAGEN_API_KEY: "sk-live-key" }, []);
    // The committed value stays in the field instead of blanking it.
    expect(secretField).toHaveValue("sk-live-key");
    expect(secretField).toHaveAttribute("type", "password");
  });

  it("keeps an MCP mutation pending until its authoritative snapshot arrives", async () => {
    const user = userEvent.setup();
    const updateMcpInputs = vi.fn(() => "request-pending");
    const view = renderWithFrontendProviders(
      React.createElement(McpServersSection, {
        systemConfig: createMcpSectionSystemConfig({ updateMcpInputs }),
      }),
    );

    await user.click(screen.getByText("Imagen"));
    const secretField = screen.getByLabelText("Imagen API Key");
    await user.type(secretField, "sk-pending-key");
    await user.tab();

    view.rerender(
      React.createElement(
        TooltipProvider,
        { delayDuration: 0 },
        React.createElement(McpServersSection, {
          systemConfig: createMcpSectionSystemConfig({
            updateMcpInputs,
            mcpInputOperation: { requestId: "request-pending", status: "pending" },
          }),
        }),
      ),
    );
    expect(screen.queryByText("MCP 修改同步失败。")).not.toBeInTheDocument();

    view.rerender(
      React.createElement(
        TooltipProvider,
        { delayDuration: 0 },
        React.createElement(McpServersSection, {
          systemConfig: createMcpSectionSystemConfig({
            updateMcpInputs,
            mcpInputOperation: { requestId: "request-pending", status: "success" },
          }),
        }),
      ),
    );
    expect(screen.queryByText("MCP 修改同步失败。")).not.toBeInTheDocument();
  });

  it("reveals the secret through the eye toggle without committing", async () => {
    const user = userEvent.setup();
    const updateMcpInputs = vi.fn(() => "request-2");
    renderWithFrontendProviders(
      React.createElement(McpServersSection, {
        systemConfig: createMcpSectionSystemConfig({ updateMcpInputs }),
      }),
    );

    await user.click(screen.getByText("Imagen"));
    const secretField = screen.getByLabelText("Imagen API Key");
    await user.type(secretField, "sk-live-key");
    await user.click(screen.getByRole("button", { name: "显示 Secret" }));
    expect(secretField).toHaveAttribute("type", "text");
    expect(secretField).toHaveValue("sk-live-key");
    // Toggling reveal must not blur the input and trigger a commit.
    expect(updateMcpInputs).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "隐藏 Secret" }));
    expect(secretField).toHaveAttribute("type", "password");
  });

  it("clears a stored secret through the field action", async () => {
    const user = userEvent.setup();
    const updateMcpInputs = vi.fn(() => "request-3");
    renderWithFrontendProviders(
      React.createElement(McpServersSection, {
        systemConfig: createMcpSectionSystemConfig({ updateMcpInputs }),
      }),
    );

    await user.click(screen.getByText("Imagen"));
    await user.click(screen.getByRole("button", { name: "清除已保存的 Secret" }));
    expect(updateMcpInputs).toHaveBeenCalledTimes(1);
    expect(updateMcpInputs).toHaveBeenCalledWith("imagen", {}, ["IMAGEN_API_KEY"]);
  });
});
