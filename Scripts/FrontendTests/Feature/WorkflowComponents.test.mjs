import React from "react";
import { globSync, readFileSync } from "node:fs";
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
const { AgentExecutionFeed, AgentExecutionStageFeed } =
  await import("../../../Frontend/src/features/workflow/AgentExecutionFeed.tsx");
const { projectToolStagePresentation } =
  await import("../../../Frontend/src/features/workflow/toolStagePresentation.ts");
const { projectToolActivityInspection } =
  await import("../../../Frontend/src/features/workflow/toolActivityPresentation.ts");
const { ChatHeader } = await import("../../../Frontend/src/features/chat/ChatHeader.tsx");
const { ThinkingSummaryBar } = await import("../../../Frontend/src/features/chat/ThinkingSummaryBar.tsx");
const { TooltipProvider } = await import("../../../Frontend/src/shared/ui/Tooltip.tsx");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");
const { Position, ReactFlowProvider } = await import("@xyflow/react");
const { useStore } = await import("../../../Frontend/src/store/sessionStore.ts");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { projectWorkflowActivities, projectWorkflowSteps } =
  await import("../../../Frontend/src/features/workflow/workflowPresentationProjection.ts");

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
  const onViewWorkflow = vi.fn();
  const run = createRun({ steps: [createStep({ title: "Inspect projected context" })] });
  renderWithFrontendProviders(
    React.createElement(
      AppMotionProvider,
      { level: "none" },
      React.createElement(ThinkingSummaryBar, { run, onViewWorkflow }),
    ),
  );

  const trigger = document.querySelector("[data-ui-chrome] button[aria-expanded]");
  expect(trigger).toBeInstanceOf(HTMLButtonElement);
  expect(trigger).toHaveAttribute("aria-expanded", "false");

  await user.click(trigger);

  const disclosureId = trigger.getAttribute("aria-controls");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(disclosureId).not.toBeNull();
  await waitFor(() =>
    expect(document.getElementById(disclosureId)).toContainElement(
      screen.getByRole("button", { name: frontendMessage("workflow.summary.viewFull") }),
    ),
  );

  await user.click(trigger);
  await waitFor(() => expect(document.getElementById(disclosureId)).not.toBeInTheDocument());
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

test("chat header exposes the effective execution mode without duplicating terminal access", () => {
  const baseStatus = {
    provider: "docker-engine",
    platform: "win32",
    supported: true,
    effectiveMode: "sandbox",
    dependencies: { errors: [], warnings: [] },
    diagnostics: [],
    message: "Sandbox runtime is ready",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
  const { rerender } = renderWithFrontendProviders(
    React.createElement(ChatHeader, {
      title: "Sandbox status",
      sandboxStatus: { ...baseStatus, state: "ready" },
    }),
  );

  expect(
    screen.getByRole("status", {
      name: frontendMessage("execution.mode.sandbox", {
        provider: frontendMessage("sandbox.provider.dockerEngine"),
      }),
    }),
  ).toHaveAttribute("data-execution-mode", "sandbox");
  expect(
    screen
      .getByRole("status", {
        name: frontendMessage("execution.mode.sandbox", {
          provider: frontendMessage("sandbox.provider.dockerEngine"),
        }),
      })
      .querySelector("span"),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: frontendMessage("terminal.panel.open") })).not.toBeInTheDocument();

  rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(ChatHeader, {
        title: "Sandbox status",
        sandboxStatus: {
          ...baseStatus,
          provider: undefined,
          state: "disabled",
          effectiveMode: "host",
          shellDialect: "powershell",
        },
      }),
    ),
  );

  expect(
    screen.getByRole("status", {
      name: frontendMessage("execution.mode.host", { shell: frontendMessage("execution.shell.powershell") }),
    }),
  ).toHaveAttribute("data-execution-mode", "host");
  expect(
    screen
      .getByRole("status", {
        name: frontendMessage("execution.mode.host", { shell: frontendMessage("execution.shell.powershell") }),
      })
      .querySelector("span"),
  ).toBeNull();

  rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(ChatHeader, {
        title: "Sandbox status",
        sandboxStatus: { ...baseStatus, state: "unavailable", effectiveMode: "unavailable" },
      }),
    ),
  );

  expect(screen.getByRole("status", { name: frontendMessage("execution.mode.unavailable") })).toHaveAttribute(
    "data-execution-mode",
    "unavailable",
  );
  expect(screen.getByRole("status", { name: frontendMessage("execution.mode.unavailable") })).toHaveTextContent(
    frontendMessage("execution.mode.unavailable"),
  );
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

