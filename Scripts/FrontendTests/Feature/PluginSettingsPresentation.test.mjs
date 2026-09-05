import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpServersSection } from "../../../Frontend/src/features/settings/sections/McpServersSection.tsx";
import { SystemToolsSection } from "../../../Frontend/src/features/settings/sections/SystemToolsSection.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

afterEach(() => cleanup());

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
});
