import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";

const { ThinkingTimeline } = await import("../../../Frontend/src/features/workflow/ThinkingTimeline.tsx");
const {
  ThinkingTimelineCanvas,
  readInitialWorkflowViewportMode,
  readStartWorkflowViewport,
  readWorkflowViewportTarget,
} = await import("../../../Frontend/src/features/workflow/ThinkingTimelineCanvas.tsx");
const { StepNode } = await import("../../../Frontend/src/features/workflow/StepNode.tsx");
const { layoutSteps, readWorkflowLayoutKey } = await import("../../../Frontend/src/features/workflow/layout.ts");
const { ChatHeader } = await import("../../../Frontend/src/features/chat/ChatHeader.tsx");
const { ThinkingSummaryBar } = await import("../../../Frontend/src/features/chat/ThinkingSummaryBar.tsx");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");
const { Position, ReactFlowProvider } = await import("@xyflow/react");
const { useStore } = await import("../../../Frontend/src/store/sessionStore.ts");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { frontendFeatureMessage } = await import("../../../Frontend/src/i18n/frontendFeatureMessageCatalog.ts");
const { projectWorkflowActivities, projectWorkflowSteps } =
  await import("../../../Frontend/src/features/workflow/workflowPresentationProjection.ts");
const { createRun, createSession, createStep, createToolBatchRun, viewportNode, workflowNodeData, workflowNodeLayout } =
  await import("./workflowComponentFixtures.mjs");

function renderWorkflowNode(props) {
  return renderWithFrontendProviders(
    React.createElement(ReactFlowProvider, null, React.createElement(StepNode, props)),
  );
}

beforeEach(() => {
  installMemoryLocalStorage();
  resetFrontendStore();
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("thinking timeline renders its empty state and opens a focused workflow view", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(ThinkingTimeline, { presentation: "panel" }));

  expect(screen.getByText(frontendMessage("workflow.panel.emptyTitle"))).toBeInTheDocument();
  const focusButton = screen.getByRole("button", { name: frontendMessage("workflow.panel.focus") });
  expect(focusButton).toHaveClass("text-content-muted");
  expect(document.querySelector("[data-workflow-execution-content]")).toContainElement(focusButton);
  expect(document.querySelector("[data-window-drag-region]")).not.toContainElement(focusButton);
  await user.click(focusButton);
  expect(screen.getByRole("dialog", { name: frontendMessage("workflow.panel.title") })).toBeInTheDocument();
});

test("completed run summary keeps disclosure semantics when motion is disabled", async () => {
  const user = userEvent.setup();
  const run = createRun({ steps: [createStep({ title: "Inspect projected context" })] });
  renderWithFrontendProviders(
    React.createElement(AppMotionProvider, { level: "none" }, React.createElement(ThinkingSummaryBar, { run })),
  );

  const trigger = document.querySelector("[data-ui-chrome] button[aria-expanded]");
  expect(trigger).toBeInstanceOf(HTMLButtonElement);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveAccessibleName("Thinking 2.0s");
  expect(trigger).not.toHaveTextContent("1 步");

  await user.click(trigger);

  const disclosureId = trigger.getAttribute("aria-controls");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(disclosureId).not.toBeNull();
  await waitFor(() =>
    expect(document.getElementById(disclosureId)).toContainElement(screen.getByText("本轮未调用工具")),
  );
  expect(screen.queryByText(frontendMessage("workflow.summary.viewFull"))).not.toBeInTheDocument();

  await user.click(trigger);
  await waitFor(() => expect(document.getElementById(disclosureId)).not.toBeInTheDocument());
});

test("live run summary uses the quiet Thinking label without completed-run chrome", () => {
  const run = createRun({ status: "running", endedAt: undefined });
  renderWithFrontendProviders(React.createElement(ThinkingSummaryBar, { run, presentation: "live-final-answer" }));

  const trigger = document.querySelector("[data-ui-chrome] button[aria-expanded]");
  expect(trigger).toHaveAccessibleName("Thinking...");
  expect(trigger).toHaveTextContent("Thinking...");
  expect(trigger).not.toHaveTextContent("2.0s");
  expect(trigger?.querySelector(".lucide-chevron-down")).not.toBeInTheDocument();
});

