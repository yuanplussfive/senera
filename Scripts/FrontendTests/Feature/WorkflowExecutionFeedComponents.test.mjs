import React from "react";
import { readFileSync } from "node:fs";
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
const { projectToolBatchActivity } = await import("../../../Frontend/src/features/workflow/ToolBatchActivity.tsx");
const { ChildRunBoard } = await import("../../../Frontend/src/features/workflow/ChildRunBoard.tsx");
const { ToolActivityGroup } = await import("../../../Frontend/src/features/workflow/ToolActivityGroup.tsx");
const { projectToolStagePresentation } =
  await import("../../../Frontend/src/features/workflow/toolStagePresentation.ts");
const { projectToolActivityInspection } =
  await import("../../../Frontend/src/features/workflow/toolActivityPresentation.ts");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const {
  createRun,
  createStep,
  createToolBatchRun: createUnprojectedToolBatchRun,
} = await import("./workflowComponentFixtures.mjs");
const { discoverAgentSystemExtensionPackages } =
  await import("../../../Source/AgentSystem/SystemTools/AgentSystemExtensionDiscovery.ts");
const { resolveAgentSystemToolPresentation } =
  await import("../../../Source/AgentSystem/SystemTools/AgentSystemToolPresentation.ts");

const SystemToolOrigins = discoverSystemToolOrigins();
const WorkflowLocale = "zh-CN";

function createToolBatchRun(toolNames) {
  const run = createUnprojectedToolBatchRun(toolNames);
  for (const step of run.steps) {
    if (!step.toolName || step.toolOrigin) continue;
    const origin = SystemToolOrigins.get(step.toolName);
    if (origin) step.toolOrigin = structuredClone(origin);
  }
  return run;
}

function systemToolOrigin(toolName) {
  const origin = SystemToolOrigins.get(toolName);
  if (!origin) throw new Error(`Missing System Tool origin fixture for ${toolName}.`);
  return structuredClone(origin);
}

