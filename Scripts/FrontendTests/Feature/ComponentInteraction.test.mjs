import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ApprovalRequestStrip } from "../../../Frontend/src/features/chat/ApprovalRequestStrip.tsx";
import { EmptyChatState } from "../../../Frontend/src/features/chat/EmptyChatState.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("approval strip resolves the selected pending tool approval", async () => {
  const onResolve = vi.fn();
  render(React.createElement(ApprovalRequestStrip, {
    approvals: [{
      approvalId: "approval_shell",
      status: "pending",
      title: "需要确认",
      reason: "ShellCommandTool 需要执行本地命令",
      rule: "high-impact",
      riskSignals: ["local", "workspace-write"],
      toolName: "ShellCommandTool",
      createdAt: "2026-07-09T00:00:00.000Z",
      arguments: {
        command: "npm run build",
      },
    }],
    onResolve,
  }));

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "批准工具调用" }));

  expect(onResolve).toHaveBeenCalledWith("approval_shell", "approved");
  expect(screen.getByRole("button", { name: "批准工具调用" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "拒绝工具调用" })).toBeDisabled();
});

test("empty chat suggestions behave as real user actions", async () => {
  globalThis.__SENERA_EMPTY_SUGGESTIONS__ = "整理日志|检查项目";
  const onSelectSuggestion = vi.fn();

  render(React.createElement(EmptyChatState, {
    onSelectSuggestion,
  }));

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "整理日志" }));

  expect(onSelectSuggestion).toHaveBeenCalledWith("整理日志");
});