test("thinking summary expands tool rounds through the shared batch activity", async () => {
  const user = userEvent.setup();
  const run = createToolBatchRun(["WorkspaceRead", "WorkspaceRead", "WorkspaceGrep"]);
  run.status = "completed";
  run.endedAt = "2026-07-11T00:00:05.000Z";
  run.steps.find((step) => step.toolName === "WorkspaceGrep").status = "failed";
  run.steps.find((step) => step.kind === "model").status = "done";

  renderWithFrontendProviders(React.createElement(ThinkingSummaryBar, { run }));
  await user.click(document.querySelector("[data-ui-chrome] button[aria-expanded]"));

  const trigger = await waitFor(() => {
    const element = document.querySelector("[data-tool-batch-activity-trigger]");
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element;
  });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);

  await waitFor(() => expect(document.querySelectorAll("[data-tool-batch-activity-item]")).toHaveLength(3));
  expect(document.querySelectorAll("[data-tool-batch-activity-item][data-state='done']")).toHaveLength(2);
  expect(document.querySelector("[data-tool-batch-activity-item][data-state='failed']")).toBeInTheDocument();
  expect(screen.queryByText(frontendMessage("workflow.summary.viewFull"))).not.toBeInTheDocument();
});

test("thinking summary keeps sequential tools in one collapsible batch", async () => {
  const user = userEvent.setup();
  const run = createRun({
    steps: [
      createStep({ id: "read", kind: "tool", toolName: "WorkspaceRead", status: "done" }),
      createStep({ id: "shell", kind: "tool", toolName: "ShellCommandTool", status: "done" }),
    ],
  });

  renderWithFrontendProviders(React.createElement(ThinkingSummaryBar, { run }));
  await user.click(document.querySelector("[data-ui-chrome] button[aria-expanded]"));

  const trigger = await waitFor(() => {
    const element = document.querySelector("[data-tool-batch-activity-trigger]");
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element;
  });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);

  await waitFor(() => expect(document.querySelectorAll("[data-tool-batch-activity-item]")).toHaveLength(2));
  expect(document.querySelector("[data-thinking-tool-popover]")).toHaveClass(
    "thinking-tool-popover",
    "overflow-hidden",
  );
  expect(document.querySelector("[data-tool-batch-activity]").parentElement).toHaveClass(
    "thinking-tool-popover__body",
    "overflow-y-auto",
    "scrollbar-thin",
  );
});

test("thinking summary keeps web search evidence out of the tool chain", async () => {
  const user = userEvent.setup();
  const run = createRun({
    steps: [
      createStep({
        id: "web-search",
        kind: "tool",
        toolName: "WebSearch",
        status: "done",
        toolArgs: { query: "React security guidance" },
        toolResult: {
          query: "React security guidance",
          results: [
            {
              title: "React security overview",
              url: "https://react.dev/learn/keeping-components-pure",
              citationId: "cite-react",
            },
          ],
        },
      }),
    ],
  });

  renderWithFrontendProviders(React.createElement(ThinkingSummaryBar, { run }));
  await user.click(document.querySelector("[data-ui-chrome] button[aria-expanded]"));

  const trigger = await waitFor(() => {
    const element = document.querySelector("[data-tool-batch-activity-trigger]");
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element;
  });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);

  await waitFor(() => expect(document.querySelector("[data-tool-batch-activity-items]")).toBeVisible());
  expect(document.querySelector("[data-tool-batch-activity-item]")).toHaveTextContent(
    "Search · React security guidance",
  );
  expect(screen.queryByText("React security overview")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-batch-activity-item] a")).not.toBeInTheDocument();
});

