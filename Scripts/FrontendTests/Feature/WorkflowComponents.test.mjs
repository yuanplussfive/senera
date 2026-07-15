import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";

const { ThinkingTimeline } = await import("../../../Frontend/src/features/workflow/ThinkingTimeline.tsx");
const { ThinkingTimelineCanvas } = await import("../../../Frontend/src/features/workflow/ThinkingTimelineCanvas.tsx");
const { StepNode } = await import("../../../Frontend/src/features/workflow/StepNode.tsx");
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
  await user.click(screen.getByRole("button", { name: frontendMessage("workflow.panel.focus") }));
  expect(screen.getByRole("dialog", { name: frontendMessage("workflow.panel.title") })).toBeInTheDocument();
});

test("workflow dock opens the persisted execution panel", async () => {
  useStore.setState({ rightPanelCollapsed: true });
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(ThinkingTimeline, { presentation: "dock" }),
      React.createElement(ThinkingTimeline),
    ),
  );

  await user.click(screen.getByRole("button", { name: frontendMessage("workflow.panel.title") }));

  expect(useStore.getState().rightPanelCollapsed).toBe(false);
  expect(screen.getByText(frontendMessage("workflow.panel.title"))).toBeVisible();
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
