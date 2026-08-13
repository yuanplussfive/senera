import React from "react";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveWorkspaceRoot } from "../../../Scripts/WorkspaceRoot.ts";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";

await import("../../../Frontend/src/features/workflow/ToolStepInspector.tsx");
const { AgentExecutionFeed, AgentExecutionStageFeed } =
  await import("../../../Frontend/src/features/workflow/AgentExecutionFeed.tsx");
const { projectToolStagePresentation } =
  await import("../../../Frontend/src/features/workflow/toolStagePresentation.ts");
const { projectToolActivityInspection } =
  await import("../../../Frontend/src/features/workflow/toolActivityPresentation.ts");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { frontendFeatureMessage } = await import("../../../Frontend/src/i18n/frontendFeatureMessageCatalog.ts");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");
const { TooltipProvider } = await import("../../../Frontend/src/shared/ui/Tooltip.tsx");
const { createRun, createStep, createToolBatchRun } = await import("./workflowComponentFixtures.mjs");

beforeEach(() => {
  removeRadixPortalResidue();
  installMemoryLocalStorage();
  resetFrontendStore();
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  removeRadixPortalResidue();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function removeRadixPortalResidue() {
  document
    .querySelectorAll("[data-radix-popper-content-wrapper], [data-radix-focus-guard]")
    .forEach((element) => element.remove());
  document.body.style.pointerEvents = "";
  document.body.style.removeProperty("overflow");
  document.body.removeAttribute("data-scroll-locked");
}

test("execution feed keeps action batches summarized until the user expands them", async () => {
  const user = userEvent.setup();
  const initialRun = createToolBatchRun(["WorkspaceReadFile", "WorkspaceSearchFiles"]);
  initialRun.steps.find((step) => step.toolName === "WorkspaceReadFile").toolArgs = { path: "Source/runtime.ts" };
  initialRun.steps.find((step) => step.toolName === "WorkspaceReadFile").toolResult = {
    content: "export const runtime = true;",
  };
  Object.assign(
    initialRun.steps.find((step) => step.toolName === "WorkspaceReadFile"),
    {
      purpose: "Inspect runtime initialization before changing the workflow.",
      toolPresentation: {
        type: "senera.tool_result_presentation.v1",
        version: 1,
        status: "success",
        headline: "Read Source/runtime.ts",
        facts: [],
        evidence: [],
        changes: [
          {
            kind: "workspace",
            status: "changed",
            key: "Source/runtime.ts",
            summary: "modified: Source/runtime.ts",
            addedLines: 6,
            removedLines: 1,
          },
        ],
      },
    },
  );
  const view = renderWithFrontendProviders(
    React.createElement(
      AppMotionProvider,
      { level: "none" },
      React.createElement(AgentExecutionFeed, { run: initialRun }),
    ),
  );
  const feed = document.querySelector("[data-execution-feed]");
  const group = document.querySelector("[data-feed-group='tools:batch-actions']");

  expect(feed).toBeInTheDocument();
  expect(feed).not.toHaveClass("rounded-xl", "border", "bg-surface-raised", "shadow-panel");
  expect(document.querySelector("[data-execution-rail]")).toBeInTheDocument();
  expect(screen.queryByText("tool_preface")).not.toBeInTheDocument();
  expect(group).toBeInstanceOf(HTMLButtonElement);
  expect(group).toHaveAttribute("aria-expanded", "false");
  expect(document.querySelector("[data-feed-detail-surface]")).not.toBeInTheDocument();
  expect(screen.queryByText("WorkspaceReadFile")).not.toBeInTheDocument();
  expect(screen.queryByText("WorkspaceSearchFiles")).not.toBeInTheDocument();

  await user.click(group);
  await waitFor(() => expect(screen.getByText("读取文件：Source/runtime.ts")).toBeVisible());
  expect(screen.getAllByText("搜索代码 1 次").length).toBeGreaterThan(0);
  expect(group).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelector("[data-feed-detail-surface]")).toHaveClass("border-l", "border-line-subtle", "pl-3");
  expect(document.querySelector("[data-feed-detail-surface]")).not.toHaveClass("rounded-md", "bg-surface-subtle/70");

  const toolToggle = screen.getByRole("button", {
    name: frontendMessage("workflow.dock.expandNode", { title: "读取文件：Source/runtime.ts" }),
  });
  await user.click(toolToggle);
  await waitFor(() => expect(screen.getByText(frontendFeatureMessage("workflow.inspector.purpose"))).toBeVisible());
  const toolDetail = document.querySelector("[data-feed-tool-detail]");
  expect(toolDetail?.closest("[data-radix-popper-content-wrapper]")?.parentElement).toBe(document.body);
  expect(group.contains(toolDetail)).toBe(false);
  expect(toolDetail).toHaveClass("scrollbar-thin");
  expect(toolDetail).toHaveTextContent("Inspect runtime initialization before changing the workflow.");
  expect(toolDetail).toHaveTextContent("Source/runtime.ts");
  expect(document.querySelector("[data-line-change-stats]")).toHaveTextContent("+6");
  expect(document.querySelector("[data-line-change-stats]")).toHaveTextContent("-1");
  expect(screen.queryByText(frontendMessage("workflow.node.section.rawToolResult"))).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: frontendFeatureMessage("workflow.node.technicalDetails") }));
  expect(screen.getByText(frontendMessage("workflow.node.section.toolArgs"))).toBeVisible();
  expect(screen.getByText(frontendMessage("workflow.node.section.rawToolResult"))).toBeVisible();
  expect(document.querySelector("[data-feed-tool-detail]")).toHaveTextContent("export const runtime = true;");

  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        AppMotionProvider,
        { level: "none" },
        React.createElement(AgentExecutionFeed, {
          run: createToolBatchRun(["WorkspaceReadFile", "WorkspaceSearchFiles", "WorkspaceListDirectory"]),
        }),
      ),
    ),
  );
  expect(screen.getAllByText("读取 1 个目录").length).toBeGreaterThan(0);
  expect(document.querySelector("[data-feed-group='tools:batch-actions']")).toHaveAttribute("aria-expanded", "true");
});

