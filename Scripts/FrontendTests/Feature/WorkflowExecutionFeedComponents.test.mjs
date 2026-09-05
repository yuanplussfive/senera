import React from "react";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveWorkspaceRoot } from "../../../Scripts/WorkspaceRoot.ts";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";

const { ToolStepInspector } = await import("../../../Frontend/src/features/workflow/ToolStepInspector.tsx");
const { AgentExecutionFeed, AgentExecutionStageFeed, AgentExecutionStageFold } =
  await import("../../../Frontend/src/features/workflow/AgentExecutionFeed.tsx");
const { ToolActivityGroup } = await import("../../../Frontend/src/features/workflow/ToolActivityGroup.tsx");
const { projectToolStagePresentation } =
  await import("../../../Frontend/src/features/workflow/toolStagePresentation.ts");
const { projectToolActivityInspection } =
  await import("../../../Frontend/src/features/workflow/toolActivityPresentation.ts");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");
const { TooltipProvider } = await import("../../../Frontend/src/shared/ui/Tooltip.tsx");
const { createStep, createToolBatchRun } = await import("./workflowComponentFixtures.mjs");

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
  await waitFor(() => expect(screen.getByText("WorkspaceReadFile")).toBeVisible());
  expect(screen.getByText("WorkspaceSearchFiles")).toBeVisible();
  expect(screen.getByText("Read · Source/runtime.ts")).toBeVisible();
  expect(group).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelector("[data-feed-detail-surface]")).toHaveClass("border-l", "border-line-subtle", "pl-3");
  expect(document.querySelector("[data-feed-detail-surface]")).not.toHaveClass("rounded-md", "bg-surface-subtle/70");

  expect(document.querySelector("[data-feed-tool-detail]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-step-inspector]")).not.toBeInTheDocument();
  expect(screen.queryByText("export const runtime = true;")).not.toBeInTheDocument();

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
  expect(screen.getByText("WorkspaceListDirectory")).toBeVisible();
  expect(document.querySelector("[data-feed-group='tools:batch-actions']")).toHaveAttribute("aria-expanded", "true");
});

test("tool inspector keeps web search output in the generic result surface", () => {
  const step = createStep({
    id: "web-search-step",
    kind: "tool",
    title: "Search the web",
    status: "done",
    toolName: "WebSearch",
    toolArgs: { query: "React security guidance" },
    toolPresentation: { summary: "Found 2 web result(s) for React security guidance." },
    toolResult: {
      query: "React security guidance",
      results: [
        {
          title: "React security overview",
          url: "https://react.dev/learn/keeping-components-pure",
          summary: "Official guidance for writing predictable React components.",
          citationId: "cite-react",
        },
        {
          title: "Unsafe local URL",
          url: "file:///private/report.txt",
          summary: "This must render as text rather than a navigable link.",
          citationId: "cite-private",
        },
      ],
    },
  });

  renderWithFrontendProviders(React.createElement(ToolStepInspector, { step }));

  expect(screen.getByText("WebSearch")).toBeVisible();
  expect(document.querySelector("[data-tool-inspector-section='action']")).toHaveTextContent("React security guidance");
  expect(document.querySelector("[data-tool-inspector-section='result']")).toHaveTextContent("React security guidance");
  expect(screen.queryByText("Found 2 web result(s) for React security guidance.")).not.toBeInTheDocument();
  expect(document.querySelector("[data-web-search-activity]")).not.toBeInTheDocument();
  expect(screen.queryByText("React security overview")).not.toBeInTheDocument();
});