test("expanding the workflow keeps the dock vertical and opens a horizontal canvas", async () => {
  const run = createRun({
    requestId: "run-layout-direction",
    steps: [createStep({ id: "layout-step", title: "Inspect layout direction" })],
  });
  resetFrontendStore({
    activeSessionId: "session-a",
    sessionOrder: ["session-a"],
    sessions: {
      "session-a": createSession([run]),
    },
  });
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(ThinkingTimeline, { presentation: "panel" }));

  await waitFor(() =>
    expect(
      document.querySelector("[data-workflow-canvas-pan='vertical'][data-workflow-layout-direction='vertical']"),
    ).toBeInTheDocument(),
  );

  await user.click(screen.getByRole("button", { name: frontendMessage("workflow.panel.focus") }));

  await waitFor(() =>
    expect(
      document.querySelector("[data-workflow-canvas-pan='free'][data-workflow-layout-direction='horizontal']"),
    ).toBeInTheDocument(),
  );
  expect(
    document.querySelector("[data-workflow-canvas-pan='vertical'][data-workflow-layout-direction='vertical']"),
  ).toBeInTheDocument();
});

test("chat header exposes one neutral workflow tool entry for panel toggling", async () => {
  const onToggle = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(ChatHeader, {
      title: "Workflow tool test",
      onOpenWorkflowPanel: onToggle,
    }),
  );

  const expandButton = screen.getByRole("button", { name: frontendMessage("workflow.panel.expand") });
  expect(document.querySelector("[data-workflow-dock]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-workspace-tool-dock]")).toContainElement(expandButton);
  expect(document.querySelector("[data-window-controls-inset]")).toBeInTheDocument();
  expect(expandButton).toHaveAttribute("aria-expanded", "false");
  expect(expandButton.className).not.toMatch(/terra|blue|indigo|violet/);
  await user.click(expandButton);
  expect(onToggle).toHaveBeenCalledTimes(1);
});

test("chat header leaves execution environment details to settings", () => {
  renderWithFrontendProviders(React.createElement(ChatHeader, { title: "Focused conversation" }));

  expect(screen.getByRole("heading", { name: "Focused conversation" })).toBeVisible();
  expect(document.querySelector("[data-sandbox-status]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-execution-mode]")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: frontendMessage("terminal.panel.open") })).not.toBeInTheDocument();
});

test("persistent workflow panel owns its tool header and only collapse control", async () => {
  const onClosePanel = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(ThinkingTimeline, { onClosePanel }));

  const collapseButton = screen.getByRole("button", { name: frontendMessage("workflow.panel.collapse") });
  expect(screen.getAllByRole("button", { name: frontendMessage("workflow.panel.collapse") })).toHaveLength(1);
  expect(document.querySelector("[data-workspace-tool-dock]")).toContainElement(
    screen.getByText(frontendMessage("workflow.panel.title")),
  );
  await user.click(collapseButton);
  expect(onClosePanel).toHaveBeenCalledTimes(1);
});

test("dock execution view hides its composed title and keeps a flat run summary", () => {
  const run = createRun({
    requestId: "run-dock",
    input: "Inspect the new dock prototype",
    steps: [createStep({ id: "dock-step", title: "Compare the expanded layout" })],
  });
  resetFrontendStore({
    activeSessionId: "session-a",
    sessionOrder: ["session-a"],
    sessions: {
      "session-a": createSession([run]),
    },
  });

  renderWithFrontendProviders(
    React.createElement(ThinkingTimeline, {
      presentation: "dock",
      hidePanelTitle: true,
    }),
  );

  expect(document.querySelector("[data-workspace-tool-dock]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-window-drag-region]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-workflow-run-summary]")).toHaveClass("border-b", "border-line-subtle");
  expect(document.querySelector("[data-workflow-run-summary]")).not.toHaveClass("rounded-[14px]", "bg-surface-raised");
  expect(document.querySelector("[data-workflow-run-status='completed']")).toHaveClass("text-content-muted");
  expect(document.querySelector("[data-workflow-run-status='completed'] .lucide-list-tree")).toBeInTheDocument();
});

