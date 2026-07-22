import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ApprovalRequestStrip } from "../../../Frontend/src/features/chat/ApprovalRequestStrip.tsx";
import { EmptyChatState } from "../../../Frontend/src/features/chat/EmptyChatState.tsx";
import { InteractionInputStrip } from "../../../Frontend/src/features/chat/InteractionInputStrip.tsx";
import { LogoMark } from "../../../Frontend/src/shared/ui/Logo.tsx";

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock("../../../Frontend/src/app/desktopBridge.ts", () => ({ openExternalUrl }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  openExternalUrl.mockReset();
});

test("approval strip resolves the selected pending tool approval", async () => {
  const onResolve = vi.fn();
  render(
    React.createElement(ApprovalRequestStrip, {
      approvals: [
        {
          approvalId: "approval_shell",
          status: "pending",
          title: "需要确认",
          reason: "ShellCommandTool 需要执行本地命令",
          rule: "high-impact",
          riskSignals: ["local", "workspace-write"],
          availableDecisions: ["approve_once", "deny", "deny_and_interrupt"],
          approvalKind: "tool_call",
          createdAt: "2026-07-09T00:00:00.000Z",
          subject: {
            kind: "tool_call",
            toolName: "ShellCommandTool",
            arguments: {
              command: "npm run build",
            },
          },
        },
      ],
      onResolve,
    }),
  );

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "通过" }));

  expect(onResolve).toHaveBeenCalledWith("approval_shell", "approve_once");
});

test("tool approval exposes the selected local execution plan", async () => {
  const onResolve = vi.fn();
  render(
    React.createElement(ApprovalRequestStrip, {
      approvals: [
        {
          approvalId: "approval_local",
          approvalKind: "tool_call",
          status: "pending",
          title: "允许工具调用：SearchTool",
          reason: "本机执行需要确认",
          rule: "execution.target.local",
          riskSignals: ["plugin.trustLevel:External"],
          availableDecisions: ["approve_once", "deny", "deny_and_interrupt"],
          createdAt: "2026-07-09T00:00:00.000Z",
          subject: {
            kind: "tool_call",
            toolName: "SearchTool",
            arguments: { query: "Senera" },
            execution: {
              target: "Local",
              backend: "local",
              network: "default",
              workspaceMount: "readonly",
              availableTargets: ["Sandbox", "Local"],
            },
          },
        },
      ],
      onResolve,
    }),
  );

  expect(screen.getByText("本机执行")).toBeInTheDocument();
  expect(screen.getByText("允许网络")).toBeInTheDocument();
  expect(screen.getByText("工作区只读")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "通过" }));

  expect(onResolve).toHaveBeenCalledWith("approval_local", "approve_once");
});

test("empty chat suggestions behave as real user actions", async () => {
  globalThis.__SENERA_EMPTY_SUGGESTIONS__ = "整理日志|检查项目";
  const onSelectSuggestion = vi.fn();

  render(
    React.createElement(EmptyChatState, {
      onSelectSuggestion,
    }),
  );

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "整理日志" }));

  expect(onSelectSuggestion).toHaveBeenCalledWith("整理日志");
});

test("logo mark uses a document-relative asset path for packaged desktop windows", () => {
  const { container } = render(React.createElement(LogoMark));

  expect(container.querySelector("img")).toHaveAttribute("src", "./favicon.svg");
});

test("interaction form collects schema-driven values for the suspended tool call", async () => {
  const onResolve = vi.fn();
  render(
    React.createElement(InteractionInputStrip, {
      interactions: [
        {
          interactionId: "interaction_deploy",
          mode: "form",
          status: "pending",
          message: "选择部署配置",
          toolName: "DeployTool",
          toolCallId: "call_deploy",
          createdAt: "2026-07-17T00:00:00.000Z",
          schema: {
            type: "object",
            properties: {
              environment: { type: "string", title: "环境", enum: ["staging", "production"] },
              replicas: { type: "integer", title: "副本", minimum: 1, maximum: 5 },
              confirm: { type: "boolean", title: "确认" },
            },
            required: ["environment", "replicas"],
          },
        },
      ],
      onResolve,
    }),
  );
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText(/环境/), "production");
  await user.type(screen.getByLabelText(/副本/), "3");
  await user.click(screen.getByLabelText("确认"));
  await user.click(screen.getByRole("button", { name: "提交" }));

  expect(onResolve).toHaveBeenCalledWith("interaction_deploy", "accept", {
    environment: "production",
    replicas: 3,
    confirm: true,
  });
});

test("interaction form blocks invalid required values and supports explicit decline", async () => {
  const onResolve = vi.fn();
  render(
    React.createElement(InteractionInputStrip, {
      interactions: [
        {
          interactionId: "interaction_required",
          mode: "form",
          status: "pending",
          message: "填写名称",
          toolName: "FormTool",
          toolCallId: "call_form",
          createdAt: "2026-07-17T00:00:00.000Z",
          schema: {
            type: "object",
            properties: { name: { type: "string", title: "名称", minLength: 2 } },
            required: ["name"],
          },
        },
      ],
      onResolve,
    }),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "提交" }));
  expect(screen.getByText("此项为必填项")).toBeInTheDocument();
  expect(onResolve).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "拒绝" }));
  expect(onResolve).toHaveBeenCalledWith("interaction_required", "decline");
});

test("URL interaction opens only after consent and then waits for MCP completion", async () => {
  openExternalUrl.mockResolvedValue("web");
  const onResolve = vi.fn();
  const interaction = {
    interactionId: "interaction_oauth",
    mode: "url",
    externalId: "oauth-login",
    url: "https://accounts.example.com/oauth/authorize",
    hostname: "accounts.example.com",
    status: "pending",
    message: "登录后继续",
    toolName: "OAuthTool",
    toolCallId: "call_oauth",
    createdAt: "2026-07-17T00:00:00.000Z",
  };
  const { rerender } = render(React.createElement(InteractionInputStrip, { interactions: [interaction], onResolve }));
  const user = userEvent.setup();

  expect(screen.getByText("accounts.example.com")).toBeInTheDocument();
  expect(openExternalUrl).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "打开安全链接" }));

  expect(openExternalUrl).toHaveBeenCalledWith(interaction.url);
  expect(onResolve).toHaveBeenCalledWith("interaction_oauth", "accept");

  rerender(
    React.createElement(InteractionInputStrip, {
      interactions: [{ ...interaction, status: "external_pending", action: "accept" }],
      onResolve,
    }),
  );
  expect(screen.getByText("等待服务确认完成")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "打开安全链接" })).not.toBeInTheDocument();
});