test("conversation tool rounds use the same compact batch activity for web results", () => {
  const run = createToolBatchRun(["WebSearch"]);
  const searchStep = run.steps.find((step) => step.toolName === "WebSearch");
  searchStep.toolArgs = { query: "React security guidance" };
  searchStep.toolResult = {
    query: "React security guidance",
    results: [
      {
        title: "React security overview",
        url: "https://react.dev/learn/keeping-components-pure",
        citationId: "cite-react",
      },
    ],
  };

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(document.querySelector("[data-web-search-stage]")).not.toBeInTheDocument();
  expect(document.querySelectorAll("[data-web-search-activity]")).toHaveLength(0);
  expect(document.querySelector("[data-tool-batch-activity]")).toHaveTextContent("Search · React security guidance");
  expect(document.querySelector("[data-tool-activity-group='external']")).not.toBeInTheDocument();
  expect(screen.queryByText("WebSearch")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
});

test("completed execution intervals stay folded until the tool sequence is requested", async () => {
  const user = userEvent.setup();
  const run = createToolBatchRun(["WorkspaceRead", "WorkspaceGrep"]);

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFold, { run }));

  const fold = document.querySelector("[data-execution-stage-fold]");
  const trigger = fold?.querySelector("[data-tool-batch-activity-trigger]");
  expect(fold).toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(fold?.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();

  await user.click(trigger);

  await waitFor(() => expect(fold?.querySelector("[data-tool-batch-activity-items]")).toBeVisible());
  expect(fold?.querySelectorAll("[data-tool-batch-activity-item]")).toHaveLength(2);
});

test("completed tool batches collapse their tool calls until expanded", async () => {
  const user = userEvent.setup();
  const run = createToolBatchRun(["WebSearch"]);
  const searchStep = run.steps.find((step) => step.toolName === "WebSearch");
  searchStep.toolArgs = { query: "React security guidance" };
  searchStep.toolResult = {
    query: "React security guidance",
    results: [
      {
        title: "React security overview",
        url: "https://react.dev/learn/keeping-components-pure",
        citationId: "cite-react",
      },
    ],
  };

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFold, { run }));

  const fold = document.querySelector("[data-execution-stage-fold]");
  const trigger = fold?.querySelector("[data-tool-batch-activity-trigger]");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(fold?.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
  await user.click(trigger);

  await waitFor(() => expect(fold?.querySelector("[data-tool-batch-activity-items]")).toBeVisible());
  expect(fold?.querySelector("[data-tool-batch-activity-item]")).toHaveTextContent("Search · React security guidance");
  expect(fold?.querySelector("[data-tool-batch-activity-item] a")).not.toBeInTheDocument();
  expect(screen.queryByText("React security overview")).not.toBeInTheDocument();
});

test("active tool batches keep settled rows while unfinished calls remain visibly active", () => {
  const run = createToolBatchRun(["WebSearch", "WebSearch"]);
  const firstStep = run.steps.find((step) => step.toolName === "WebSearch");
  const secondStep = run.steps.filter((step) => step.toolName === "WebSearch")[1];
  firstStep.toolArgs = { query: "React security guidance" };
  firstStep.toolResult = {
    results: [
      {
        title: "React security overview",
        url: "https://react.dev/learn/keeping-components-pure",
      },
    ],
  };
  secondStep.toolArgs = { query: "React Server Components guidance" };
  secondStep.status = "running";

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(document.querySelector("[data-tool-batch-activity]")).toHaveAttribute("data-state", "loading");
  expect(document.querySelector("[data-tool-batch-activity-items]")).toBeVisible();
  expect(document.querySelector("[data-tool-batch-activity-item][data-state='done']")).toHaveTextContent(
    "Search · React security guidance",
  );
  expect(document.querySelector("[data-tool-batch-activity-item][data-state='done']")).toHaveClass("items-center");
  expect(document.querySelector("[data-tool-batch-activity-item][data-state='done'] > span")).toHaveClass(
    "h-[18px]",
    "items-center",
  );
  expect(
    document.querySelector("[data-tool-batch-activity-item][data-state='loading'] .motion-safe\\:animate-spin"),
  ).toBeInTheDocument();
  expect(screen.queryByText("WebSearch")).not.toBeInTheDocument();
});