test("dock execution view renders a vertical workflow graph with expandable complete node details", async () => {
  const user = userEvent.setup();
  const run = createRun({
    requestId: "run-child-board",
    status: "running",
    endedAt: undefined,
    steps: [
      createStep({
        id: "child-reviewer",
        kind: "delegation",
        title: "Running",
        status: "running",
        scope: { childRunId: "child-reviewer", agentName: "reviewer", role: "childAgent" },
        childRun: {
          id: "child-reviewer",
          status: "running",
          activeTools: ["WorkspaceGrep"],
          checkpointAvailable: true,
          lastActivityAt: "2026-07-11T00:00:01.000Z",
          toolCalls: { planned: 3, started: 2, completed: 1, failed: 0 },
          messages: [],
        },
      }),
      createStep({
        id: "tool-read",
        kind: "tool",
        title: "WorkspaceRead",
        toolName: "WorkspaceRead",
        toolOrigin: { kind: "system", name: "Workspace tools", capability: "workspace.file.read" },
        toolArgs: { path: "Source/runtime.ts" },
        toolResult: { content: "export const runtime = true;" },
      }),
    ],
  });
  resetFrontendStore({
    activeSessionId: "session-a",
    sessionOrder: ["session-a"],
    sessions: { "session-a": createSession([run]) },
  });

  renderWithFrontendProviders(React.createElement(ThinkingTimeline, { presentation: "dock", hidePanelTitle: true }));

  await waitFor(() => expect(document.querySelector("[data-workflow-dock-graph]")).toBeInTheDocument());
  expect(screen.getByText(/reviewer/)).toBeInTheDocument();
  expect(screen.getByText(/WorkspaceGrep/)).toBeInTheDocument();
  expect(screen.queryByText(frontendMessage("workflow.childRun.board.title"))).not.toBeInTheDocument();
  expect(screen.queryByText(frontendMessage("workflow.childRun.board.empty"))).not.toBeInTheDocument();
  expect(
    document.querySelector("[data-workflow-dock-step='tool-read'] [data-tool-action-icon='file-text']"),
  ).toBeInTheDocument();
  expect(document.querySelector("[data-workflow-dock-step='tool-read'] .lucide-check")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /展开WorkspaceRead/ }));
  await waitFor(() => expect(document.querySelector("[data-tool-step-inspector]")).toBeInTheDocument());
  expect(screen.getByText(frontendFeatureMessage("workflow.inspector.action"))).toBeVisible();
  expect(screen.getByText(frontendFeatureMessage("workflow.inspector.result"))).toBeVisible();
  expect(screen.queryByText(frontendFeatureMessage("workflow.inspector.scope"))).not.toBeInTheDocument();
  expect(screen.getByText("Source/runtime.ts")).toBeVisible();
  expect(document.querySelector("[data-tool-inspector-section='action']")).toHaveTextContent("path");
  expect(document.querySelector("[data-tool-inspector-section='result']")).toHaveTextContent(
    "export const runtime = true;",
  );
  expect(screen.queryByText(frontendMessage("workflow.node.section.toolArgs"))).not.toBeInTheDocument();
  expect(screen.queryByText(frontendMessage("workflow.node.section.rawToolResult"))).not.toBeInTheDocument();
  expect(
    document.querySelector("[data-workflow-dock-step='tool-read'] [data-tool-step-inspector]")?.parentElement,
  ).toHaveClass("border-l", "border-line-subtle");
  expect(
    document.querySelector("[data-workflow-dock-step='tool-read'] [data-tool-step-inspector]")?.parentElement,
  ).not.toHaveClass("rounded-md", "bg-surface-subtle/35");
  expect(document.querySelector(".react-flow")).not.toBeInTheDocument();
});