test("conversation tool stages keep details in the workflow dock", () => {
  const run = createToolBatchRun(["ExecutionResourceWait", "ExecutionResourceWait"]);

  expect(projectToolStagePresentation(run)).toMatchObject({
    category: "background-wait",
    mode: "semantic-batch",
    status: "done",
    title: "等待后台任务 2 次",
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(screen.getByRole("status", { name: "等待后台任务 2 次" })).toBeVisible();
  expect(screen.queryByText("ExecutionResourceWait")).not.toBeInTheDocument();
  expect(screen.queryByText(/并发工具批次/)).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-stage-details]")).not.toBeInTheDocument();
});

test("conversation tool stages prioritize intent and keep actions as a compact result", () => {
  const run = createToolBatchRun(["WorkspaceRead", "WorkspaceGrep", "WorkspaceList"]);
  run.steps
    .filter((step) => step.toolName)
    .forEach((step) => {
      step.purpose = "检查前端结构与运行入口。";
    });

  expect(projectToolStagePresentation(run)).toMatchObject({
    title: "检查前端结构与运行入口。",
    summary: "读取 1 个文件 · 搜索代码 1 次 · 读取 1 个目录",
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));
  expect(screen.getByText("检查前端结构与运行入口。")).toBeVisible();
  expect(screen.getByText("读取 1 个文件 · 搜索代码 1 次 · 读取 1 个目录")).toBeVisible();
});

test("conversation tool stage mappings classify semantic and mixed tool batches", () => {
  const toolSearch = createToolBatchRun(["ToolSearchTool"]);
  toolSearch.steps.find((step) => step.toolName).status = "running";
  expect(projectToolStagePresentation(toolSearch)).toMatchObject({
    category: "tool-discovery",
    mode: "single-tool",
    status: "running",
    title: "正在搜索可用工具 1 次…",
  });

  expect(projectToolStagePresentation(createToolBatchRun(["WorkspaceFind", "WorkspaceGrep"]))).toMatchObject({
    category: "workspace-search",
    mode: "semantic-batch",
    status: "done",
    title: "查找文件 1 次 · 搜索代码 1 次",
  });
  expect(projectToolStagePresentation(createToolBatchRun(["WorkspaceGrep", "ShellCommandTool"]))).toMatchObject({
    category: "tools",
    mode: "semantic-batch",
    status: "done",
    title: "搜索代码 1 次 · 运行 1 条命令",
  });

  const failedSearch = createToolBatchRun(["WorkspaceGrep"]);
  failedSearch.steps.find((step) => step.toolName).status = "failed";
  expect(projectToolStagePresentation(failedSearch)).toMatchObject({
    category: "workspace-search",
    mode: "single-tool",
    status: "failed",
    title: "工作区搜索失败：WorkspaceGrep",
  });

  const mixedBatch = createToolBatchRun(["WorkspaceGrep", "WorkspaceFind", "WorkspaceRead"]);
  mixedBatch.steps.find((step) => step.toolName === "WorkspaceFind").status = "failed";
  expect(projectToolStagePresentation(mixedBatch)).toMatchObject({
    status: "failed",
    title: "搜索代码 1 次 · 查找文件 1 次 · 读取 1 个文件 · 成功 2 · 失败 1",
    counts: { total: 3, completed: 2, failed: 1 },
  });

  const waitingBatch = createToolBatchRun(["WorkspaceGrep", "WorkspaceFind"]);
  waitingBatch.steps.find((step) => step.toolName === "WorkspaceGrep").status = "running";
  waitingBatch.steps.find((step) => step.toolName === "WorkspaceFind").status = "failed";
  expect(projectToolStagePresentation(waitingBatch)).toMatchObject({
    status: "running",
    title: "正在搜索代码 1 次 · 查找文件 1 次 · 完成 0 · 失败 1",
  });
});

test("large tool batches keep concrete actions without overflowing the summary", () => {
  expect(
    projectToolStagePresentation(
      createToolBatchRun(["WorkspaceRead", "WorkspaceGrep", "WorkspaceFind", "GitInspect", "ShellCommandTool"]),
    ),
  ).toMatchObject({
    title: "读取 1 个文件 · 搜索代码 1 次 · 查找文件 1 次 · 另 2 类",
  });
});

test("conversation single-tool stages use a compact non-interactive status row", () => {
  const run = createToolBatchRun(["WorkspaceGrep"]);
  expect(projectToolStagePresentation(run)).toMatchObject({
    category: "workspace-search",
    mode: "single-tool",
    status: "done",
    title: "搜索代码 1 次",
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));
  const stage = document.querySelector("[data-execution-stage-feed]");
  const summary = screen.getByRole("status", { name: "搜索代码 1 次" });
  expect(stage).toHaveAttribute("data-tool-stage-mode", "single-tool");
  expect(summary).toHaveClass("inline-flex", "items-start", "max-w-full");
  expect(summary).not.toHaveClass("w-full");
  expect(document.querySelector("[data-tool-stage-details]")).not.toBeInTheDocument();
});

test("conversation tool stages use runtime provenance for shell and MCP wording", () => {
  const shellRun = createToolBatchRun(["ShellCommandTool"]);
  Object.assign(
    shellRun.steps.find((step) => step.toolName),
    {
      toolOrigin: { kind: "system", name: "Shell", capability: "host.shell-command" },
      toolArgs: { command: { mode: "shell", dialect: "powershell", script: "npm run check.types" } },
    },
  );
  expect(projectToolStagePresentation(shellRun)).toMatchObject({
    title: "运行命令：npm run check.types",
  });

  const mcpRun = createToolBatchRun(["github__list_pull_requests"]);
  Object.assign(
    mcpRun.steps.find((step) => step.toolName),
    {
      toolOrigin: { kind: "mcp", name: "github", server: "github", tool: "list_pull_requests" },
    },
  );
  expect(projectToolStagePresentation(mcpRun)).toMatchObject({
    title: "MCP 工具调用完成：github · list_pull_requests",
  });

  const grepRun = createToolBatchRun(["WorkspaceGrep"]);
  Object.assign(
    grepRun.steps.find((step) => step.toolName),
    {
      toolOrigin: { kind: "system", name: "Workspace tools", capability: "workspace.content.search" },
      toolArgs: { pattern: "projectToolActivity" },
    },
  );
  expect(projectToolStagePresentation(grepRun)).toMatchObject({
    title: "搜索工作区：projectToolActivity",
  });

  const gitRun = createToolBatchRun(["GitInspect"]);
  Object.assign(
    gitRun.steps.find((step) => step.toolName),
    {
      toolOrigin: { kind: "system", name: "Git", capability: "repository.git.inspect" },
      toolArgs: { operation: "diff" },
    },
  );
  expect(projectToolStagePresentation(gitRun)).toMatchObject({
    title: "检查 Git：diff",
  });

  const agentRun = createToolBatchRun(["AgentSpawn"]);
  Object.assign(
    agentRun.steps.find((step) => step.toolName),
    {
      toolOrigin: { kind: "system", name: "Agent delegation", capability: "orchestration.agent-spawn" },
      toolArgs: { role: "reviewer" },
    },
  );
  expect(projectToolStagePresentation(agentRun)).toMatchObject({
    title: "委派子任务：reviewer",
  });
});

test("every bundled system tool has a concrete activity action", () => {
  const workspaceRoot = resolveWorkspaceRoot();
  const toolFiles = globSync("System/Extensions/**/*.tool.json", { cwd: workspaceRoot });
  expect(toolFiles.length).toBeGreaterThan(0);
  const genericTools = toolFiles
    .map((filePath) => JSON.parse(readFileSync(path.resolve(workspaceRoot, filePath), "utf8")).name)
    .filter((name) => projectToolActivityInspection({ toolName: name, status: "completed" }).category === "system");
  expect(genericTools).toEqual([]);
});

test("execution feed keeps workflow steps while the answer body is projected below it", () => {
  const run = createToolBatchRun(["WorkspaceReadFile"]);
  run.visibleKind = "final_answer";
  run.displayText = "最终回答正文";

  renderWithFrontendProviders(
    React.createElement(AgentExecutionFeed, {
      run,
      showBody: false,
    }),
  );

  expect(document.querySelector("[data-feed-group='tools:batch-actions']")).toBeInTheDocument();
  expect(screen.queryByText("最终回答正文")).not.toBeInTheDocument();
});

test("conversation shows a live thinking stage before the first tool decision", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T00:01:05.000Z"));
  const run = createRun({
    requestId: "run-thinking",
    status: "running",
    endedAt: undefined,
    startedAt: "2026-07-11T00:00:00.000Z",
    outputState: "pending",
    visibleKind: "unknown",
    steps: [],
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(screen.getByText(frontendFeatureMessage("workflow.feed.thinking"))).toBeVisible();
  expect(screen.getByText("1分钟5秒")).toBeVisible();
  expect(screen.queryByText(frontendMessage("workflow.feed.running"))).not.toBeInTheDocument();
  expect(screen.queryByText(frontendMessage("workflow.feed.stepCount", { count: 0 }))).not.toBeInTheDocument();
  expect(
    document.querySelector("[data-feed-marker-status='running'] [class~='motion-safe:animate-spin']"),
  ).toBeInTheDocument();
  expect(document.querySelector("[data-feed-marker-status='running']")).toHaveClass(
    "bg-accent-surface",
    "text-accent-content",
  );
});

test("active tool stages show a spinner and live elapsed time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T00:01:05.000Z"));
  const run = createToolBatchRun(["WorkspaceGrep"]);
  const toolStep = run.steps.find((step) => step.toolName === "WorkspaceGrep");
  toolStep.status = "running";
  toolStep.startedAt = "2026-07-11T00:00:00.000Z";

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(screen.getByRole("status", { name: "正在搜索代码 1 次…" })).toBeVisible();
  expect(screen.getByText("1分钟5秒")).toBeVisible();
  expect(document.querySelector("[data-tool-stage-summary] [class~='motion-safe:animate-spin']")).toBeInTheDocument();
});

