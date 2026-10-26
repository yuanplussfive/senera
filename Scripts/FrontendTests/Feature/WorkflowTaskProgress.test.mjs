import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

const { WorkflowTaskProgress, readRunTaskGroups, readTodoTaskGroups } =
  await import("../../../Frontend/src/features/workflow/WorkflowTaskProgress.tsx");

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

test("renders root and child task groups with a completion summary", () => {
  const run = runWithTasks(
    [todo("检查调用链", "in_progress"), todo("汇总方案", "pending")],
    [todo("核验回归", "completed"), todo("提交报告", "pending")],
  );

  renderWithFrontendProviders(React.createElement(WorkflowTaskProgress, { groups: readRunTaskGroups(run) }));

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
  expect(screen.getByText("已完成 1 / 4")).toBeInTheDocument();
  expect(document.querySelector("[data-workflow-task-progress-bar]")).toHaveAttribute("aria-valuenow", "1");
});

test("does not invent an owner label when the child run has no declared agent name", () => {
  const run = runWithTasks([], [todo("核验输出", "pending")]);
  run.steps[0].scope = undefined;

  renderWithFrontendProviders(React.createElement(WorkflowTaskProgress, { groups: readRunTaskGroups(run) }));

  expect(screen.getByText("核验输出")).toBeInTheDocument();
  expect(screen.queryByText(frontendMessage("workflow.childRun.board.agentFallback"))).not.toBeInTheDocument();
  expect(document.querySelector(".workflow-task-progress__owner")).not.toBeInTheDocument();
});

test("omits the workflow task section when no group has tasks", () => {
  renderWithFrontendProviders(React.createElement(WorkflowTaskProgress, { groups: readRunTaskGroups(runWithTasks()) }));

  expect(document.querySelector("[data-workflow-task-progress]")).not.toBeInTheDocument();
});

test("keeps a settled run's task history visible", () => {
  renderWithFrontendProviders(
    React.createElement(WorkflowTaskProgress, {
      groups: readRunTaskGroups(runWithTasks([todo("恢复中断任务", "cancelled")], [], "cancelled")),
    }),
  );

  expect(screen.getByText("恢复中断任务")).toBeInTheDocument();
});

test("presents the session's standing list as one group without an owner label", () => {
  const groups = readTodoTaskGroups({ items: [todo("整理索引", "in_progress")] });

  expect(groups).toHaveLength(1);
  expect(groups[0].owner).toBeUndefined();

  renderWithFrontendProviders(React.createElement(WorkflowTaskProgress, { groups }));
  expect(screen.getByText("整理索引")).toBeInTheDocument();
  expect(document.querySelector(".workflow-task-progress__owner")).not.toBeInTheDocument();
});

test("treats an absent or empty session list as no tasks", () => {
  expect(readTodoTaskGroups(undefined)).toEqual([]);
  expect(readTodoTaskGroups({ items: [] })).toEqual([]);
});