test("thinking timeline pins a historical run and can return to the latest run", async () => {
  const oldRun = createRun({
    requestId: "run-old",
    input: "old input",
    steps: [createStep({ id: "old-step", title: "Old workflow step" })],
  });
  const latestRun = createRun({
    requestId: "run-latest",
    input: "latest input",
    status: "running",
    steps: [createStep({ id: "latest-step", title: "Latest workflow step" })],
  });
  resetFrontendStore({
    activeSessionId: "session-a",
    sessionOrder: ["session-a"],
    sessions: {
      "session-a": createSession([oldRun, latestRun]),
    },
    viewedRunIdBySession: { "session-a": "run-old" },
  });
  const user = userEvent.setup();
  renderWithFrontendProviders(React.createElement(ThinkingTimeline, { presentation: "panel" }));

  expect(screen.getByText("old input")).toBeVisible();
  await user.click(screen.getByRole("button", { name: frontendMessage("workflow.panel.followLatest") }));

  expect(useStore.getState().viewedRunIdBySession["session-a"]).toBeUndefined();
  expect(await screen.findByText("latest input")).toBeVisible();
});

test("thinking timeline canvas lays out and renders real workflow nodes", async () => {
  const run = createRun({
    steps: [
      createStep({ id: "understand", kind: "understand", title: "Understand request" }),
      createStep({ id: "answer", kind: "answer", title: "Return answer" }),
    ],
  });
  renderWithFrontendProviders(React.createElement(ThinkingTimelineCanvas, { run }));

  expect(await screen.findByText("Understand request")).toBeInTheDocument();
  expect(screen.getByText("Return answer")).toBeInTheDocument();
  expect(document.querySelectorAll(".react-flow__node")).toHaveLength(2);
  expect(document.querySelector("[data-workflow-canvas-pan]")).toHaveAttribute("data-workflow-canvas-pan", "vertical");
  expect(document.querySelector("[data-workflow-canvas-bounds]")).toHaveAttribute(
    "data-workflow-canvas-bounds",
    "content",
  );
  expect(document.querySelector("[data-workflow-layout-direction='vertical']")).toBeInTheDocument();
});

test("workflow presentation keeps context tokens and errors while filtering model lifecycle telemetry", () => {
  const run = createRun({
    steps: [
      createStep({ id: "request", kind: "understand", title: "User request" }),
      createStep({
        id: "tokens",
        kind: "prompt",
        title: "Context tokens",
        description: "22967 tokens · 100000 chars · 3200 lines",
        promptTokenCount: 22_967,
      }),
      createStep({ id: "model", kind: "model", title: "Generate response" }),
      createStep({ id: "failure", kind: "error", title: "Request failed", status: "failed" }),
    ],
    activities: [
      {
        id: "context",
        activity: "preparing_context",
        status: "done",
        startedAt: "2026-07-11T00:00:00.000Z",
        endedAt: "2026-07-11T00:00:00.100Z",
      },
      {
        id: "compaction",
        activity: "compacting_context",
        status: "running",
        startedAt: "2026-07-11T00:00:01.000Z",
      },
      {
        id: "finalize-failure",
        activity: "finalizing_response",
        status: "failed",
        startedAt: "2026-07-11T00:00:02.000Z",
        endedAt: "2026-07-11T00:00:03.000Z",
      },
    ],
  });

  expect(projectWorkflowSteps(run).map((step) => step.id)).toEqual(["request", "tokens", "failure"]);
  expect(projectWorkflowActivities(run).map((activity) => activity.id)).toEqual(["compaction", "finalize-failure"]);
});

test("workflow presentation folds model duration into the visible reply and removes duplicate answer traces", () => {
  const run = createRun({
    steps: [
      createStep({
        id: "history-answer",
        kind: "answer",
        title: "Generate response",
        decisionKind: "final_answer",
        startedAt: "2026-07-11T00:00:00.000Z",
        endedAt: "2026-07-11T00:00:27.000Z",
      }),
      createStep({ id: "request", kind: "understand", title: "User request" }),
      createStep({ id: "tokens", kind: "prompt", title: "Context tokens", promptTokenCount: 629 }),
      createStep({
        id: "model",
        kind: "model",
        title: "Generate response",
        startedAt: "2026-07-11T00:00:01.000Z",
        endedAt: "2026-07-11T00:00:03.500Z",
      }),
      createStep({
        id: "assistant-answer",
        kind: "answer",
        title: "Generate response",
        description: "Done.",
        decisionKind: "final_answer",
        startedAt: "2026-07-11T00:00:03.500Z",
        endedAt: "2026-07-11T00:00:03.500Z",
      }),
    ],
  });

  const steps = projectWorkflowSteps(run);
  expect(steps.map((step) => step.id)).toEqual(["request", "tokens", "assistant-answer"]);
  expect(steps.at(-1)).toMatchObject({
    startedAt: "2026-07-11T00:00:03.500Z",
    endedAt: "2026-07-11T00:00:03.500Z",
    durationMs: 2500,
  });
});