test("live tool stage falls back to thinking while the next decision is pending", () => {
  const run = createToolBatchRun(["WorkspaceGrep"]);
  run.steps.find((step) => step.toolName).status = "done";
  run.status = "running";
  run.outputState = "pending";
  run.visibleKind = "tool_calls";

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(screen.getByText(frontendFeatureMessage("workflow.feed.thinking"))).toBeVisible();
  expect(
    document.querySelector("[data-feed-marker-status='running'] [class~='motion-safe:animate-spin']"),
  ).toBeInTheDocument();
});

test("context compaction keeps the request clock instead of restarting at the activity boundary", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T00:01:05.000Z"));
  const run = createToolBatchRun(["WorkspaceGrep"]);
  run.steps.find((step) => step.toolName).status = "done";
  run.status = "running";
  run.outputState = "pending";
  run.liveActivity = "compacting_context";
  run.activities = [
    {
      id: "compaction",
      activity: "compacting_context",
      status: "running",
      startedAt: "2026-07-11T00:01:00.000Z",
    },
  ];

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(screen.getByText("Senera 正在压缩上下文")).toBeVisible();
  expect(screen.getByText("1分钟5秒")).toBeVisible();
});

test("execution feed renders Senera live activities without adding workflow nodes", async () => {
  const user = userEvent.setup();
  const run = createToolBatchRun([]);
  const workflowStepCount = run.steps.length;
  run.liveActivity = "compacting_context";
  run.activities = [
    {
      id: "activity-context",
      activity: "preparing_context",
      status: "done",
      step: 1,
      startedAt: run.startedAt,
      endedAt: run.startedAt,
    },
    {
      id: "activity-model",
      activity: "running_agent_turn",
      status: "done",
      step: 1,
      startedAt: run.startedAt,
      endedAt: run.startedAt,
    },
    {
      id: "activity-compaction",
      activity: "compacting_context",
      status: "running",
      step: 1,
      startedAt: run.startedAt,
    },
  ];

  renderWithFrontendProviders(React.createElement(AgentExecutionFeed, { run }));

  // 活动组默认折叠为单行摘要:组头可见,活动明细收进折叠面板。
  const activityToggle = screen.getByText(frontendMessage("workflow.feed.seneraActivity"));
  expect(activityToggle).toBeVisible();
  expect(document.querySelector("[data-feed-group-variant='activity']")).toBeInTheDocument();
  expect(document.querySelector("[data-feed-detail-surface]")).not.toBeInTheDocument();

  // 展开后只展示真正影响等待的上下文压缩，内部生命周期仍保留在诊断事件中。
  await user.click(activityToggle);
  await waitFor(() => expect(screen.getByText(frontendMessage("workflow.activity.compactingContext"))).toBeVisible());
  expect(screen.queryByText(frontendMessage("workflow.activity.preparingContext"))).not.toBeInTheDocument();
  expect(screen.queryByText(frontendMessage("workflow.activity.runningAgentTurn"))).not.toBeInTheDocument();
  expect(run.steps).toHaveLength(workflowStepCount);
});

test("execution feed contains failed events and respects reduced motion", () => {
  const run = createRun({
    status: "running",
    endedAt: undefined,
    steps: [
      createStep({ id: "failed-context", status: "failed", title: "Prepare context" }),
      createStep({ id: "running-model", status: "running", title: "Generate response" }),
    ],
  });

  renderWithFrontendProviders(
    React.createElement(AppMotionProvider, { level: "reduced" }, React.createElement(AgentExecutionFeed, { run })),
  );

  expect(screen.getByText("Prepare context").parentElement?.parentElement).toHaveClass(
    "border-l-2",
    "border-brick-400",
  );
  expect(screen.getByText("Prepare context").parentElement?.parentElement).not.toHaveClass("bg-brick-50");
  expect(document.querySelector("[data-execution-feed] .animate-spin")).not.toBeInTheDocument();
});
