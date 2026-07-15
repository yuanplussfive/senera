import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { ApprovalRequestStrip } from "../../../Frontend/src/features/chat/ApprovalRequestStrip.tsx";
import {
  formatModelProviderName,
  readChatModelProviders,
  readSelectedModelProvider,
} from "../../../Frontend/src/features/chat/modelProvider.ts";
import {
  readRunDisplayName,
  readRunDisplayIcon,
  readAssistantDisplayContent,
  readAssistantDisplayIcon,
  readAssistantDisplayName,
} from "../../../Frontend/src/features/chat/messagePresentation.ts";
import {
  readRunStatusLabel,
  readStepAccent,
  readStepKindLabel,
  readStepStatusLabel,
  readStepStatusTone,
} from "../../../Frontend/src/features/workflow/stepPresentation.ts";
import { shouldLoadWorkflowCanvas } from "../../../Frontend/src/features/workflow/canvasLoadPolicy.ts";
import { summarizeRun } from "../../../Frontend/src/features/workflow/runSummary.ts";

test("chat model provider helpers select chat-capable models and readable labels", () => {
  const models = [
    model("rerank", false, false),
    model("chat-default", true, true),
    model("chat-selected", true, false),
  ];

  expect(readChatModelProviders(models).map((item) => item.id)).toEqual(["chat-default", "chat-selected"]);
  expect(readSelectedModelProvider(models, "chat-selected")?.id).toBe("chat-selected");
  expect(readSelectedModelProvider(models, "missing")?.id).toBe("chat-default");
  expect(formatModelProviderName(models[1])).toBe("chat-default-model");
  expect(formatModelProviderName(undefined)).toBe("AI 助手");
});

test("workflow presentation maps run and step state without UI imports from store projectors", () => {
  expect(readStepKindLabel("tool")).toBe("工具");
  expect(readStepStatusLabel("running")).toBe("进行中");
  expect(readStepStatusTone("failed")).toBe("warn");
  expect(readStepAccent({ kind: "tool", status: "running" })).toEqual({
    border: "border-umber-200/60",
    iconBg: "bg-umber-50",
    iconFg: "text-umber-500",
  });
  expect(readRunStatusLabel("cancelled")).toBe("已取消");

  const run = createRun();
  const summary = summarizeRun(run);
  expect({
    total: summary.total,
    completed: summary.completed,
    failed: summary.failed,
    running: summary.running,
    tools: summary.tools,
  }).toEqual({
    total: 3,
    completed: 1,
    failed: 1,
    running: 1,
    tools: 2,
  });
  expect(shouldLoadWorkflowCanvas(run)).toBe(true);
  expect(shouldLoadWorkflowCanvas(undefined)).toBe(false);
});

test("approval strip renders pending approvals and hides resolved approvals in SSR", () => {
  const calls = [];
  const markup = renderToStaticMarkup(
    React.createElement(ApprovalRequestStrip, {
      approvals: [approval("approval_pending", "pending"), approval("approval_done", "approved")],
      onResolve: (approvalId, status) => calls.push([approvalId, status]),
    }),
  );

  expect(markup).toMatch(/ShellCommandTool/);
  expect(markup).toMatch(/等待审批/);
  expect(markup).toMatch(/command=pnpm run build/);
  expect(markup).not.toMatch(/approval_done/);
  expect(calls).toEqual([]);
});

test("message presentation preserves assistant content and run provider labels", () => {
  const message = {
    content: "最终回复",
    kind: "AssistantFinal",
    requestId: "request_a",
  };
  const run = {
    requestId: "request_a",
    visibleText: "运行态文本",
    displayText: "展示文本",
    modelProvider: {
      id: "provider",
      kind: "OpenAICompatible",
      endpoint: "ChatCompletions",
      baseUrl: "https://example.invalid/v1",
      model: "gpt-test",
    },
  };

  expect(readAssistantDisplayContent(message, run)).toBe("最终回复");
  expect(readRunDisplayName(run)).toBe("gpt-test");
  expect(
    readAssistantDisplayName(
      { metadata: { run: { modelProvider: run.modelProvider } } },
      model("currently-selected", true, false),
    ),
  ).toBe("gpt-test");
  expect(readAssistantDisplayIcon(message, { ...run.modelProvider, capabilities: { Chat: true }, isDefault: false })).toBe(
    "openai",
  );
  expect(readRunDisplayIcon(run)).toBe("openai");
  expect(
    readRunDisplayIcon({
      modelProvider: {
        ...run.modelProvider,
        id: "provider-deepseek",
        model: "deepseek-v4-flash",
      },
    }),
  ).toBe("deepseek");
});

function model(id, chat, isDefault) {
  return {
    id,
    icon: "",
    capabilities: { Chat: chat },
    kind: "OpenAICompatible",
    endpoint: "ChatCompletions",
    baseUrl: "https://example.invalid/v1",
    model: `${id}-model`,
    isDefault,
  };
}

function createRun() {
  return {
    requestId: "request_a",
    revision: 1,
    startedAt: "2026-07-09T00:00:00.000Z",
    endedAt: "2026-07-09T00:00:03.000Z",
    status: "failed",
    input: "查天气",
    steps: [
      {
        id: "tool_a",
        kind: "tool",
        title: "WeatherTool",
        status: "done",
        startedAt: "2026-07-09T00:00:00.000Z",
        toolName: "WeatherTool",
      },
      {
        id: "tool_b",
        kind: "tool",
        title: "ShellCommandTool",
        status: "failed",
        startedAt: "2026-07-09T00:00:01.000Z",
        toolName: "ShellCommandTool",
      },
      {
        id: "answer",
        kind: "answer",
        title: "回复",
        status: "running",
        startedAt: "2026-07-09T00:00:02.000Z",
      },
    ],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    pendingToolArgsByName: {},
  };
}

function approval(approvalId, status) {
  return {
    approvalId,
    status,
    title: "需要确认",
    reason: `${EventKinds.ApprovalRequested}: 工具需要审批`,
    rule: "high-impact",
    riskSignals: ["workspace-write", "shell"],
    approvalKind: "tool_call",
    createdAt: "2026-07-09T00:00:00.000Z",
    subject: {
      kind: "tool_call",
      toolName: "ShellCommandTool",
      arguments: {
        command: "pnpm run build",
        cwd: "E:/senera",
      },
    },
  };
}
