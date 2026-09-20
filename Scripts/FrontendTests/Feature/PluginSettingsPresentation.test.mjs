import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpServersSection } from "../../../Frontend/src/features/settings/sections/McpServersSection.tsx";
import { SystemToolsSection } from "../../../Frontend/src/features/settings/sections/SystemToolsSection.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

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
              version: "1.0.0",
              displayName: { "zh-CN": "工作区工具", "en-US": "Workspace tools" },
              description: { "zh-CN": "读取、搜索和浏览当前工作区。", "en-US": "Read and search the workspace." },
              enabled: true,
              configured: false,
              tools: [
                {
                  name: "WorkspaceRead",
                  description: "读取工作区内的文本文件。",
                  loading: "eager",
                  capability: "system.tool.workspace-tools.WorkspaceRead",
                },
              ],
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
    expect(container.querySelector("[data-system-extension-tools]")).not.toBeInTheDocument();
    await user.click(screen.getByText("工作区工具"));
    expect(container.querySelector("[data-system-extension-tools]")).toBeInTheDocument();
    expect(screen.getByText("WorkspaceRead")).toBeVisible();
    expect(screen.queryByText("workspace-tools")).not.toBeInTheDocument();
    expect(screen.queryByText("system.tool.workspace-tools.WorkspaceRead")).not.toBeInTheDocument();
  });

  it("keeps MCP configuration focused on user-editable inputs", async () => {
    const user = userEvent.setup();
    renderWithFrontendProviders(
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
    expect(screen.queryByText("Imagen API Key")).not.toBeInTheDocument();
    await user.click(screen.getByText("Imagen"));
    expect(
      screen.getAllByText("Imagen API Key").find((element) => !element.classList.contains("sr-only")),
    ).toBeVisible();
    expect(screen.getByText("已保存在 Secret Vault")).toBeVisible();
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
              unavailableCapabilities: ["interactive-desktop"],
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
