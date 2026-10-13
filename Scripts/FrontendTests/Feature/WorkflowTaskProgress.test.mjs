import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

const { WorkflowTaskProgress } = await import("../../../Frontend/src/features/workflow/WorkflowTaskProgress.tsx");

afterEach(() => {
  cleanup();
});

function todo(content, status) {
  return { content, status };
}

function runWithTasks(rootItems = [], childItems = [], status = "running") {
  return {
    status,
    todos: { items: rootItems },
    steps: childItems.length
      ? [
          {
            id: "child-run-reviewer",
            scope: { agentName: "reviewer" },
            childRun: {
              id: "child-reviewer",
              todo: { items: childItems },
            },
          },
        ]
      : [],
  };
}

test("renders root and child task groups in the workflow panel", () => {
  renderWithFrontendProviders(
    React.createElement(WorkflowTaskProgress, {
      run: runWithTasks(
        [todo("检查调用链", "in_progress"), todo("汇总方案", "pending")],
        [todo("核验回归", "completed"), todo("提交报告", "pending")],
      ),
    }),
  );

  expect(document.querySelector("[data-workflow-task-progress]")).toBeInTheDocument();
  expect(screen.getByText("检查调用链")).toBeInTheDocument();
  expect(screen.getByText("汇总方案")).toBeInTheDocument();
  expect(screen.getByText("reviewer")).toBeInTheDocument();
  expect(screen.getByText("核验回归")).toBeInTheDocument();
  expect(screen.getByText("提交报告")).toBeInTheDocument();
  expect(document.querySelectorAll("[data-workflow-task-item]")).toHaveLength(4);
  expect(document.querySelector("[data-todo-item='in_progress'] .workflow-task-progress__status-icon")).toHaveAttribute(
    "data-execution-status-icon",
    "running",
  );
  expect(document.querySelector("[data-todo-item='in_progress'] .workflow-task-progress__label")).not.toHaveClass(
    "motion-safe:animate-text-shimmer",
  );
  expect(screen.getByText("已完成 1 / 4")).toBeInTheDocument();
});

test("does not invent an owner label when the child run has no declared agent name", () => {
  const run = runWithTasks([], [todo("核验输出", "pending")]);
  run.steps[0].scope = undefined;

  renderWithFrontendProviders(React.createElement(WorkflowTaskProgress, { run }));

  expect(screen.getByText("核验输出")).toBeInTheDocument();
  expect(screen.queryByText(frontendMessage("workflow.childRun.board.agentFallback"))).not.toBeInTheDocument();
  expect(document.querySelector("[data-workflow-task-group] h3")).not.toBeInTheDocument();
});

test("omits the workflow task section when root and child runs have no tasks", () => {
  renderWithFrontendProviders(React.createElement(WorkflowTaskProgress, { run: runWithTasks() }));

  expect(document.querySelector("[data-workflow-task-progress]")).not.toBeInTheDocument();
});

test("keeps a settled run's task history visible in the workflow panel", () => {
  renderWithFrontendProviders(
    React.createElement(WorkflowTaskProgress, {
      run: runWithTasks([todo("恢复中断任务", "cancelled")], [], "cancelled"),
    }),
  );

  expect(screen.getByText("恢复中断任务")).toBeInTheDocument();
});
