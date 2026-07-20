import React from "react";
import { cleanup, screen } from "@testing-library/react";
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
const { ChatHeader } = await import("../../../Frontend/src/features/chat/ChatHeader.tsx");
const { ReactFlowProvider } = await import("@xyflow/react");
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

test("dock execution view uses a segmented header and raised run summary", () => {
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
      dockTabs: [
        { id: "execution", label: "执行", active: true, onSelect: vi.fn() },
        { id: "terminal", label: "终端", active: false, onSelect: vi.fn() },
      ],
    }),
  );

  expect(document.querySelector("[data-workflow-dock-tabs]")).toHaveClass("rounded-full", "bg-surface-subtle");
  expect(screen.getByRole("tab", { name: "执行" })).toHaveClass("flex-1", "bg-surface-raised");
  expect(screen.getByRole("tab", { name: "终端" })).toHaveAttribute("aria-selected", "false");
  expect(document.querySelector("[data-workflow-run-summary]")).toHaveClass("rounded-[14px]", "bg-surface-raised");
  expect(document.querySelector("[data-workflow-run-status='completed']")).toHaveClass("bg-moss-50");
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
});

test("focused workflow canvas allows free panning beyond the compact content bounds", async () => {
  const run = createRun({
    steps: [createStep({ id: "focused", title: "Inspect focused workflow" })],
  });
  renderWithFrontendProviders(React.createElement(ThinkingTimelineCanvas, { run, focusVersion: 1 }));

  expect(await screen.findByText("Inspect focused workflow")).toBeInTheDocument();
  expect(document.querySelector("[data-workflow-canvas-pan]")).toHaveAttribute("data-workflow-canvas-pan", "free");
  expect(document.querySelector("[data-workflow-canvas-bounds]")).toHaveAttribute(
    "data-workflow-canvas-bounds",
    "unbounded",
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
    },
    300,
  );
  expect(startViewport.x + (100 + 120) * startViewport.zoom).toBeCloseTo(150);
  expect(startViewport.y + 200 * startViewport.zoom).toBeCloseTo(24);
});

test("step node presents failed tool identity, error, status, and duration", () => {
  renderWorkflowNode({
    data: {
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
    data,
  };
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
