import React from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { WorkflowDockGraph, projectDockWorkflow } =
  await import("../../../Frontend/src/features/workflow/WorkflowDockGraph.tsx");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");
const { TooltipProvider } = await import("../../../Frontend/src/shared/ui/Tooltip.tsx");
const { createRun, createStep, createToolBatchRun } = await import("./workflowComponentFixtures.mjs");

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("parallel tool calls collapse into one batch entry and hide the represented preface and plan", () => {
  const entries = projectDockWorkflow(createToolBatchRun(["read_file", "write_file"]));
  expect(entries.map((entry) => entry.id)).toEqual(["batch:batch-actions"]);
  const batch = entries.find((entry) => entry.kind === "batch");
  expect(batch.tools.map((step) => step.id)).toEqual(["tool-0", "tool-1"]);
  expect(entries.some((entry) => entry.id === "step:batch-plan")).toBe(false);
  expect(entries.some((entry) => entry.id === "step:compose-answer")).toBe(false);
});

test("a batch without invocations keeps its plan inspectable", () => {
  const entries = projectDockWorkflow(createToolBatchRun([]));
  expect(entries.map((entry) => entry.id)).toEqual(["step:batch-preface", "step:batch-plan"]);
});

test("a finished reply stays a static trace row with its duration and no disclosure", () => {
  const view = renderDock(
    "none",
    createRun({
      steps: [
        createStep({
          id: "final-answer",
          kind: "answer",
          title: "生成回复",
          description: "这是只属于主对话的完整回复正文。",
          durationMs: 31000,
          detailJson: { messageId: "internal-message-id", content: "重复的正文", terminal: false },
        }),
      ],
    }),
  );
  const row = view.container.querySelector("[data-workflow-dock-step='final-answer']");
  expect(row).toHaveTextContent("生成回复");
  expect(row).toHaveTextContent("31s");
  expect(row.querySelector("button")).toBeNull();
  expect(row.querySelector("[aria-expanded]")).toBeNull();
  expect(row).not.toHaveTextContent("internal-message-id");
});

test("tool settlement keeps its existing card in place without moving later calls", () => {
  const first = createStep({
    id: "first",
    kind: "tool",
    toolName: "Read",
    status: "running",
    eventSequence: 1,
    startedSequence: 2,
  });
  const second = createStep({
    id: "second",
    kind: "tool",
    toolName: "Search",
    status: "running",
    eventSequence: 3,
    startedSequence: 4,
  });
  const view = renderDock("none", createRun({ steps: [first, second] }));
  const originalCard = view.container.querySelector("[data-workflow-dock-step='first']");
  const originalButton = originalCard.querySelector("button");
  const completed = { ...first, status: "done", completedSequence: 8, endedAt: "2026-07-11T00:00:01.000Z" };
  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        AppMotionProvider,
        { level: "none" },
        React.createElement(WorkflowDockGraph, { run: createRun({ steps: [completed, second] }) }),
      ),
    ),
  );
  expect(view.container.querySelector("[data-workflow-dock-step='first']")).toBe(originalCard);
  expect(originalCard.querySelector("button")).toBe(originalButton);
  expect(
    [...view.container.querySelectorAll("[data-workflow-dock-step]")].map((node) => node.dataset.workflowDockStep),
  ).toEqual(["first", "second"]);
  expect(view.container.querySelector("[data-workflow-dock-step='first']")).toHaveAttribute(
    "data-workflow-tool-status",
    "done",
  );
});

test("expanding a batch keeps every tool independently inspectable", () => {
  const view = renderDock("none");
  const batch = view.container.querySelector("[data-workflow-dock-batch]");
  expect(batch).toHaveAttribute("data-workflow-dock-expanded", "false");
  expect(view.container.querySelectorAll("[data-workflow-dock-step]")).toHaveLength(0);

  fireEvent.click(view.container.querySelector("[data-workflow-dock-batch-summary]"));

  expect(batch).toHaveAttribute("data-workflow-dock-expanded", "true");
  const tools = [...view.container.querySelectorAll("[data-workflow-tool-call-card]")];
  expect(tools).toHaveLength(2);
  for (const tool of tools) {
    expect(tool.querySelectorAll("button")).toHaveLength(1);
    expect(tool.querySelector("button")).toHaveAttribute("aria-expanded", "false");
  }

  fireEvent.click(tools[0].querySelector("button"));
  expect(tools[0].querySelector("button")).toHaveAttribute("aria-expanded", "true");
  expect(tools[1].querySelector("button")).toHaveAttribute("aria-expanded", "false");
});

test("pointer inspection highlights only the matching rail node and clears on leave", async () => {
  const view = renderDock("none");
  const list = view.container.querySelector("[data-workflow-dock-graph] [role='list']");
  const entry = view.container.querySelector("[data-workflow-dock-entry-id='batch:batch-actions']");

  fireEvent.pointerMove(entry);
  await waitFor(() => expect(entry.querySelector("[data-workflow-dock-flow-node-active='true']")).not.toBeNull());
  expect(view.container.querySelectorAll("[data-workflow-dock-flow-node-active='true']")).toHaveLength(1);

  fireEvent.pointerLeave(list);
  await waitFor(() => expect(view.container.querySelector("[data-workflow-dock-flow-node-active='true']")).toBeNull());
});

test("the dock aggregates the run's resources once in the shared output summary", () => {
  const sharedResource = {
    uri: "senera://resource/res_0123456789abcdef0123456789abcdef",
    name: "generated.png",
    mime: "image/png",
    origin: "tool",
  };
  const presentation = (headline) => ({
    type: "senera.tool_result_presentation.v1",
    version: 1,
    status: "success",
    headline,
    facts: [],
    evidence: [],
    changes: [],
    resources: [sharedResource],
  });
  const run = createRun({
    steps: [
      createStep({
        id: "image-tool-1",
        kind: "tool",
        toolName: "draw_image",
        toolPresentation: presentation("Generated image"),
      }),
      createStep({
        id: "image-tool-2",
        kind: "tool",
        toolName: "save_image",
        toolPresentation: presentation("Saved image"),
      }),
    ],
  });
  const view = renderDock("none", run);

  expect(view.container.querySelector("[data-tool-run-output-summary]")).not.toBeNull();
  expect(view.container.querySelectorAll("[data-tool-resource]")).toHaveLength(1);
});

function renderDock(level, run = createToolBatchRun(["read_file", "write_file"])) {
  return renderWithFrontendProviders(
    React.createElement(AppMotionProvider, { level }, React.createElement(WorkflowDockGraph, { run })),
  );
}