test("dock execution view hides its composed title and keeps the raised run summary", () => {
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
  expect(document.querySelector("[data-workflow-run-summary]")).toHaveClass("rounded-[14px]", "bg-surface-raised");
  expect(document.querySelector("[data-workflow-run-status='completed']")).toHaveClass("bg-moss-50");
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
  await user.click(screen.getByRole("button", { name: /展开读取文件：Source\/runtime.ts/ }));
  await waitFor(() => expect(document.querySelector("[data-tool-step-inspector]")).toBeInTheDocument());
  expect(screen.getByText(frontendMessage("workflow.inspector.action"))).toBeVisible();
  expect(document.querySelector("[data-tool-step-inspector]")).toHaveTextContent("读取文件：Source/runtime.ts");
  expect(screen.getByText(frontendMessage("workflow.inspector.scope"))).toBeVisible();
  expect(screen.getByText("Source/runtime.ts")).toBeVisible();
  expect(screen.queryByText(frontendMessage("workflow.node.section.toolArgs"))).not.toBeInTheDocument();
  expect(screen.queryByText(frontendMessage("workflow.node.section.rawToolResult"))).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: frontendMessage("workflow.node.technicalDetails") }));
  expect(screen.getByText(frontendMessage("workflow.node.section.toolArgs"))).toBeVisible();
  expect(screen.getByText(frontendMessage("workflow.node.section.rawToolResult"))).toBeVisible();
  expect(screen.getByText(/export const runtime = true/)).toBeVisible();
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

  const batch = await screen.findByRole("button", { name: /展开并发工具批次/ });
  expect(document.querySelectorAll("[data-workflow-dock-batch]")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /展开Call WorkspaceFind/ })).not.toBeInTheDocument();
  await user.click(batch);
  expect(screen.getByRole("button", { name: /展开Call WorkspaceFind/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /展开Call WorkspaceRead/ })).toBeVisible();
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
  expect(screen.getByText("成功 12")).toBeVisible();
  expect(screen.getByText("失败 1")).toBeVisible();
  expect(screen.getByText("13/13")).toHaveClass("text-content-muted");
  expect(screen.getByText("13/13")).not.toHaveClass("text-brick-600");
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
  const view = renderWithFrontendProviders(React.createElement(AgentExecutionFeed, { run: initialRun }));
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
  await waitFor(() => expect(screen.getByText(frontendMessage("workflow.inspector.purpose"))).toBeVisible());
  const toolDetail = document.querySelector("[data-feed-tool-detail]");
  expect(toolDetail?.closest("[data-radix-popper-content-wrapper]")?.parentElement).toBe(document.body);
  expect(group.contains(toolDetail)).toBe(false);
  expect(toolDetail).toHaveClass("scrollbar-thin");
  expect(toolDetail).toHaveTextContent("Inspect runtime initialization before changing the workflow.");
  expect(toolDetail).toHaveTextContent("Source/runtime.ts");
  expect(document.querySelector("[data-line-change-stats]")).toHaveTextContent("+6");
  expect(document.querySelector("[data-line-change-stats]")).toHaveTextContent("-1");
  expect(screen.queryByText(frontendMessage("workflow.node.section.rawToolResult"))).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: frontendMessage("workflow.node.technicalDetails") }));
  expect(screen.getByText(frontendMessage("workflow.node.section.toolArgs"))).toBeVisible();
  expect(screen.getByText(frontendMessage("workflow.node.section.rawToolResult"))).toBeVisible();
  expect(document.querySelector("[data-feed-tool-detail]")).toHaveTextContent("export const runtime = true;");

  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(AgentExecutionFeed, {
        run: createToolBatchRun(["WorkspaceReadFile", "WorkspaceSearchFiles", "WorkspaceListDirectory"]),
      }),
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
  const toolFiles = globSync("System/Extensions/**/*.tool.json", { cwd: process.cwd() });
  expect(toolFiles.length).toBeGreaterThan(0);
  const genericTools = toolFiles
    .map((path) => JSON.parse(readFileSync(path, "utf8")).name)
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

  expect(screen.getByText(frontendMessage("workflow.feed.thinking"))).toBeVisible();
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

  expect(screen.getByText(frontendMessage("workflow.feed.thinking"))).toBeVisible();
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

function renderWorkflowNode(props) {
  return renderWithFrontendProviders(
    React.createElement(ReactFlowProvider, null, React.createElement(StepNode, props)),
  );
}

function viewportNode(id, data) {
  return {
    id,
    type: "step",
    position: { x: 0, y: 0 },
    data: { layout: workflowNodeLayout("vertical"), ...data },
  };
}

function workflowNodeData(direction, width, height) {
  return {
    layout: workflowNodeLayout(direction, width, height),
    kind: "step",
    step: createStep(),
  };
}

function workflowNodeLayout(direction, width = 240, height = 76) {
  return { direction, width, height };
}

function createSession(runs) {
  return {
    sessionId: "session-a",
    title: "Workflow session",
    status: "ready",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:02.000Z",
    entryCount: 2,
    messageCount: 2,
    messages: [],
    runs,
  };
}

function createRun(overrides = {}) {
  return {
    requestId: "run-a",
    revision: 0,
    startedAt: "2026-07-11T00:00:00.000Z",
    endedAt: "2026-07-11T00:00:02.000Z",
    status: "completed",
    input: "run input",
    steps: [createStep()],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    displayTarget: "",
    displayedChars: 0,
    expectedOutputMode: "open",
    ...overrides,
  };
}

function createStep(overrides = {}) {
  return {
    id: "step-a",
    kind: "decision",
    title: "Decision step",
    status: "done",
    startedAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function createToolBatchRun(toolNames) {
  const toolBatch = { id: "batch-actions", size: toolNames.length, executionMode: "parallel" };
  return createRun({
    requestId: "run-action-batch",
    status: "running",
    endedAt: undefined,
    steps: [
      createStep({
        id: "batch-preface",
        kind: "decision",
        title: "Preface before tool calls",
        description: "我先检查这一批工作区文件。",
        status: "done",
        decisionKind: "tool_preface",
        toolBatch,
      }),
      createStep({
        id: "batch-plan",
        kind: "tool",
        title: "Prepare action batch",
        status: "done",
        toolBatch,
      }),
      ...toolNames.map((toolName, index) =>
        createStep({
          id: `tool-${index}`,
          kind: "tool",
          title: `Call ${toolName}`,
          status: "done",
          toolName,
          callId: `call-${index}`,
          toolBatch: { ...toolBatch, index },
        }),
      ),
      createStep({
        id: "compose-answer",
        kind: "model",
        title: "Compose answer",
        status: "running",
      }),
    ],
  });
}