test("partial tool failures remain local to their individual chain steps", async () => {
  const user = userEvent.setup();
  const run = createToolBatchRun(["WorkspaceRead", "WorkspaceGrep"]);
  run.steps.find((step) => step.toolName === "WorkspaceGrep").status = "failed";

  expect(projectToolStagePresentation(run)).toMatchObject({
    status: "done",
    counts: { total: 2, completed: 1, failed: 1 },
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFold, { run }));

  const fold = document.querySelector("[data-execution-stage-fold]");
  expect(fold).toHaveAttribute("data-tool-stage-status", "done");
  await user.click(fold?.querySelector("[data-tool-batch-activity-trigger]"));

  await waitFor(() =>
    expect(fold?.querySelectorAll("[data-tool-batch-activity-item][data-state='done']")).toHaveLength(1),
  );
  const failedStep = fold?.querySelector("[data-tool-batch-activity-item][data-state='failed']");
  expect(failedStep).toBeInTheDocument();
  expect(failedStep?.querySelector(".border-content-muted")).toBeInTheDocument();
});

test("conversation tool stages keep details in the workflow dock", () => {
  const run = createToolBatchRun(["ExecutionResourceWait", "ExecutionResourceWait"]);

  expect(projectToolStagePresentation(run)).toMatchObject({
    category: "background-wait",
    mode: "semantic-batch",
    status: "done",
    title: "运行任务",
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(screen.getByRole("status", { name: "运行任务" })).toBeVisible();
  expect(screen.queryByText("ExecutionResourceWait")).not.toBeInTheDocument();
  expect(screen.queryByText(/并发工具批次/)).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-stage-details]")).not.toBeInTheDocument();
});

test("conversation tool batches use one semantic batch activity without duplicating details", () => {
  const run = createToolBatchRun(["WorkspaceRead", "WorkspaceGrep", "WorkspaceList"]);
  run.steps
    .filter((step) => step.toolName)
    .forEach((step) => {
      step.purpose = "检查前端结构与运行入口。";
    });

  expect(projectToolStagePresentation(run)).toMatchObject({
    title: "探索代码库",
    accessibleTitle: "探索代码库 · Read · Search · List",
    summary: "Read · Search · List",
    icons: ["file-text", "search"],
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));
  expect(document.querySelector("[data-tool-batch-activity]")).toHaveTextContent("探索代码库");
  expect(screen.queryByText("检查前端结构与运行入口。")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-batch-activity]")).toHaveAttribute("data-state", "done");
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
  expect(screen.getAllByText("探索代码库")).toHaveLength(1);
});

test("conversation tool stage mappings classify semantic and mixed tool batches", () => {
  const toolSearch = createToolBatchRun(["ToolSearch"]);
  toolSearch.steps.find((step) => step.toolName).status = "running";
  expect(projectToolStagePresentation(toolSearch)).toMatchObject({
    category: "tool-discovery",
    icon: "search",
    mode: "single-tool",
    status: "running",
    title: "Search",
  });

  expect(projectToolStagePresentation(createToolBatchRun(["ToolDescribe"]))).toMatchObject({
    category: "tool-management",
    icon: "tools",
    mode: "single-tool",
    title: "Inspect",
  });

  expect(projectToolStagePresentation(createToolBatchRun(["WorkspaceFind", "WorkspaceGrep"]))).toMatchObject({
    category: "workspace-search",
    icon: "search",
    icons: ["search"],
    mode: "semantic-batch",
    status: "done",
    title: "探索代码库",
  });
  expect(projectToolStagePresentation(createToolBatchRun(["WorkspaceGrep", "ShellCommandTool"]))).toMatchObject({
    category: "tools",
    icon: "search",
    icons: ["search", "terminal"],
    mode: "semantic-batch",
    status: "done",
    title: "Search · Run",
  });

  const failedSearch = createToolBatchRun(["WorkspaceGrep"]);
  failedSearch.steps.find((step) => step.toolName).status = "failed";
  expect(projectToolStagePresentation(failedSearch)).toMatchObject({
    category: "workspace-search",
    mode: "single-tool",
    status: "failed",
    title: "Search",
  });

  const mixedBatch = createToolBatchRun(["WorkspaceGrep", "WorkspaceFind", "WorkspaceRead"]);
  mixedBatch.steps.find((step) => step.toolName === "WorkspaceFind").status = "failed";
  expect(projectToolStagePresentation(mixedBatch)).toMatchObject({
    status: "done",
    title: "探索代码库",
    summary: "Search · Find · Read",
    icons: ["search", "file-text"],
    counts: { total: 3, settled: 3, completed: 2, failed: 1 },
  });

  const waitingBatch = createToolBatchRun(["WorkspaceGrep", "WorkspaceFind"]);
  waitingBatch.steps.find((step) => step.toolName === "WorkspaceGrep").status = "running";
  waitingBatch.steps.find((step) => step.toolName === "WorkspaceFind").status = "failed";
  expect(projectToolStagePresentation(waitingBatch)).toMatchObject({
    status: "running",
    title: "探索代码库",
    accessibleTitle: "探索代码库 · Search · Find · 1 项未完成",
    summary: "Search · Find",
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run: mixedBatch }));
  expect(document.querySelector("[data-tool-activity-meta]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-action-warning]")).not.toBeInTheDocument();
  expect(screen.queryByText("1 项失败")).not.toBeInTheDocument();
});