test("workflow presentation preserves a unique historical answer duration when model timing is unavailable", () => {
  const run = createRun({
    steps: [
      createStep({
        id: "history-answer",
        kind: "answer",
        title: "Generate response",
        decisionKind: "final_answer",
        startedAt: "2026-07-11T00:00:00.000Z",
        endedAt: "2026-07-11T00:00:27.000Z",
      }),
      createStep({
        id: "assistant-answer",
        kind: "answer",
        title: "Generate response",
        description: "Done.",
        decisionKind: "final_answer",
        startedAt: "2026-07-11T00:00:27.000Z",
        endedAt: "2026-07-11T00:00:27.000Z",
      }),
    ],
  });

  expect(projectWorkflowSteps(run)).toEqual([
    expect.objectContaining({
      id: "assistant-answer",
      startedAt: "2026-07-11T00:00:27.000Z",
      endedAt: "2026-07-11T00:00:27.000Z",
      durationMs: 27_000,
    }),
  ]);
});

test("instantaneous workflow records do not present a misleading zero duration", () => {
  renderWorkflowNode({
    data: {
      layout: workflowNodeLayout("vertical"),
      kind: "step",
      step: createStep({
        id: "context-tokens",
        kind: "prompt",
        title: "Context tokens",
        description: "22967 tokens",
        startedAt: "2026-07-11T00:00:00.000Z",
        endedAt: "2026-07-11T00:00:00.000Z",
      }),
    },
    selected: false,
  });

  expect(screen.getByText("22967 tokens")).toBeVisible();
  expect(screen.queryByText("0ms")).not.toBeInTheDocument();
});

test("focused workflow canvas uses a horizontal layout with free panning", async () => {
  const run = createRun({
    steps: [createStep({ id: "focused", title: "Inspect focused workflow" })],
  });
  renderWithFrontendProviders(
    React.createElement(ThinkingTimelineCanvas, { run, focusVersion: 1, layoutDirection: "horizontal" }),
  );

  expect(await screen.findByText("Inspect focused workflow")).toBeInTheDocument();
  expect(document.querySelector("[data-workflow-canvas-pan]")).toHaveAttribute("data-workflow-canvas-pan", "free");
  expect(document.querySelector("[data-workflow-canvas-bounds]")).toHaveAttribute(
    "data-workflow-canvas-bounds",
    "unbounded",
  );
  expect(document.querySelector("[data-workflow-layout-direction='horizontal']")).toBeInTheDocument();
});

test("workflow graph switches its rank direction and connection anchors as one layout contract", () => {
  const steps = [createStep({ id: "first", title: "First" }), createStep({ id: "second", title: "Second" })];
  const vertical = layoutSteps(steps, "vertical");
  const horizontal = layoutSteps(steps, "horizontal");

  expect(vertical.nodes[1].position.y).toBeGreaterThan(vertical.nodes[0].position.y);
  expect(vertical.nodes[1].position.x).toBe(vertical.nodes[0].position.x);
  expect(vertical.nodes[0]).toMatchObject({
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: { layout: { direction: "vertical" } },
  });

  expect(horizontal.nodes[1].position.x).toBeGreaterThan(horizontal.nodes[0].position.x);
  expect(horizontal.nodes[1].position.y).toBe(horizontal.nodes[0].position.y);
  expect(horizontal.nodes[0]).toMatchObject({
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { layout: { direction: "horizontal" } },
  });
});