function systemToolText(toolName, path) {
  const origin = systemToolOrigin(toolName);
  const value = path(origin.presentation);
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing ${WorkflowLocale} presentation text for ${toolName}.`);
  }
  return value;
}

function systemToolAction(toolName) {
  return systemToolText(toolName, (presentation) => presentation.activity.action[WorkflowLocale]);
}

function systemToolGroupTitle(toolName) {
  return systemToolText(toolName, (presentation) => presentation.group.title[WorkflowLocale]);
}

function systemToolIcon(toolName) {
  return systemToolOrigin(toolName).presentation.icon;
}

function systemToolIcons(toolNames) {
  return [...new Set(toolNames.map(systemToolIcon))].slice(0, 3);
}

function discoverSystemToolOrigins() {
  const workspaceRoot = resolveWorkspaceRoot();
  const origins = new Map();
  for (const source of discoverAgentSystemExtensionPackages(path.join(workspaceRoot, "System", "Extensions"))) {
    for (const contribution of source.manifest.contributions ?? []) {
      if (contribution.kind !== "hostTool") continue;
      const contract = JSON.parse(readFileSync(path.join(source.packageRoot, contribution.contract), "utf8"));
      origins.set(contract.name, {
        kind: "system",
        name: source.manifest.displayName["en-US"],
        capability: contribution.capability,
        presentation: resolveAgentSystemToolPresentation(
          source.domain.presentation,
          source.manifest.presentation,
          contract.presentation,
        ),
      });
    }
  }
  return origins;
}

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
  const batchActivity = document.querySelector("[data-tool-batch-activity]");
  expect(batchActivity).toHaveTextContent(`${systemToolAction("WebSearch")}React security guidance`);
  expect(batchActivity?.querySelector("[data-tool-activity-arrow]")).toBeInTheDocument();
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

test("a single completed tool result stays in one row instead of repeating as a child", () => {
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
  expect(trigger.tagName).toBe("DIV");
  expect(trigger).not.toHaveAttribute("aria-expanded");
  expect(fold?.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
  expect(trigger).toHaveTextContent(`${systemToolAction("WebSearch")}React security guidance`);
  expect(trigger.querySelector("[data-tool-activity-arrow]")).toBeInTheDocument();
  expect(screen.queryByText("React security overview")).not.toBeInTheDocument();
});

test("active tool batches stay compact while preserving settled and unfinished tool details", async () => {
  const user = userEvent.setup();
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
  const trigger = document.querySelector("[data-tool-batch-activity-trigger]");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger.querySelector("[data-tool-batch-activity-title]")).not.toHaveClass("motion-safe:animate-text-shimmer");
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();

  await user.click(trigger);
  await waitFor(() => expect(document.querySelector("[data-tool-batch-activity-items]")).toBeVisible());
  const settledToolRow = document.querySelector("[data-tool-batch-activity-item][data-state='done']");
  expect(settledToolRow).toHaveTextContent(`${systemToolAction("WebSearch")}React security guidance`);
  expect(settledToolRow?.querySelector("[data-tool-activity-arrow]")).toBeInTheDocument();
  expect(document.querySelector("[data-tool-action-icon]")).toHaveClass("align-middle", "leading-none");
  expect(document.querySelector("[data-tool-batch-activity-item][data-state='done']")).toHaveClass("items-start");
  expect(document.querySelector("[data-tool-batch-activity-viewport]")).toHaveClass("tool-activity-viewport");
  expect(document.querySelector("[data-tool-batch-activity-item][data-state='done'] > span")).toHaveClass(
    "h-[18px]",
    "items-center",
  );
  const activeToolRow = document.querySelector("[data-tool-batch-activity-item][data-state='loading']");
  expect(activeToolRow.querySelector("[data-workflow-live-marker]")).toBeInTheDocument();
  expect(activeToolRow.querySelector('[class~="motion-safe:animate-text-shimmer"]')).not.toBeInTheDocument();
  expect(activeToolRow.querySelector("[data-execution-status-icon='running']")).toBeInTheDocument();
  expect(screen.queryByText("WebSearch")).not.toBeInTheDocument();
});

test("an expanded parallel batch animates unfinished actions without opening itself", async () => {
  const user = userEvent.setup();
  const run = createToolBatchRun(["WebSearch", "WorkspaceRead"]);
  run.steps
    .filter((step) => step.kind === "tool" && step.toolName)
    .forEach((step) => {
      step.status = "running";
    });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  const trigger = document.querySelector("[data-tool-batch-activity-trigger]");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(document.querySelectorAll("[data-tool-batch-activity-item]")).toHaveLength(0);

  await user.click(trigger);
  const activeRows = [...document.querySelectorAll("[data-tool-batch-activity-item][data-state='loading']")];
  expect(activeRows).toHaveLength(2);
  activeRows.forEach((row) => {
    expect(row.querySelector('[class~="motion-safe:animate-text-shimmer"]')).not.toBeInTheDocument();
    expect(row.querySelector("[data-execution-status-icon='running']")).toBeInTheDocument();
  });
});

test("tool batch disclosure identity remains stable as concurrent tools join", () => {
  const oneTool = createToolBatchRun(["WorkspaceRead"]);
  const twoTools = createToolBatchRun(["WorkspaceRead", "WorkspaceGrep"]);

  expect(projectToolBatchActivity(oneTool)?.id).toBe("tool-batch:batch-actions");
  expect(projectToolBatchActivity(twoTools)?.id).toBe("tool-batch:batch-actions");
});

test("the last completed tool stays highlighted without a duplicate disclosure", () => {
  const run = createToolBatchRun(["WorkspaceRead"]);
  run.status = "completed";
  run.endedAt = "2026-07-11T00:00:05.000Z";
  run.steps.find((step) => step.kind === "model").status = "done";

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run, liveActivity: true }));

  const trigger = document.querySelector("[data-tool-batch-activity-trigger]");
  expect(trigger).toHaveClass("activity-feed-row");
  expect(trigger.querySelector("[data-tool-batch-activity-title]")).not.toHaveClass("motion-safe:animate-text-shimmer");
  expect(trigger.querySelector("[data-tool-action-live]")).not.toBeInTheDocument();
  expect(trigger.querySelector("[data-tool-action-icon]")).not.toHaveClass("senera-live-status-icon");
  expect(trigger.querySelector(".senera-spinner")).not.toBeInTheDocument();
  expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  expect(trigger).not.toHaveAttribute("aria-expanded");
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
});

test("a single-file workspace edit uses one concise row without duplicate detail", () => {
  const run = createToolBatchRun(["ShellCommandTool"]);
  const step = run.steps.find((entry) => entry.toolName === "ShellCommandTool");
  step.toolPresentation = {
    type: "senera.tool_result_presentation.v1",
    version: 1,
    status: "success",
    headline: "Command completed",
    facts: [],
    evidence: [],
    changes: [
      {
        kind: "workspace",
        status: "changed",
        workspaceStatus: "modified",
        key: "Source/AgentSystem/AgentWorkspaceSnapshotUtils.ts",
        summary: "modified file",
        addedLines: 70,
        removedLines: 31,
      },
    ],
  };

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  const trigger = document.querySelector("[data-tool-batch-activity-trigger]");
  expect(trigger).toHaveTextContent("编辑 AgentWorkspaceSnapshotUtils.ts +70 −31");
  expect(trigger.tagName).toBe("DIV");
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
  expect(trigger).not.toHaveTextContent("行");
  expect(trigger.querySelector("[data-workspace-added-lines]")).toHaveClass("text-emerald-700");
  expect(trigger.querySelector("[data-workspace-removed-lines]")).toHaveClass("text-rose-700");
  expect(screen.queryByText("ShellCommandTool")).not.toBeInTheDocument();
});

test("plain activity and workspace file rows share one text column after the status mark", async () => {
  const user = userEvent.setup();
  const run = createToolBatchRun(["WorkspaceRead", "ShellCommandTool"]);
  const readStep = run.steps.find((step) => step.toolName === "WorkspaceRead");
  const editStep = run.steps.find((step) => step.toolName === "ShellCommandTool");
  readStep.toolArgs = { path: "src/app.ts" };
  editStep.toolPresentation = {
    type: "senera.tool_result_presentation.v1",
    version: 1,
    status: "success",
    headline: "Command completed",
    facts: [],
    evidence: [],
    changes: [
      {
        kind: "workspace",
        status: "changed",
        workspaceStatus: "modified",
        key: "src/app.ts",
        summary: "modified file",
        addedLines: 4,
        removedLines: 2,
      },
    ],
  };

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));
  await user.click(document.querySelector("[data-tool-batch-activity-trigger]"));

  const items = [...document.querySelectorAll("[data-tool-batch-activity-item]")];
  expect(items).toHaveLength(2);
  for (const item of items) {
    expect(item.children).toHaveLength(2);
    expect(item.children[0]).toHaveClass("h-[18px]", "w-3.5", "items-center");
    expect(item.children[1]).toHaveAttribute("data-tool-activity-content");
    expect(item.children[1]).toHaveClass("min-w-0", "flex-1");
  }
  const fileRow = items[1].querySelector("[data-tool-file-change-row]");
  expect(fileRow.querySelector("[data-tool-file-change-text]").nextElementSibling).toBe(
    fileRow.querySelector("[data-workspace-added-lines]")?.parentElement,
  );
  expect(fileRow.querySelector("[data-tool-file-change-icon]")).toBeInTheDocument();
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
  expect(failedStep?.querySelector("[data-execution-status-icon='failed']")).toBeInTheDocument();
});

test("conversation tool stages keep details in the workflow dock", () => {
  const run = createToolBatchRun(["ExecutionResourceWait", "ExecutionResourceWait"]);

  expect(projectToolStagePresentation(run)).toMatchObject({
    category: "execution-resource",
    mode: "semantic-batch",
    status: "done",
    title: systemToolGroupTitle("ExecutionResourceWait"),
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(screen.getByRole("status", { name: systemToolAction("ExecutionResourceWait") })).toBeVisible();
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
    title: systemToolGroupTitle("WorkspaceRead"),
    accessibleTitle: `${systemToolGroupTitle("WorkspaceRead")} · ${systemToolAction("WorkspaceRead")} · ${systemToolAction("WorkspaceGrep")} · ${systemToolAction("WorkspaceList")}`,
    summary: `${systemToolAction("WorkspaceRead")} · ${systemToolAction("WorkspaceGrep")} · ${systemToolAction("WorkspaceList")}`,
    icons: systemToolIcons(["WorkspaceRead", "WorkspaceGrep", "WorkspaceList"]),
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));
  expect(document.querySelector("[data-tool-batch-activity]")).toHaveTextContent(systemToolAction("WorkspaceRead"));
  expect(screen.queryByText("检查前端结构与运行入口。")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-batch-activity]")).toHaveAttribute("data-state", "done");
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
  expect(screen.getByText(systemToolAction("WorkspaceRead"))).toBeVisible();
  expect(screen.queryByText(systemToolAction("WorkspaceGrep"))).not.toBeInTheDocument();
  expect(screen.queryByText(systemToolAction("WorkspaceList"))).not.toBeInTheDocument();
  expect(screen.queryByText(systemToolGroupTitle("WorkspaceRead"))).not.toBeInTheDocument();
});

test("conversation tool stage mappings classify semantic and mixed tool batches", () => {
  const toolSearch = createToolBatchRun(["ToolSearch"]);
  toolSearch.steps.find((step) => step.toolName).status = "running";
  expect(projectToolStagePresentation(toolSearch)).toMatchObject({
    category: "tool-search",
    icon: systemToolIcon("ToolSearch"),
    mode: "single-tool",
    status: "running",
    title: systemToolAction("ToolSearch"),
  });

  expect(projectToolStagePresentation(createToolBatchRun(["ToolDescribe"]))).toMatchObject({
    category: "tool-describe",
    icon: systemToolIcon("ToolDescribe"),
    mode: "single-tool",
    title: systemToolAction("ToolDescribe"),
  });

  expect(projectToolStagePresentation(createToolBatchRun(["WorkspaceFind", "WorkspaceGrep"]))).toMatchObject({
    category: "workspace",
    icon: systemToolIcon("WorkspaceFind"),
    icons: systemToolIcons(["WorkspaceFind", "WorkspaceGrep"]),
    mode: "semantic-batch",
    status: "done",
    title: systemToolGroupTitle("WorkspaceFind"),
  });
  expect(projectToolStagePresentation(createToolBatchRun(["WorkspaceGrep", "ShellCommandTool"]))).toMatchObject({
    category: "tools",
    icon: systemToolIcon("WorkspaceGrep"),
    icons: systemToolIcons(["WorkspaceGrep", "ShellCommandTool"]),
    mode: "semantic-batch",
    status: "done",
    // The batch spans two presentation groups, so it names the first Tool rather
    // than enumerating every group it touches.
    title: systemToolAction("WorkspaceGrep"),
  });

  const failedSearch = createToolBatchRun(["WorkspaceGrep"]);
  failedSearch.steps.find((step) => step.toolName).status = "failed";
  expect(projectToolStagePresentation(failedSearch)).toMatchObject({
    category: "workspace-search",
    mode: "single-tool",
    status: "failed",
    title: systemToolAction("WorkspaceGrep"),
  });

  const mixedBatch = createToolBatchRun(["WorkspaceGrep", "WorkspaceFind", "WorkspaceRead"]);
  mixedBatch.steps.find((step) => step.toolName === "WorkspaceFind").status = "failed";
  expect(projectToolStagePresentation(mixedBatch)).toMatchObject({
    status: "done",
    title: systemToolGroupTitle("WorkspaceGrep"),
    summary: `${systemToolAction("WorkspaceGrep")} · ${systemToolAction("WorkspaceFind")} · ${systemToolAction("WorkspaceRead")}`,
    icons: systemToolIcons(["WorkspaceGrep", "WorkspaceFind", "WorkspaceRead"]),
    counts: { total: 3, settled: 3, completed: 2, failed: 1 },
  });

  const waitingBatch = createToolBatchRun(["WorkspaceGrep", "WorkspaceFind"]);
  waitingBatch.steps.find((step) => step.toolName === "WorkspaceGrep").status = "running";
  waitingBatch.steps.find((step) => step.toolName === "WorkspaceFind").status = "failed";
  expect(projectToolStagePresentation(waitingBatch)).toMatchObject({
    status: "running",
    title: systemToolGroupTitle("WorkspaceGrep"),
    accessibleTitle: `${systemToolGroupTitle("WorkspaceGrep")} · ${systemToolAction("WorkspaceGrep")} · ${systemToolAction("WorkspaceFind")}`,
    summary: `${systemToolAction("WorkspaceGrep")} · ${systemToolAction("WorkspaceFind")}`,
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
    origin: systemToolOrigin("WebSearch"),
    status: "failed",
    arguments: { query: longQuery },
  });
  expect(failedSearch.label.startsWith(`${systemToolAction("WebSearch")} ·`)).toBe(true);
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
    origin: systemToolOrigin("ShellCommandTool"),
    status: "completed",
    arguments: { script: "npm run check.types", cwd: "E:\\senera" },
  });
  expect(shell.label).toBe(`${systemToolAction("ShellCommandTool")} · npm run check.types · E:\\senera`);

  const system = projectToolActivityInspection({
    toolName: "CustomSystemTool",
    status: "failed",
    arguments: { path: "Source/AgentSystem", depth: 2, token: "must-not-display" },
  });
  expect(system.label).toContain("Use · CustomSystemTool · path=Source/AgentSystem · depth=2");
  expect(system.label).not.toContain("执行失败");
  expect(system.label).not.toContain("must-not-display");
});

test("tool activity targets use one arrow and link icons instead of dot separators", () => {
  const run = createToolBatchRun(["SeneraCommand"]);
  const step = run.steps.find((entry) => entry.toolName === "SeneraCommand");
  step.toolArgs = { command: "skills", action: "read", name: "frontend-experience-inspection" };

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  const label = document.querySelector("[data-tool-batch-activity-title]");
  expect(label).toBeInTheDocument();
  expect(label).toHaveTextContent("管理skillsreadfrontend-experience-inspection");
  expect(label).not.toHaveTextContent("·");
  expect(label?.querySelectorAll("[data-tool-activity-arrow]")).toHaveLength(1);
  expect(label?.querySelectorAll("[data-tool-activity-link]")).toHaveLength(2);
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

  expect(
    projectToolActivityInspection({
      toolName: "BrowserSnapshot",
      origin: systemToolOrigin("BrowserSnapshot"),
      status: "completed",
    }),
  ).toMatchObject({
    category: "browser-read",
    label: systemToolAction("BrowserSnapshot"),
  });
  expect(projectToolStagePresentation(run)).toMatchObject({
    category: "browser",
    icon: systemToolIcon("BrowserOpen"),
    icons: systemToolIcons([
      "BrowserOpen",
      "BrowserSnapshot",
      "BrowserClick",
      "BrowserWaitForLoad",
      "BrowserScreenshot",
      "BrowserTabClose",
      "BrowserClose",
    ]),
    mode: "semantic-batch",
    title: systemToolGroupTitle("BrowserOpen"),
    summary: `${systemToolAction("BrowserOpen")} · ${systemToolAction("BrowserSnapshot")} · ${systemToolAction("BrowserClick")} · ${systemToolAction("BrowserWaitForLoad")} · ${systemToolAction("BrowserScreenshot")} · ${systemToolAction("BrowserTabClose")} · ${systemToolAction("BrowserClose")}`,
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));
  expect(document.querySelector("[data-tool-batch-activity]")).toHaveTextContent(systemToolAction("BrowserOpen"));
});

test("visual browser tools have concrete activity and stage semantics", () => {
  expect(
    projectToolActivityInspection({
      toolName: "BrowserDownload",
      origin: systemToolOrigin("BrowserDownload"),
      status: "completed",
      arguments: { selector: "a.download" },
    }),
  ).toMatchObject({
    category: "browser-download",
    label: `${systemToolAction("BrowserDownload")} · a.download`,
  });
  expect(
    projectToolActivityInspection({
      toolName: "BrowserComputer",
      origin: systemToolOrigin("BrowserComputer"),
      status: "completed",
      arguments: { actions: [{ type: "click", x: 10, y: 20 }] },
    }),
  ).toMatchObject({
    category: "browser-computer",
    label: `${systemToolAction("BrowserComputer")} · click`,
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

  expect(document.querySelector("[data-tool-activity-trigger]")).toHaveClass("activity-feed-row");
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
    title: systemToolAction("WorkspaceRead"),
    icons: systemToolIcons([
      "WorkspaceRead",
      "WorkspaceGrep",
      "WorkspaceFind",
      "GitInspect",
      "ShellCommandTool",
      "AgentSpawn",
    ]),
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
  expect(document.querySelector("[data-tool-batch-activity]")).toHaveTextContent(systemToolAction("WorkspaceRead"));
  expect(document.querySelector("[data-tool-batch-activity-trigger]")).toHaveClass("activity-feed-row");
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
  expect(document.querySelector(".tool-activity-icon-face")).not.toBeInTheDocument();
});

test("conversation single-tool stages use one non-duplicated activity row", () => {
  const run = createToolBatchRun(["WorkspaceGrep"]);
  expect(projectToolStagePresentation(run)).toMatchObject({
    category: "workspace-search",
    mode: "single-tool",
    status: "done",
    title: systemToolAction("WorkspaceGrep"),
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));
  const stage = document.querySelector("[data-execution-stage-feed]");
  const summary = screen.getByRole("status", { name: systemToolAction("WorkspaceGrep") });
  expect(stage).toHaveAttribute("data-tool-stage-mode", "single-tool");
  expect(stage).toHaveClass("w-full");
  expect(
    summary.querySelector(
      `[data-tool-action-icon='${systemToolIcon("WorkspaceGrep")}'][data-tool-action-status='done']`,
    ),
  ).toBeInTheDocument();
  expect(summary.querySelector("[data-tool-batch-activity-trigger]")).not.toHaveAttribute("aria-expanded");
  expect(summary.querySelector(".lucide-check, .lucide-x")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
});

test("conversation tool stages use runtime provenance for shell and MCP wording", () => {
  const shellRun = createToolBatchRun(["ShellCommandTool"]);
  Object.assign(
    shellRun.steps.find((step) => step.toolName),
    {
      toolOrigin: systemToolOrigin("ShellCommandTool"),
      toolArgs: { mode: "shell", dialect: "powershell", script: "npm run check.types" },
    },
  );
  expect(projectToolStagePresentation(shellRun)).toMatchObject({
    icon: "terminal",
    title: `${systemToolAction("ShellCommandTool")} · npm run check.types`,
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
      toolOrigin: systemToolOrigin("WorkspaceGrep"),
      toolArgs: { pattern: "projectToolActivity" },
    },
  );
  expect(projectToolStagePresentation(grepRun)).toMatchObject({
    title: `${systemToolAction("WorkspaceGrep")} · projectToolActivity`,
  });

  const gitRun = createToolBatchRun(["GitInspect"]);
  Object.assign(
    gitRun.steps.find((step) => step.toolName),
    {
      toolOrigin: systemToolOrigin("GitInspect"),
      toolArgs: { operation: "diff" },
    },
  );
  expect(projectToolStagePresentation(gitRun)).toMatchObject({
    title: `${systemToolAction("GitInspect")} · diff`,
  });

  const agentRun = createToolBatchRun(["AgentSpawn"]);
  Object.assign(
    agentRun.steps.find((step) => step.toolName),
    {
      toolOrigin: systemToolOrigin("AgentSpawn"),
      toolArgs: { task: "Review the workflow", agent: "reviewer" },
    },
  );
  expect(projectToolStagePresentation(agentRun)).toMatchObject({
    title: `${systemToolAction("AgentSpawn")} · Review the workflow · reviewer`,
  });
});

test("every bundled system tool has a concrete activity action", () => {
  const genericTools = [...SystemToolOrigins]
    .filter(([, origin]) => origin.presentation === undefined)
    .map(([name]) => name);
  expect(genericTools).toEqual([]);
});

test("delegated child traces stay separate from task lists shown in the workflow panel", async () => {
  const user = userEvent.setup();
  const childScope = {
    parentSessionId: "session-a",
    parentRequestId: "run-delegation",
    childRunId: "child-1",
    agentName: "reviewer",
    role: "childAgent",
  };
  const run = createRun({
    requestId: "run-delegation",
    status: "running",
    endedAt: undefined,
    steps: [
      createStep({ id: "root-decision", kind: "decision", title: "Delegate review", status: "done" }),
      createStep({
        id: "child-run:child-1",
        kind: "delegation",
        title: "Running",
        status: "running",
        scope: childScope,
        childRun: {
          id: "child-1",
          status: "running",
          messages: [
            {
              id: "m1",
              direction: "child_to_parent",
              kind: "progress",
              content: "正在检查配置入口。",
              createdAt: "2026-07-11T00:00:01.000Z",
            },
          ],
          thinkingBlocks: [
            {
              id: "child-thinking-1",
              step: 4,
              messageIndex: 0,
              contentIndex: 1,
              eventSequence: 3,
              content: "子代理正在定位相关实现。",
              status: "streaming",
            },
          ],
          toolCalls: { planned: 2, started: 2, completed: 1, failed: 0 },
          activeTools: ["WorkspaceGrep"],
          todo: {
            planObserved: true,
            counts: { total: 3, pending: 1, inProgress: 1, completed: 1, cancelled: 0 },
            items: [
              { content: "读取配置入口", status: "completed" },
              { content: "检查配置", status: "in_progress" },
              { content: "汇总结果", status: "pending" },
            ],
          },
        },
      }),
      createStep({
        id: "tool-0",
        kind: "tool",
        agentStep: 4,
        modelMessageIndex: 0,
        modelContentIndex: 0,
        eventSequence: 2,
        startedSequence: 2,
        title: "Call WorkspaceRead",
        status: "done",
        toolName: "WorkspaceRead",
        callId: "call-0",
        scope: childScope,
      }),
      createStep({
        id: "tool-1",
        kind: "tool",
        agentStep: 4,
        modelMessageIndex: 0,
        modelContentIndex: 2,
        eventSequence: 4,
        startedSequence: 4,
        title: "Call WorkspaceGrep",
        status: "running",
        toolName: "WorkspaceGrep",
        callId: "call-1",
        scope: childScope,
      }),
    ],
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionFeed, { run }));

  const card = document.querySelector("[data-child-run-card]");
  expect(card).toBeInTheDocument();
  expect(card).toHaveAttribute("data-child-run-status", "running");
  expect(screen.getByText("reviewer")).toBeVisible();
  expect(screen.queryByText("子代理正在定位相关实现。")).not.toBeInTheDocument();
  expect(card.querySelector("[data-child-run-status-text]")).not.toHaveClass("motion-safe:animate-text-shimmer");
  expect(card.querySelector("[data-child-run-glyph] .senera-loading-pulse")).not.toBeInTheDocument();
  expect(card.querySelector("[data-child-run-live-update]")).not.toHaveClass("motion-safe:animate-text-shimmer");
  expect(card.querySelector("[data-child-run-live-update] [data-text-shimmer='true']")).toBeInTheDocument();

  // Task plans belong to the workflow panel, not to the conversation trace.
  expect(card.querySelector("[data-child-run-glyph]")).toBeInTheDocument();
  expect(card).not.toHaveTextContent(/1\/3/);
  expect(screen.queryByText(frontendMessage("chat.todoProgress.title"))).not.toBeInTheDocument();
  expect(screen.queryByText("读取配置入口")).not.toBeInTheDocument();
  expect(screen.queryByText("检查配置")).not.toBeInTheDocument();
  expect(screen.queryByText("汇总结果")).not.toBeInTheDocument();
  expect(document.querySelector("[data-workflow-task-progress]")).not.toBeInTheDocument();
  expect(screen.queryByText("WorkspaceRead")).not.toBeInTheDocument();
  expect(screen.queryByText("WorkspaceGrep")).not.toBeInTheDocument();
  expect(document.querySelector("[data-child-run-final-report]")).not.toBeInTheDocument();

  await user.click(card.querySelector("[data-child-run-card-trigger]"));

  await waitFor(() => expect(document.querySelector("[data-child-run-activity-details]")).toBeVisible());
  expect(document.querySelector("[data-child-run-todo]")).not.toBeInTheDocument();
  const body = document.querySelector("[data-child-run-activity-details]");
  expect(body).toBeInTheDocument();
  expect(body.className).not.toMatch(/max-h-/);
  expect(body.className).not.toMatch(/overflow-y-auto/);
  expect(document.querySelector("[data-tool-batch-activity]")).toBeInTheDocument();
  expect(body.querySelector("[data-tool-batch-activity-trigger]")).toBeInTheDocument();
  expect(body.querySelector("[data-tool-batch-activity-items]")).not.toBeInTheDocument();
  expect(
    [...body.querySelectorAll("[data-child-run-trace-item]")].map((item) =>
      item.getAttribute("data-child-run-trace-item"),
    ),
  ).toEqual(["tools", "thinking", "tools"]);
});

test("stage feed isolates child-run tools into cards so the parent batch stays readable", () => {
  const childScope = {
    parentSessionId: "session-a",
    parentRequestId: "run-stage",
    childRunId: "child-stage",
    agentName: "scout",
    role: "childAgent",
  };
  const run = createRun({
    requestId: "run-stage",
    status: "running",
    endedAt: undefined,
    steps: [
      createStep({
        id: "root-plan",
        kind: "tool",
        title: "Call WorkspaceSearch",
        status: "running",
        toolName: "WorkspaceSearch",
        callId: "call-root",
      }),
      createStep({
        id: "child-run:child-stage",
        kind: "delegation",
        title: "Running",
        status: "running",
        scope: childScope,
        childRun: {
          id: "child-stage",
          status: "running",
          messages: [],
          toolCalls: { planned: 2, started: 2, completed: 1, failed: 0 },
          activeTools: [],
          todo: { planObserved: true, counts: { total: 2, pending: 1, inProgress: 1, completed: 0, cancelled: 0 } },
        },
      }),
      createStep({
        id: "child-tool-0",
        kind: "tool",
        title: "Call WorkspaceRead",
        status: "done",
        toolName: "WorkspaceRead",
        callId: "call-child-0",
        scope: childScope,
      }),
      createStep({
        id: "child-tool-1",
        kind: "tool",
        title: "Call WorkspaceGrep",
        status: "running",
        toolName: "WorkspaceGrep",
        callId: "call-child-1",
        scope: childScope,
      }),
    ],
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  // 子代理内部工具被收进卡片，不再平铺进父代理的工具批次。
  expect(document.querySelector("[data-stage-child-run-cards]")).toBeInTheDocument();
  expect(screen.getByText("scout")).toBeVisible();
  const batchActivity = document.querySelector("[data-tool-batch-activity]");
  expect(batchActivity).toBeInTheDocument();
  expect(batchActivity).not.toHaveTextContent("WorkspaceRead");
  expect(batchActivity).not.toHaveTextContent("WorkspaceGrep");
});

test("all unfinished child agents shimmer independently in the workflow board", () => {
  const childRunStep = (id, name, status) =>
    createStep({
      id: `child-run:${id}`,
      kind: "delegation",
      title: name,
      status: "running",
      scope: {
        parentSessionId: "session-a",
        parentRequestId: "run-parallel-children",
        childRunId: id,
        agentName: name,
        role: "childAgent",
      },
      childRun: { id, status, messages: [], activeTools: [] },
    });
  const run = createRun({
    requestId: "run-parallel-children",
    status: "running",
    endedAt: undefined,
    steps: [childRunStep("child-a", "scout", "running"), childRunStep("child-b", "reviewer", "queued")],
  });

  renderWithFrontendProviders(React.createElement(ChildRunBoard, { run }));

  const liveActivities = [...document.querySelectorAll("[data-child-run-item] [data-live-activity-text]")];
  expect(liveActivities).toHaveLength(2);
  liveActivities.forEach((activity) => {
    expect(activity).toHaveClass("motion-safe:animate-text-shimmer");
  });
});

test("completed child run surfaces its final report inside the card", async () => {
  const user = userEvent.setup();
  const childScope = {
    parentSessionId: "session-a",
    parentRequestId: "run-done",
    childRunId: "child-done",
    agentName: "scout",
    role: "childAgent",
  };
  const run = createRun({
    requestId: "run-done",
    status: "done",
    endedAt: "2026-07-11T00:05:00.000Z",
    steps: [
      createStep({
        id: "child-run:child-done",
        kind: "delegation",
        title: "Completed",
        status: "done",
        scope: childScope,
        childRun: {
          id: "child-done",
          status: "completed",
          messages: [
            {
              id: "final",
              direction: "child_to_parent",
              kind: "response",
              content: "世界书入口共 3 处，已整理完毕。\n\n**已核对来源**。",
              createdAt: "2026-07-11T00:04:00.000Z",
            },
          ],
          toolCalls: { planned: 1, started: 1, completed: 1, failed: 0 },
          activeTools: [],
          todo: {
            planObserved: true,
            counts: { total: 2, pending: 0, inProgress: 0, completed: 2, cancelled: 0 },
            items: [
              { content: "定位入口", status: "completed" },
              { content: "整理报告", status: "completed" },
            ],
          },
        },
      }),
    ],
  });

  renderWithFrontendProviders(React.createElement(AgentExecutionFeed, { run }));
  const card = document.querySelector("[data-child-run-card]");
  expect(card).toHaveAttribute("data-child-run-status", "completed");
  expect(document.querySelector("[data-child-run-final-report]")).not.toBeInTheDocument();

  await user.click(card.querySelector("[data-child-run-card-trigger]"));

  // 完成后最终反馈写入卡片专属区域。
  await waitFor(() => expect(document.querySelector("[data-child-run-final-report]")).toBeInTheDocument());
  expect(document.querySelector("[data-child-run-final-report]")).toHaveTextContent(/世界书入口共 3 处/);
  await waitFor(() =>
    expect(document.querySelector("[data-child-run-final-report] strong")).toHaveTextContent("已核对来源"),
  );
});