test("tool activity labels stay action-focused and show concise safe arguments", () => {
  const longQuery = "agentic-ui ".repeat(16).trim();
  const failedSearch = projectToolActivityInspection({
    toolName: "WebSearch",
    status: "failed",
    arguments: { query: longQuery },
  });
  expect(failedSearch.label.startsWith("Search ·")).toBe(true);
  expect(failedSearch.label).not.toContain("失败");
  expect(failedSearch.label.endsWith("...")).toBe(true);

  const mcp = projectToolActivityInspection({
    toolName: "get_file",
    origin: { kind: "mcp", name: "github", server: "github", tool: "get_file" },
    status: "completed",
    arguments: { owner: "yuanplussfive", repo: "senera", path: "Frontend/src/App.tsx", apiKey: "must-not-display" },
  });
  expect(mcp.label).toContain("Call · github · get_file");
  expect(mcp.label).toContain("owner=yuanplussfive");
  expect(mcp.label).toContain("repo=senera");
  expect(mcp.label).not.toContain("must-not-display");

  const shell = projectToolActivityInspection({
    toolName: "ShellCommandTool",
    status: "completed",
    arguments: { command: { script: "npm run check.types" }, cwd: "E:\\senera" },
  });
  expect(shell.label).toBe("Run · npm run check.types · E:\\senera");

  const system = projectToolActivityInspection({
    toolName: "CustomSystemTool",
    status: "failed",
    arguments: { path: "Source/AgentSystem", depth: 2, token: "must-not-display" },
  });
  expect(system.label).toContain("Run · CustomSystemTool · path=Source/AgentSystem · depth=2");
  expect(system.label).not.toContain("执行失败");
  expect(system.label).not.toContain("must-not-display");
});

test("browser tools use the shared batch activity with semantic action labels", () => {
  const run = createToolBatchRun([
    "BrowserOpen",
    "BrowserSnapshot",
    "BrowserClick",
    "BrowserWaitForLoad",
    "BrowserScreenshot",
    "BrowserTabClose",
    "BrowserClose",
  ]);

  expect(projectToolActivityInspection({ toolName: "BrowserSnapshot", status: "completed" })).toMatchObject({
    category: "browser-read",
    label: "Read",
  });
  expect(projectToolStagePresentation(run)).toMatchObject({
    category: "browser",
    icon: "globe",
    icons: ["globe"],
    mode: "semantic-batch",
    title: "访问外部资源",
    summary: "Navigate · Read · Interact · Wait · Capture · Manage · Close",
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));
  expect(document.querySelector("[data-tool-batch-activity]")).toHaveTextContent("访问外部资源");
});

test("visual browser tools have concrete activity and stage semantics", () => {
  expect(
    projectToolActivityInspection({
      toolName: "BrowserDownload",
      status: "completed",
      arguments: { selector: "a.download" },
    }),
  ).toMatchObject({
    category: "browser-download",
    label: "Download · a.download",
  });
  expect(
    projectToolActivityInspection({
      toolName: "BrowserComputer",
      status: "completed",
      arguments: { actions: [{ type: "click", x: 10, y: 20 }] },
    }),
  ).toMatchObject({
    category: "browser-computer",
    label: "Interact · BrowserComputer · click",
  });
});

