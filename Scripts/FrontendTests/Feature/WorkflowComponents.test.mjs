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
const { AgentExecutionFeed } = await import("../../../Frontend/src/features/workflow/AgentExecutionFeed.tsx");
const { ChatHeader } = await import("../../../Frontend/src/features/chat/ChatHeader.tsx");
const { ThinkingSummaryBar } = await import("../../../Frontend/src/features/chat/ThinkingSummaryBar.tsx");
const { TooltipProvider } = await import("../../../Frontend/src/shared/ui/Tooltip.tsx");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");
const { Position, ReactFlowProvider } = await import("@xyflow/react");
const { useStore } = await import("../../../Frontend/src/store/sessionStore.ts");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");

beforeEach(() => {
  installMemoryLocalStorage();
  resetFrontendStore();
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
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

test("chat header always exposes the effective execution mode beside terminal access", () => {
  const onOpenTerminalPanel = vi.fn();
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
      onOpenTerminalPanel,
    }),
  );

  expect(
    screen.getByRole("status", {
      name: frontendMessage("execution.mode.sandbox", {
        provider: frontendMessage("sandbox.provider.dockerEngine"),
      }),
    }),
  ).toHaveAttribute("data-execution-mode", "sandbox");
  expect(screen.getByRole("button", { name: frontendMessage("terminal.panel.open") })).toBeInTheDocument();

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
        onOpenTerminalPanel,
      }),
    ),
  );

  expect(
    screen.getByRole("status", {
      name: frontendMessage("execution.mode.host", { shell: frontendMessage("execution.shell.powershell") }),
    }),
  ).toHaveAttribute("data-execution-mode", "host");

  rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(ChatHeader, {
        title: "Sandbox status",
        sandboxStatus: { ...baseStatus, state: "unavailable", effectiveMode: "unavailable" },
        onOpenTerminalPanel,
      }),
    ),
  );

  expect(screen.getByRole("status", { name: frontendMessage("execution.mode.unavailable") })).toHaveAttribute(
    "data-execution-mode",
    "unavailable",
  );
  expect(screen.getByRole("button", { name: frontendMessage("terminal.panel.open") })).toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: /展开WorkspaceRead/ }));
  expect(screen.getByText(frontendMessage("workflow.node.section.toolArgs"))).toBeVisible();
  expect(screen.getByText(frontendMessage("workflow.node.section.rawToolResult"))).toBeVisible();
  expect(screen.getByText(/export const runtime = true/)).toBeVisible();
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
  await waitFor(() => expect(screen.getByText("WorkspaceReadFile")).toBeVisible());
  expect(screen.getByText("WorkspaceSearchFiles")).toBeVisible();
  expect(group).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelector("[data-feed-detail-surface]")).toHaveClass(
    "border-line-subtle",
    "bg-surface-subtle/70",
  );

  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(AgentExecutionFeed, {
        run: createToolBatchRun(["WorkspaceReadFile", "WorkspaceSearchFiles", "WorkspaceListDirectory"]),
      }),
    ),
  );
  expect(screen.getByText("WorkspaceListDirectory")).toBeVisible();
  expect(document.querySelector("[data-feed-group='tools:batch-actions']")).toHaveAttribute("aria-expanded", "true");
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

  // 展开后可见活动明细(等待展开动画完成)。
  await user.click(activityToggle);
  await waitFor(() => expect(screen.getByText(frontendMessage("workflow.activity.preparingContext"))).toBeVisible());
  expect(screen.getByText(frontendMessage("workflow.activity.runningAgentTurn"))).toBeVisible();
  expect(screen.getByText(frontendMessage("workflow.activity.compactingContext"))).toBeVisible();
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
    "border-brick-200",
    "bg-brick-50",
  );
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
    kind: "model",
    title: "Model step",
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
