import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsWorkbench } from "../../../Frontend/src/features/settings/SettingsWorkbench.tsx";
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
    defaultRightPanelCollapsed: false,
  },
  motionLevel: "full",
  onValueChange: vi.fn(),
  onMotionLevelChange: vi.fn(),
};

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  baseProps.onSectionChange.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsWorkbench", () => {
  it("uses grouped navigation without migration cards or persistent sync badges", async () => {
    renderWithFrontendProviders(React.createElement(SettingsWorkbench, baseProps));

    await waitFor(() => expect(screen.getByRole("button", { name: "打开设置导航" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "打开设置导航" }));

    expect(screen.getByRole("dialog", { name: "设置导航" })).toBeInTheDocument();
    for (const label of ["模型", "能力与运行", "个人", "系统"]) {
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
    expect(screen.getByRole("button", { name: /模型服务/ })).toBeInTheDocument();
    expect(screen.queryByText("个人")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /模型服务/ }));
    expect(baseProps.onSectionChange).toHaveBeenCalledWith("model-service");
  });

  it("autosaves main configuration changes without a save-button click", async () => {
    const saveConfig = vi.fn(() => "config-request");
    const systemConfig = {
      configSnapshot: {
        path: "Config.toml",
        version: 1,
        value: { DisplayName: "initial" },
        source: "sqlite",
        diagnostics: [],
        form: {
          version: 1,
          sections: [
            {
              name: "system",
              label: "系统",
              keyCount: 1,
              fields: [
                {
                  section: "system",
                  key: "DisplayName",
                  path: ["DisplayName"],
                  label: "显示名称",
                  type: "string",
                  value: "initial",
                  effectiveValue: "initial",
                  configured: true,
                },
              ],
            },
          ],
        },
      },
      configOperation: null,
      refreshConfig: vi.fn(),
      saveConfig,
    };

    renderWithFrontendProviders(
      React.createElement(SettingsWorkbench, { ...baseProps, section: "system", systemConfig }),
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "changed" } });
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({ DisplayName: "changed" }));
  });
});
