import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ApprovalRequestStrip } from "../../../Frontend/src/features/chat/ApprovalRequestStrip.tsx";
import { ChatHeader } from "../../../Frontend/src/features/chat/ChatHeader.tsx";
import { EmptyChatState } from "../../../Frontend/src/features/chat/EmptyChatState.tsx";
import { readCodeArtifact } from "../../../Frontend/src/shared/code/CodeArtifactModel.ts";
import { CodeArtifactSourceView } from "../../../Frontend/src/shared/code/CodeArtifactSourceView.tsx";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";

globalThis.__SENERA_EMPTY_SUGGESTIONS__ = "整理日志|检查项目";
globalThis.window.__SENERA_RUNTIME_CONFIG__ = {};

test("chat header and empty state render stable first-screen copy", () => {
  const header = renderToStaticMarkup(
    withUiProviders(
      React.createElement(ChatHeader, {
        title: "会话标题",
        runStatus: "failed",
      }),
    ),
  );
  const empty = renderToStaticMarkup(
    React.createElement(EmptyChatState, {
      onSelectSuggestion: () => undefined,
    }),
  );

  expect(header).toMatch(/会话标题/);
  expect(header).toMatch(/失败/);
  expect(empty).toMatch(/今天想做点什么/);
  expect(empty).toMatch(/整理日志/);
});

test("approval strip SSR smoke covers pending action controls", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ApprovalRequestStrip, {
      approvals: [
        {
          approvalId: "approval_pending",
          status: "pending",
          title: "需要确认",
          reason: "工具需要审批",
          rule: "high-impact",
          riskSignals: ["workspace-write", "shell"],
          availableDecisions: ["approve_once", "deny", "deny_and_interrupt"],
          approvalKind: "tool_call",
          createdAt: "2026-07-09T00:00:00.000Z",
          subject: {
            kind: "tool_call",
            toolName: "ShellCommandTool",
            arguments: {
              command: "pnpm run build",
            },
          },
        },
      ],
      onResolve: () => undefined,
    }),
  );

  expect(markup).toMatch(/ShellCommandTool/);
  expect(markup).toMatch(/等待审批/);
  expect(markup).toMatch(/拒绝/);
  expect(markup).toMatch(/通过/);
});

test("code artifact source SSR smoke covers source and preview metadata", () => {
  const artifact = readCodeArtifact("html", "<main><h1>Hello</h1></main>");
  const markup = renderToStaticMarkup(
    React.createElement(CodeArtifactSourceView, {
      code: artifact.code,
      language: artifact.language,
    }),
  );

  expect(artifact.filename).toBe("snippet.html");
  expect(artifact.preview?.id).toBe("html-document");
  expect(artifact.preview.source).toMatch(/<main>/);
  expect(markup).toMatch(/data-language="html"/);
  expect(markup).toMatch(/Hello/);
});

function withUiProviders(element) {
  return React.createElement(
    TooltipProvider,
    {
      delayDuration: 0,
    },
    element,
  );
}