test("conversation activity rows show at most three tool icons and a quiet overflow mark", () => {
  renderWithFrontendProviders(
    React.createElement(ToolActivityGroup, {
      activity: {
        id: "mixed-icons",
        title: "探索代码库",
        accessibleTitle: "探索代码库",
        icons: ["file-text", "search", "git-branch", "terminal", "globe"],
        status: "done",
        actions: [{ id: "read", icon: "file-text", label: "Read", count: 5 }],
        counts: { total: 5, settled: 5, completed: 5, failed: 0 },
      },
    }),
  );

  expect(document.querySelectorAll("[data-tool-activity-icon]")).toHaveLength(3);
  expect(document.querySelector("[data-tool-activity-icon-overflow]")).toHaveTextContent("…");
});

test("large mixed tool batches use one compact semantic batch activity", () => {
  expect(
    projectToolStagePresentation(
      createToolBatchRun([
        "WorkspaceRead",
        "WorkspaceGrep",
        "WorkspaceFind",
        "GitInspect",
        "ShellCommandTool",
        "AgentSpawn",
      ]),
    ),
  ).toMatchObject({
    title: "探索代码库 · Run · Delegate",
    icons: ["file-text", "search", "git-branch"],
  });

  renderWithFrontendProviders(
    React.createElement(AgentExecutionStageFeed, {
      run: createToolBatchRun([
        "WorkspaceRead",
        "WorkspaceGrep",
        "WorkspaceFind",
        "GitInspect",
        "ShellCommandTool",
        "AgentSpawn",
      ]),
    }),
  );
  expect(document.querySelectorAll("[data-tool-batch-activity]")).toHaveLength(1);
  expect(document.querySelector("[data-tool-batch-activity]")).toHaveTextContent("探索代码库 · Run · Delegate");
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
  expect(document.querySelector(".tool-activity-icon-face")).not.toBeInTheDocument();
});

test("conversation single-tool stages use the shared collapsible batch activity", () => {
  const run = createToolBatchRun(["WorkspaceGrep"]);
  expect(projectToolStagePresentation(run)).toMatchObject({
    category: "workspace-search",
    mode: "single-tool",
    status: "done",
    title: "Search",
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));
  const stage = document.querySelector("[data-execution-stage-feed]");
  const summary = screen.getByRole("status", { name: "Search" });
  expect(stage).toHaveAttribute("data-tool-stage-mode", "single-tool");
  expect(stage).toHaveClass("w-full");
  expect(summary.querySelector("[data-tool-action-icon='search'][data-tool-action-status='done']")).toBeInTheDocument();
  expect(summary.querySelector("[data-tool-batch-activity-trigger]")).toHaveAttribute("aria-expanded", "false");
  expect(summary.querySelector(".lucide-check, .lucide-x")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
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
    icon: "terminal",
    title: "Run · npm run check.types",
  });

  const mcpRun = createToolBatchRun(["github__list_pull_requests"]);
  Object.assign(
    mcpRun.steps.find((step) => step.toolName),
    {
      toolOrigin: { kind: "mcp", name: "github", server: "github", tool: "list_pull_requests" },
    },
  );
  expect(projectToolStagePresentation(mcpRun)).toMatchObject({
    icon: "globe",
    title: "Call · github · list_pull_requests",
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
    title: "Search · projectToolActivity",
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
    title: "Inspect · diff",
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
    title: "Delegate · reviewer",
  });
});

test("every bundled system tool has a concrete activity action", () => {
  const workspaceRoot = resolveWorkspaceRoot();
  const toolFiles = globSync("System/Extensions/*/extension.json", { cwd: workspaceRoot }).flatMap((manifestPath) => {
    const manifest = JSON.parse(readFileSync(path.resolve(workspaceRoot, manifestPath), "utf8"));
    return (manifest.contributions ?? [])
      .filter((contribution) => contribution.kind === "hostTool")
      .map((contribution) => path.join(path.dirname(manifestPath), contribution.contract));
  });
  expect(toolFiles.length).toBeGreaterThan(0);
  const genericTools = toolFiles
    .map((filePath) => JSON.parse(readFileSync(path.resolve(workspaceRoot, filePath), "utf8")).name)
    .filter((name) => projectToolActivityInspection({ toolName: name, status: "completed" }).category === "system");
  expect(genericTools).toEqual([]);
});
