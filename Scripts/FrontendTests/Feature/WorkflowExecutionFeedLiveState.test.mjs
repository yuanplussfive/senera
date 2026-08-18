import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";

const { AgentExecutionFeed, AgentExecutionStageFeed } =
  await import("../../../Frontend/src/features/workflow/AgentExecutionFeed.tsx");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");
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

  expect(screen.getByText("Thinking...")).toBeVisible();
  expect(screen.queryByText("1分钟5秒")).not.toBeInTheDocument();
  expect(document.querySelector("[data-feed-elapsed]")).not.toBeInTheDocument();
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

test("active tool stages keep their action icon and a running child row without per-row elapsed time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T00:01:05.000Z"));
  const run = createToolBatchRun(["WorkspaceGrep"]);
  const toolStep = run.steps.find((step) => step.toolName === "WorkspaceGrep");
  toolStep.status = "running";
  toolStep.startedAt = "2026-07-11T00:00:00.000Z";

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run }));

  expect(screen.getByRole("status", { name: "Search" })).toBeVisible();
  expect(screen.queryByText("1分钟5秒")).not.toBeInTheDocument();
  expect(
    document.querySelector("[data-tool-action-icon='search'][data-tool-action-status='running']"),
  ).toBeInTheDocument();
  expect(
    document.querySelector("[data-tool-batch-activity-item][data-state='loading'] .motion-safe\\:animate-spin"),
  ).toBeInTheDocument();
});

test("live tool stage remains visible while the next decision is pending", () => {
  const run = createToolBatchRun(["WorkspaceGrep"]);
  run.steps.find((step) => step.toolName).status = "done";
  run.status = "running";
  run.outputState = "pending";
  run.visibleKind = "tool_calls";

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run, keepOpenWhileRunActive: true }));

  expect(document.querySelector("[data-tool-batch-activity]")).toHaveAttribute("data-state", "done");
  expect(document.querySelector("[data-tool-batch-activity-trigger]")).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelector("[data-tool-batch-activity-items]")).toBeVisible();
  expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
});

test("tool chains keep evidence resources out of the activity rows", () => {
  const run = createToolBatchRun(["WebSearch"]);
  const step = run.steps.find((candidate) => candidate.toolName === "WebSearch");
  step.toolArgs = { query: "research article" };
  step.toolPresentation = {
    evidence: [
      {
        locator: "https://example.com/research",
        display: "Research article",
        label: "Research article",
        source: "A concise summary from the original search result.",
      },
      {
        locator: "https://example.com/research",
        display: "https://example.com/research",
        label: "Source",
        source: "WebSearch result",
      },
    ],
  };

  renderWithFrontendProviders(React.createElement(AgentExecutionStageFeed, { run, keepOpenWhileRunActive: true }));

  const item = document.querySelector("[data-tool-batch-activity-item]");
  expect(item).toHaveTextContent("Search · research article");
  expect(item).not.toHaveTextContent("Research article");
  expect(item).not.toHaveTextContent("Source");
  expect(document.querySelectorAll("[data-tool-batch-activity-item]")).toHaveLength(1);
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
  expect(screen.queryByText("1分钟5秒")).not.toBeInTheDocument();
  expect(document.querySelector("[data-feed-elapsed]")).not.toBeInTheDocument();
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