test("parallel tool batches fan out as complete graph branches instead of a compressed lane", () => {
  const { nodes, edges } = layoutSteps(createToolBatchRun(["WorkspaceFind", "WorkspaceRead"]).steps, "vertical");
  const batchNodes = nodes.filter(
    (node) =>
      node.data.kind === "step" &&
      node.data.step.toolBatch?.id === "batch-actions" &&
      node.data.step.toolBatch.index !== undefined,
  );
  expect(batchNodes.length).toBeGreaterThan(1);
  expect(new Set(batchNodes.map((node) => node.position.y)).size).toBe(1);
  expect(new Set(batchNodes.map((node) => node.position.x)).size).toBe(batchNodes.length);
  expect(
    batchNodes.every((node) => edges.some((edge) => edge.source === "batch-plan" && edge.target === node.id)),
  ).toBe(true);
  expect(
    batchNodes.every((node) => edges.some((edge) => edge.source === node.id && edge.target === "compose-answer")),
  ).toBe(true);
  expect(edges.some((edge) => edge.source === batchNodes[0].id && edge.target === batchNodes[1].id)).toBe(false);
});

test("dock workflow graph compresses a parallel batch only until the user expands it", async () => {
  const user = userEvent.setup();
  const run = createToolBatchRun(["WorkspaceFind", "WorkspaceRead"]);
  resetFrontendStore({
    activeSessionId: "session-a",
    sessionOrder: ["session-a"],
    sessions: { "session-a": createSession([run]) },
  });

  renderWithFrontendProviders(React.createElement(ThinkingTimeline, { presentation: "dock", hidePanelTitle: true }));

  const batch = await screen.findByRole("button", { name: /展开2 次工具调用/ });
  expect(document.querySelectorAll("[data-workflow-dock-batch]")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /展开WorkspaceFind/ })).not.toBeInTheDocument();
  await user.click(batch);
  expect(screen.getByRole("button", { name: /展开WorkspaceFind/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /展开WorkspaceRead/ })).toBeVisible();
});

test("dock workflow graph represents partial batch failures proportionally", () => {
  const toolNames = Array.from({ length: 13 }, (_value, index) => `WorkspaceRead${index}`);
  const run = createToolBatchRun(toolNames);
  run.steps.find((step) => step.toolName === "WorkspaceRead12").status = "failed";
  resetFrontendStore({
    activeSessionId: "session-a",
    sessionOrder: ["session-a"],
    sessions: { "session-a": createSession([run]) },
  });

  renderWithFrontendProviders(React.createElement(ThinkingTimeline, { presentation: "dock", hidePanelTitle: true }));

  const succeeded = document.querySelector("[data-workflow-batch-segment='done']");
  const failed = document.querySelector("[data-workflow-batch-segment='failed']");
  expect(succeeded).toHaveAttribute("data-count", "12");
  expect(succeeded).toHaveStyle({ width: `${(12 / 13) * 100}%` });
  expect(failed).toHaveAttribute("data-count", "1");
  expect(failed).toHaveStyle({ width: `${(1 / 13) * 100}%` });
  expect(document.querySelector("[data-tool-action-warning]")).not.toBeInTheDocument();
  expect(screen.queryByText("1 项失败")).not.toBeInTheDocument();
  expect(screen.queryByText("成功 12")).not.toBeInTheDocument();
  expect(screen.queryByText("13/13")).not.toBeInTheDocument();
  expect(document.querySelector("[data-assistant-ui-tool-group]")).not.toBeInTheDocument();
});

test("workflow layout key ignores live status but tracks dimension changes", () => {
  const base = {
    id: "tool-1",
    kind: "tool",
    title: "Read",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    callId: "call-1",
  };

  expect(readWorkflowLayoutKey([base])).toBe(readWorkflowLayoutKey([{ ...base, status: "done" }]));
  expect(readWorkflowLayoutKey([base])).not.toBe(
    readWorkflowLayoutKey([{ ...base, description: "A description that changes the estimated node height." }]),
  );
});

test("workflow viewport starts terminal runs at the beginning and follows live runs at the latest step", () => {
  const nodes = [
    viewportNode("scope", { kind: "scope", group: { status: "done" } }),
    viewportNode("first", { kind: "step", step: createStep({ id: "first", status: "done" }) }),
    viewportNode("running", { kind: "step", step: createStep({ id: "running", status: "running" }) }),
    viewportNode("queued", { kind: "step", step: createStep({ id: "queued", status: "pending" }) }),
  ];

  expect(readInitialWorkflowViewportMode("completed")).toBe("start");
  expect(readInitialWorkflowViewportMode("failed")).toBe("start");
  expect(readInitialWorkflowViewportMode("cancelled")).toBe("start");
  expect(readInitialWorkflowViewportMode("running")).toBe("latest");
  expect(readWorkflowViewportTarget(nodes, "start")?.id).toBe("first");
  expect(readWorkflowViewportTarget(nodes, "latest")?.id).toBe("running");
  const startViewport = readStartWorkflowViewport(
    {
      position: { x: 100, y: 200 },
      data: workflowNodeData("vertical", 240, 100),
    },
    { width: 300, height: 400 },
    "vertical",
  );
  expect(startViewport.x + (100 + 120) * startViewport.zoom).toBeCloseTo(150);
  expect(startViewport.y + 200 * startViewport.zoom).toBeCloseTo(24);

  const horizontalStartViewport = readStartWorkflowViewport(
    {
      position: { x: 100, y: 200 },
      data: workflowNodeData("horizontal", 240, 100),
    },
    { width: 800, height: 400 },
    "horizontal",
  );
  expect(horizontalStartViewport.x + 100 * horizontalStartViewport.zoom).toBeCloseTo(24);
  expect(horizontalStartViewport.y + (200 + 50) * horizontalStartViewport.zoom).toBeCloseTo(200);
});

test("step node presents failed tool identity, error, status, and duration", () => {
  renderWorkflowNode({
    data: {
      layout: workflowNodeLayout("vertical"),
      kind: "step",
      step: createStep({
        kind: "tool",
        status: "failed",
        title: "Execute shell",
        description: "Run the verification command",
        callId: "call_1234567890abcdef",
        toolErrorMessage: "process exited with code 1",
        endedAt: "2026-07-11T00:00:02.000Z",
      }),
    },
    selected: true,
  });

  expect(screen.getByText("Execute shell")).toBeVisible();
  expect(screen.getByText("Run the verification command")).toBeVisible();
  expect(screen.getByText("call_1234567")).toBeVisible();
  expect(screen.getByText("process exited with code 1")).toBeVisible();
  expect(screen.getByText("2.0s")).toBeVisible();
  expect(document.querySelectorAll(".react-flow__handle")).toHaveLength(2);
});

test("step node presents running steps and grouped child-agent scopes", () => {
  const view = renderWorkflowNode({
    data: {
      layout: workflowNodeLayout("vertical"),
      kind: "step",
      step: createStep({ status: "running", title: "Calling model" }),
    },
    selected: false,
  });
  expect(screen.getByText(frontendMessage("workflow.node.runningLive"))).toBeVisible();

  view.rerender(
    React.createElement(
      ReactFlowProvider,
      null,
      React.createElement(StepNode, {
        data: {
          layout: workflowNodeLayout("horizontal"),
          kind: "scope",
          group: {
            id: "scope-research",
            label: "子代理 · researcher",
            description: "Research workflow",
            status: "running",
          },
        },
        selected: false,
      }),
    ),
  );
  expect(screen.getByText("子代理 · researcher")).toBeVisible();
  expect(screen.getByText("Research workflow")).toBeVisible();
  expect(document.querySelector(".react-flow__handle-left")).toBeInTheDocument();
  expect(document.querySelector(".react-flow__handle-right")).toBeInTheDocument();
});
